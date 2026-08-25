import type { CloudProvider, CustomerCostRow } from "./contract";
import {
  LEGACY_CHARGE_CATEGORY,
  LEGACY_COMMITMENT_TYPE,
  LEGACY_PRICING_CATEGORY,
  deriveServiceCategory,
  normalizeProvider,
  resourceGroupFromId,
  resourceNameFromId,
} from "./contract";
import type { ParsedFileHeader, RawRow } from "./parser";

export interface NormalizeResult {
  row: CustomerCostRow | null;
  /** Reason the row was dropped, when `row` is null. */
  skipReason?: string;
}

function pick(
  row: RawRow,
  header: ParsedFileHeader,
  focusColumn: string,
): string {
  const source = header.columnMap[focusColumn] ?? focusColumn;
  const value = row[source];
  return typeof value === "string" ? value.trim() : "";
}

/** Cost exports use `.` as decimal separator, but may carry thousands commas. */
function toNumber(value: string): number {
  if (!value) return 0;
  const cleaned = value.replace(/,/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Cost exports have used ISO dates, `MM/DD/YYYY` and the compact `YYYYMMDD`
 * form depending on the export version and locale. Returns an ISO date
 * (`YYYY-MM-DD`) or null when the value is unusable.
 */
export function toIsoDate(value: string): string | null {
  if (!value) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;

  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(value);
  if (slashed) {
    const month = slashed[1].padStart(2, "0");
    const day = slashed[2].padStart(2, "0");
    return `${slashed[3]}-${month}-${day}`;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/** Advances an ISO date by one day, in UTC. */
export function addOneDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Parses the `Tags` column into a flat map. Azure emits this either as a JSON
 * object (`{"env":"prod"}`), as a bare list of pairs (`"env": "prod"`), or as
 * `key:value;key:value`. A malformed value degrades to an empty map instead of
 * failing the import — tags drive governance views only.
 */
export function parseTags(value: string): Record<string, string> {
  if (!value) return {};

  const candidates = [value, `{${value}}`];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const tags: Record<string, string> = {};
        for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
          tags[key.trim().toLowerCase()] = raw == null ? "" : String(raw);
        }
        return tags;
      }
    } catch {
      // fall through to the delimited form
    }
  }

  const tags: Record<string, string> = {};
  for (const pair of value.split(";")) {
    const index = pair.indexOf(":");
    if (index <= 0) continue;
    const key = pair.slice(0, index).replace(/["']/g, "").trim().toLowerCase();
    const raw = pair.slice(index + 1).replace(/["']/g, "").trim();
    if (key) tags[key] = raw;
  }
  return tags;
}

function mapLookup(
  table: Record<string, string>,
  value: string,
  fallback: string,
): string {
  if (!value) return fallback;
  return table[value.replace(/[\s_-]/g, "").toLowerCase()] ?? fallback;
}

/**
 * AWS spells "no region" in two ways that mean the same thing: an empty string
 * (tax and other account-level charges) and the literal `Any` with
 * `RegionId = global` (Route 53, IAM, CloudFront and friends). Left as-is they
 * become two separate rows in every region breakdown, one of them labelled
 * "Any", which reads as a data error in front of a customer.
 */
function normalizeRegion(regionName: string, regionId: string, provider: CloudProvider): string {
  const cleaned = regionName.trim();
  const id = regionId.trim().toLowerCase();

  if (provider === "AWS") {
    if (!cleaned || cleaned.toLowerCase() === "any" || id === "global") return "Global";
    return cleaned;
  }

  return cleaned || "Unknown";
}

/**
 * Maps one raw export row onto `CustomerCostRow`. For legacy exports the FOCUS
 * semantics are reconstructed (see `LEGACY_*` tables in `contract.ts`).
 */
export function normalizeRow(
  row: RawRow,
  header: ParsedFileHeader,
): NormalizeResult {
  const isFocus = header.format === "focus";
  // Column absent → an export that predates the provider dimension, which can
  // only be Azure. Column present but blank → the export declined to say, and
  // guessing Azure would quietly annex another vendor's spend.
  const hasProviderColumn =
    header.columnMap["ProviderName"] !== undefined ||
    header.headers.includes("ProviderName");
  const provider = normalizeProvider(
    pick(row, header, "ProviderName"),
    hasProviderColumn ? "Other" : "Azure",
  );
  const isAws = provider === "AWS";

  const chargePeriodStart = toIsoDate(pick(row, header, "ChargePeriodStart"));
  if (!chargePeriodStart) {
    return { row: null, skipReason: "unparseable charge date" };
  }

  // A charge period must cover at least the day it starts on. AWS emits rows
  // whose start and end are identical, and legacy exports omit the column
  // altogether; both collapse to a single day, which is how every window
  // behaved before `chargePeriodEnd` existed.
  const parsedPeriodEnd = toIsoDate(pick(row, header, "ChargePeriodEnd"));
  const chargePeriodEnd =
    parsedPeriodEnd && parsedPeriodEnd > chargePeriodStart
      ? parsedPeriodEnd
      : addOneDay(chargePeriodStart);

  const effectiveCost = toNumber(pick(row, header, "EffectiveCost"));
  const effectiveCostInUsd =
    toNumber(pick(row, header, "x_EffectiveCostInUsd")) || effectiveCost;

  const resourceId = pick(row, header, "ResourceId");
  const resourceName =
    pick(row, header, "ResourceName") || resourceNameFromId(resourceId);
  // AWS has no Resource Group: an ARN carries account, service and resource,
  // but nothing equivalent to an ARM resource group. Deriving one from the
  // account or a tag would invent a governance dimension the customer does not
  // actually have, so it stays empty and the UI labels it explicitly.
  const resourceGroupName = isAws
    ? ""
    : pick(row, header, "x_ResourceGroupName") || resourceGroupFromId(resourceId);

  // AWS FOCUS has no x_SkuMeterCategory/Subcategory. `x_ServiceCode`
  // (AmazonRoute53) and `SkuMeter` (DNS-Queries) are the closest true
  // equivalents and keep the meter breakdowns populated.
  const skuMeterCategory = isAws
    ? pick(row, header, "x_ServiceCode")
    : pick(row, header, "x_SkuMeterCategory");
  const skuMeterSubcategory = isAws
    ? pick(row, header, "SkuMeter")
    : pick(row, header, "x_SkuMeterSubcategory");
  const serviceName =
    pick(row, header, "ServiceName") || skuMeterCategory || "Unknown";

  // FOCUS exports carry a real ServiceCategory (AWS populates all 16 of them),
  // so it always wins. The keyword derivation exists only for legacy Azure
  // exports, which have no such column.
  const serviceCategory =
    pick(row, header, "ServiceCategory") ||
    deriveServiceCategory(serviceName, skuMeterCategory, skuMeterSubcategory);

  const rawChargeCategory = pick(row, header, "ChargeCategory");
  const chargeCategory = isFocus
    ? rawChargeCategory || "Usage"
    : mapLookup(LEGACY_CHARGE_CATEGORY, rawChargeCategory, "Usage");

  const rawPricingCategory = pick(row, header, "PricingCategory");
  const pricingCategory = isFocus
    ? rawPricingCategory || "Standard"
    : mapLookup(LEGACY_PRICING_CATEGORY, rawPricingCategory, "Standard");

  const commitmentDiscountId = pick(row, header, "CommitmentDiscountId");
  const commitmentDiscountType = isFocus
    ? pick(row, header, "CommitmentDiscountType")
    : mapLookup(LEGACY_COMMITMENT_TYPE, rawPricingCategory, "");

  // Baseline for the savings rate. `ListCost` is the public list price and is
  // the right baseline whenever populated. On commitment-covered lines Azure
  // emits ListCost = 0 and puts the on-demand equivalent in `ContractedCost`
  // (cross-checked against the Retail Prices API by meterId: exact match).
  //
  // The previous code did `ListCost || effectiveCost`, which treats a real 0 as
  // "missing" and substitutes the effective cost — collapsing the baseline onto
  // the cost precisely on the reservation lines where savings are ~62%, so the
  // customer's actual savings vanished from the report.
  //
  // Rows with no baseline at all are unused commitment charges: nothing ran, so
  // "would have cost" is undefined. They are waste, reported separately, and
  // never enter the savings rate.
  const listCost = toNumber(pick(row, header, "ListCost"));
  const contractedCost = toNumber(pick(row, header, "ContractedCost"));
  const hasBaseline = listCost > 0 || contractedCost > 0;

  // FOCUS exports supply CommitmentDiscountStatus directly; that value always wins.
  // Legacy exports do not have this column, so it is derived from ChargeType:
  //   - ChargeType "unusedreservation" / "unusedsavingsplan" → "Unused"
  //   - Any other committed row (ChargeType "usage" + PricingModel "reservation"
  //     / "savingsplan") → "Used"
  // Without this derivation, every legacy commitment reports 100% utilisation,
  // which is a false reassurance: it silently hides waste from the customer.
  let commitmentDiscountStatus = pick(row, header, "CommitmentDiscountStatus");
  if (!isFocus && !commitmentDiscountStatus) {
    const rawCharge = rawChargeCategory.replace(/[\s_-]/g, "").toLowerCase();
    if (rawCharge === "unusedreservation" || rawCharge === "unusedsavingsplan") {
      commitmentDiscountStatus = "Unused";
    } else if (pricingCategory === "Committed") {
      commitmentDiscountStatus = "Used";
    }
  }

  return {
    row: {
      providerName: provider,
      chargePeriodStart,
      chargePeriodEnd,
      billingCurrency: pick(row, header, "BillingCurrency") || "USD",
      chargeCategory,
      pricingCategory,
      pricingUnit: pick(row, header, "PricingUnit"),
      consumedQuantity: toNumber(pick(row, header, "ConsumedQuantity")),
      effectiveCost,
      listCost,
      contractedCost,
      hasBaseline,
      effectiveCostInUsd,
      serviceName,
      serviceCategory,
      subAccountName: pick(row, header, "SubAccountName") || "Unknown",
      regionName: normalizeRegion(
        pick(row, header, "RegionName"),
        pick(row, header, "RegionId"),
        provider,
      ),
      resourceId,
      resourceName,
      resourceType: pick(row, header, "ResourceType") || skuMeterCategory,
      resourceGroupName,
      tags: parseTags(pick(row, header, "Tags")),
      commitmentDiscountId,
      commitmentDiscountName: pick(row, header, "CommitmentDiscountName"),
      commitmentDiscountType,
      commitmentDiscountCategory: pick(
        row,
        header,
        "CommitmentDiscountCategory",
      ),
      commitmentDiscountStatus,
      skuTerm: pick(row, header, "x_SkuTerm"),
      skuMeterCategory,
      skuMeterSubcategory,
    },
  };
}
