/**
 * Contract for customer data ingested from an Azure Cost Management export.
 *
 * The dashboard normally queries the FinOps Hub in ADX via `Costs()`. For
 * pre-sales POCs we accept a Cost Export file instead, so the customer does not
 * have to install anything: they configure the export in the Azure portal and
 * hand over the CSV.
 *
 * The field set below is intentionally minimal — it is exactly the set of FOCUS
 * columns referenced by the KQL in `src/lib/queries/`. Nothing else is kept, so
 * the processed dataset carries the least customer data required to render the
 * insights.
 */

/** Normalized cost row. Mirrors the FOCUS columns consumed by `Costs()`. */
export interface CustomerCostRow {
  /**
   * FOCUS: ProviderName — the cloud provider that issued the charge
   * ("Microsoft" / "Azure", "AWS", ...), normalized to `CloudProvider`.
   *
   * The dashboard ingests one dataset per customer, but a customer routinely
   * runs more than one cloud, so rows from an Azure Cost Export and an AWS Data
   * Export coexist in the same file. Without this dimension the totals silently
   * merge and no view can separate them.
   */
  providerName: CloudProvider;
  /** FOCUS: ChargePeriodStart — start of the charge period (day granularity). */
  chargePeriodStart: string;
  /**
   * FOCUS: ChargePeriodEnd — exclusive end of the charge period.
   *
   * Azure Cost Exports are daily, so for years this column carried no
   * information the dashboard needed and every relative window could be
   * decided from `chargePeriodStart` alone. AWS Data Exports break that
   * assumption: in the reference dataset 98% of the cost sits on rows whose
   * period spans 2-31 days, so a row dated the 1st can represent the entire
   * month. Windowing on the start date alone silently dropped those rows.
   *
   * Always a date strictly after `chargePeriodStart`. When the source omits
   * the column, or emits an end at or before the start, it is stored as
   * `chargePeriodStart + 1 day`, which reproduces the previous daily
   * behaviour exactly.
   */
  chargePeriodEnd: string;
  /** FOCUS: BillingCurrency — ISO currency code of `effectiveCost`. */
  billingCurrency: string;
  /** FOCUS: ChargeCategory — Usage | Purchase | Tax | Credit | Adjustment. */
  chargeCategory: string;
  /** FOCUS: PricingCategory — Standard | Committed | Dynamic. */
  pricingCategory: string;
  /** FOCUS: PricingUnit — unit the price is expressed in. */
  pricingUnit: string;
  /**
   * FOCUS: ConsumedQuantity — how much of `pricingUnit` the row billed.
   *
   * Cost alone cannot compare two clouds: a provider looks cheap when it simply
   * carries less workload. Only cost ÷ quantity yields a rate that is
   * comparable across vendors, so the multicloud comparison is built on this
   * column.
   *
   * Zero is a legitimate value (purchase and credit rows consume nothing), and
   * it is *not* the same as "not reported". Callers must divide only when this
   * is strictly positive, or they turn an unknown into an infinite unit price.
   */
  consumedQuantity: number;
  /** FOCUS: EffectiveCost — amortized cost in billing currency. */
  effectiveCost: number;
  /**
   * FOCUS: ListCost — cost at public list price. Stored raw: Azure emits 0 on
   * commitment-covered lines, and that 0 is meaningful, not missing. Use
   * `baselineCost()` rather than reading this directly for savings maths.
   */
  listCost: number;
  /**
   * FOCUS: ContractedCost — cost at the negotiated price, before any
   * commitment discount. On reservation/savings-plan lines this is where Azure
   * puts the on-demand equivalent while `ListCost` is 0 (verified against the
   * Retail Prices API by meterId), so it is the fallback baseline.
   */
  contractedCost: number;
  /**
   * True when the row has a usable "would have cost" baseline. False for
   * unused commitment charges: nothing ran, so no baseline exists — those are
   * waste, not consumption, and must stay out of the savings rate.
   */
  hasBaseline: boolean;
  /** FOCUS: x_EffectiveCostInUsd — effective cost in USD, when available. */
  effectiveCostInUsd: number;
  /** FOCUS: ServiceName. */
  serviceName: string;
  /** FOCUS: ServiceCategory — drives the AI cost views. */
  serviceCategory: string;
  /** FOCUS: SubAccountName — the Azure subscription name. */
  subAccountName: string;
  /** FOCUS: RegionName. */
  regionName: string;
  /** FOCUS: ResourceId — full ARM resource id. Sensitive. */
  resourceId: string;
  /** FOCUS: ResourceName. */
  resourceName: string;
  /** FOCUS: ResourceType. */
  resourceType: string;
  /** FOCUS: x_ResourceGroupName. */
  resourceGroupName: string;
  /** FOCUS: Tags — parsed into a flat map. Sensitive. */
  tags: Record<string, string>;
  /** FOCUS: CommitmentDiscountId — reservation / savings plan id. */
  commitmentDiscountId: string;
  /**
   * FOCUS: CommitmentDiscountName — the friendly reservation name the customer
   * gave it in the portal. Far more useful in a meeting than the raw id.
   */
  commitmentDiscountName: string;
  /** FOCUS: CommitmentDiscountType — Reservation | Savings Plan. */
  commitmentDiscountType: string;
  /** FOCUS: CommitmentDiscountCategory — Usage | Spend. */
  commitmentDiscountCategory: string;
  /** FOCUS: CommitmentDiscountStatus — Used | Unused. */
  commitmentDiscountStatus: string;
  /**
   * FOCUS: x_SkuTerm — commitment term in months (e.g. "12", "36"). Azure does
   * emit this in the FOCUS export, so the reservation term is real data.
   */
  skuTerm: string;
  /** FOCUS: x_SkuMeterCategory. */
  skuMeterCategory: string;
  /** FOCUS: x_SkuMeterSubcategory. */
  skuMeterSubcategory: string;
}

/**
 * Baseline cost for savings maths: what the row *would* have cost without any
 * commitment discount.
 *
 * Cascade, in order:
 *   1. `ListCost` when populated — the public list price.
 *   2. `ContractedCost` when populated — negotiated price before the commitment
 *      discount. This is the only baseline available on reservation lines,
 *      where Azure emits `ListCost` = 0.
 *   3. Otherwise there is none, and the row must be excluded from the rate.
 *
 * Never falls back to `EffectiveCost`: doing so reports zero savings on exactly
 * the rows where the customer is actually saving.
 */
export function baselineCost(row: CustomerCostRow): number {
  if (row.listCost > 0) return row.listCost;
  if (row.contractedCost > 0) return row.contractedCost;
  return 0;
}

/** Source layout detected in the customer file. */
export type CustomerExportFormat = "focus" | "legacy";

/**
 * Cloud providers the dashboard can ingest.
 *
 * Kept as a narrow union rather than free text so the provider filter, the
 * per-provider KPIs and the Azure-only page guards all agree on one spelling.
 * Anything unrecognised falls back to "Other" instead of creating a new bucket
 * per vendor spelling.
 */
export type CloudProvider = "Azure" | "AWS" | "GCP" | "Other";

export const CLOUD_PROVIDERS: CloudProvider[] = ["Azure", "AWS", "GCP", "Other"];

/**
 * FOCUS `ProviderName` is free text and each vendor spells itself differently:
 * Azure exports emit "Microsoft" (and, in some versions, "Microsoft Azure"),
 * AWS Data Exports emit "AWS", and Google emits "Google Cloud".
 *
 * `emptyMeans` is explicit at every call site because a blank value is
 * ambiguous and the two readings have opposite consequences. A file with no
 * ProviderName column at all is a legacy Azure Cost Management export (or an
 * older FOCUS export predating the column), and calling those Azure is right.
 * A file that *has* the column and leaves it blank on a row is telling us it
 * does not know the provider — stamping that Azure would fold an unknown
 * vendor's spend into the Azure total and into the Azure-only pages, which is
 * exactly the silent mislabelling this whole provider dimension exists to
 * prevent. Callers that cannot tell the two apart must pass "Other".
 */
export function normalizeProvider(
  value: string,
  emptyMeans: CloudProvider,
): CloudProvider {
  const cleaned = value.trim().toLowerCase();
  if (!cleaned) return emptyMeans;
  if (cleaned.includes("aws") || cleaned.includes("amazon")) return "AWS";
  if (cleaned.includes("azure") || cleaned.includes("microsoft")) return "Azure";
  if (cleaned.includes("google") || cleaned === "gcp") return "GCP";
  return "Other";
}

/**
 * Pages built on Azure-only concepts (Resource Graph / Advisor evidence, ARM
 * resource groups, Azure Retail Prices) cannot say anything true about AWS
 * rows. They filter to this provider and surface a notice rather than quietly
 * folding AWS spend into an Azure-shaped recommendation.
 */
export const AZURE_ONLY_PROVIDER: CloudProvider = "Azure";

/** Written next to the processed rows so the UI can describe what is loaded. */
export interface CustomerDatasetManifest {
  schemaVersion: string;
  /** Display name shown in the dashboard, derived from the file name. */
  customer: string;
  format: CustomerExportFormat;
  generatedAtUtc: string;
  /**
   * Oldest last-modified timestamp across accepted source files. This is a
   * local freshness proxy, not an Azure capture timestamp.
   */
  sourceLastModifiedAtUtc?: string;
  sourceFiles: string[];
  rowCount: number;
  /** Rows dropped because they had no usable charge date or cost. */
  skippedRowCount: number;
  /** Earliest / latest ChargePeriodStart, ISO date. Null when no rows. */
  periodStart: string | null;
  periodEnd: string | null;
  /** Currencies seen in the data. More than one means mixed billing accounts. */
  currencies: string[];
  /** Cloud providers present in the dataset, sorted. */
  providers?: CloudProvider[];
  /** Row count per provider, so the UI can describe a multicloud dataset. */
  rowCountByProvider?: Partial<Record<CloudProvider, number>>;
  /** Per-provider period and currency, for multicloud freshness reporting. */
  providerSummaries?: CustomerProviderSummary[];
  /** True when the source provided usable USD costs. */
  hasUsdCosts: boolean;
  warnings: string[];
  /** Optional in older manifests. Manual assessment evidence is local-only. */
  assessmentEvidence?: {
    resourceGraph: CustomerEvidenceMetadata;
    advisor: CustomerEvidenceMetadata;
    policy?: CustomerEvidenceMetadata;
    security?: CustomerEvidenceMetadata;
    health?: CustomerEvidenceMetadata;
    patch?: CustomerEvidenceMetadata;
    operations?: CustomerEvidenceMetadata;
    metrics?: CustomerEvidenceMetadata;
    budgets?: CustomerEvidenceMetadata;
    commitments?: CustomerEvidenceMetadata;
  };
}

export interface CustomerEvidenceMetadata {
  status:
    | "available"
    | "empty"
    | "skipped"
    | "forbidden"
    | "failed"
    | "missing"
    /**
     * The evidence source does not exist for the providers in this dataset —
     * Azure Resource Graph and Advisor have no AWS equivalent. Distinct from
     * "missing", which means it was expected and not supplied.
     */
    | "not-applicable";
  sourceFiles: string[];
  rowCount: number;
  outputFile: string;
}

/** Per-provider slice of the dataset, reported in the manifest. */
export interface CustomerProviderSummary {
  provider: CloudProvider;
  rowCount: number;
  periodStart: string | null;
  periodEnd: string | null;
  currencies: string[];
}

/**
 * 1.7.0 adds `consumedQuantity`, without which no cross-provider unit rate can
 * be computed. 1.6.0 adds `chargePeriodEnd` to every row, so relative windows
 * can respect multi-day charge periods instead of assuming daily granularity.
 * 1.5.0 adds `providerName` (multicloud support). Datasets produced before a
 * bump cannot be back-filled here — the column simply is not in the file — so
 * the version gate in `customer-dataset.ts` forces a re-ingest.
 */
export const CUSTOMER_DATASET_SCHEMA_VERSION = "1.7.0";

/**
 * FOCUS columns required for a file to be accepted. Everything else degrades
 * gracefully: a missing optional column disables the insights that need it
 * rather than failing the whole import.
 */
export const REQUIRED_FOCUS_COLUMNS = [
  "ChargePeriodStart",
  "EffectiveCost",
] as const;

/**
 * Legacy (actual/amortized) Cost Management export → FOCUS column mapping.
 * Azure has shipped several header spellings across EA/MCA and portal versions,
 * so each target accepts a list of candidates, tried in order.
 */
export const LEGACY_COLUMN_ALIASES: Record<string, string[]> = {
  ChargePeriodStart: ["Date", "UsageDate", "UsageDateTime"],
  BillingCurrency: ["BillingCurrency", "BillingCurrencyCode", "Currency"],
  EffectiveCost: ["CostInBillingCurrency", "Cost", "PreTaxCost"],
  x_EffectiveCostInUsd: ["CostInUsd", "PreTaxCostInUsd"],
  ListCost: ["PaygCostInBillingCurrency", "PaygCostInUsd"],
  ServiceName: ["ConsumedService", "ServiceFamily", "MeterCategory"],
  SubAccountName: ["SubscriptionName"],
  RegionName: ["ResourceLocation", "Location"],
  ResourceId: ["ResourceId", "InstanceId", "InstanceName"],
  ResourceType: ["ResourceType", "MeterCategory"],
  x_ResourceGroupName: ["ResourceGroup", "ResourceGroupName"],
  Tags: ["Tags"],
  ChargeCategory: ["ChargeType"],
  PricingCategory: ["PricingModel"],
  CommitmentDiscountId: ["ReservationId"],
  PricingUnit: ["UnitOfMeasure"],
  ConsumedQuantity: ["Quantity", "UsageQuantity"],
  x_SkuMeterCategory: ["MeterCategory"],
  x_SkuMeterSubcategory: ["MeterSubCategory"],
};

/** Legacy `ChargeType` → FOCUS `ChargeCategory`. */
export const LEGACY_CHARGE_CATEGORY: Record<string, string> = {
  usage: "Usage",
  purchase: "Purchase",
  refund: "Credit",
  unusedreservation: "Usage",
  unusedsavingsplan: "Usage",
  adjustment: "Adjustment",
  tax: "Tax",
};

/** Legacy `PricingModel` → FOCUS `PricingCategory`. */
export const LEGACY_PRICING_CATEGORY: Record<string, string> = {
  ondemand: "Standard",
  reservation: "Committed",
  savingsplan: "Committed",
  spot: "Dynamic",
};

/** Legacy `PricingModel` → FOCUS `CommitmentDiscountType`. */
export const LEGACY_COMMITMENT_TYPE: Record<string, string> = {
  reservation: "Reservation",
  savingsplan: "Savings Plan",
};

/**
 * Service → FOCUS `ServiceCategory`. Legacy exports have no ServiceCategory
 * column, but the AI cost views filter on "AI and Machine Learning", so the
 * category is derived from the service/meter name. Matching is substring based
 * and case-insensitive; the first match wins.
 */
export const SERVICE_CATEGORY_RULES: Array<[string[], string]> = [
  [
    [
      "openai",
      "cognitive",
      "machine learning",
      "machinelearning",
      "ai services",
      "azure ai",
      "bot service",
      // Additional AI services not captured by the original rules:
      "form recognizer",
      "document intelligence",
      "azure ai search",
      "cognitive search",
      "speech services",
      "translator",
      "language understanding",
      "luis",
      "personalizer",
      "anomaly detector",
      "content moderator",
      "immersive reader",
      "computer vision",
      "face api",
      "video indexer",
    ],
    "AI and Machine Learning",
  ],
  [
    [
      "virtual machine",
      "compute",
      "container",
      "kubernetes",
      "batch",
      "functions",
      "app service",
    ],
    "Compute",
  ],
  [["storage", "backup", "netapp", "data lake"], "Storage"],
  [
    ["sql", "cosmos", "database", "mysql", "postgresql", "mariadb", "redis"],
    "Databases",
  ],
  [
    [
      "network",
      "bandwidth",
      "expressroute",
      "vpn",
      "front door",
      "cdn",
      "load balancer",
      "dns",
    ],
    "Networking",
  ],
  [
    ["monitor", "log analytics", "sentinel", "application insights"],
    "Management and Governance",
  ],
  [["security", "key vault", "defender"], "Security"],
  [
    ["synapse", "data factory", "databricks", "event hub", "stream analytics"],
    "Analytics",
  ],
];

/** Derives a FOCUS ServiceCategory from free-text service / meter names. */
export function deriveServiceCategory(...names: string[]): string {
  const haystack = names.filter(Boolean).join(" ").toLowerCase();
  if (!haystack) return "Other";
  for (const [needles, category] of SERVICE_CATEGORY_RULES) {
    if (needles.some((n) => haystack.includes(n))) return category;
  }
  return "Other";
}

/**
 * Extracts the resource name from a resource identifier.
 *
 * Handles both ARM ids (`/subscriptions/.../virtualMachines/vm01`) and AWS
 * ARNs. Many ARNs carry the name after the last `/`
 * (`arn:aws:route53:::hostedzone/Z087...`), but plenty have no slash at all
 * (`arn:aws:s3:::my-bucket`), where splitting on `/` returns the whole ARN.
 * Falling back to the last `:` segment keeps those readable.
 */
export function resourceNameFromId(resourceId: string): string {
  if (!resourceId) return "";

  const segments = resourceId.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "";

  if (segments.length === 1 && last.includes(":")) {
    const colonParts = last.split(":").filter(Boolean);
    return colonParts[colonParts.length - 1] ?? last;
  }

  return last;
}

/** Extracts the resource group from an ARM resource id. */
export function resourceGroupFromId(resourceId: string): string {
  const match = /\/resourceGroups\/([^/]+)/i.exec(resourceId);
  return match?.[1] ?? "";
}

/**
 * Customers do not agree on how to spell a tag. A single tenant routinely
 * carries `costcenter`, `cost-center`, `cost_center`, `Cost Center` and
 * `costCentre` side by side, because tags are free text applied by different
 * teams over years.
 *
 * Matching one hardcoded spelling silently reports everything as untagged,
 * which in a commercial meeting reads as "you govern nothing" — the worst kind
 * of wrong, because it looks like a finding rather than a bug. So keys are
 * compared with separators and case removed, and genuinely different words
 * (centre, department, business unit) are listed as explicit synonyms.
 */
export const TAG_ALIASES: Record<string, string[]> = {
  "cost-center": [
    "cost-center",
    "cost-centre",
    "costcode",
    "cost-department",
    "chargecode",
    "billingcode",
    "business-unit",
    "bu",
  ],
  env: ["env", "environment", "stage", "deployment-environment"],
  owner: ["owner", "owned-by", "owner-email", "technical-owner", "application-owner", "contact"],
};

/** Lower-cases and strips separators so `Cost Center` == `cost-center`. */
function canonicalTagKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Resolves a logical tag (see `TAG_ALIASES`) to the value the row actually
 * carries, trying each alias in order. Returns "" when none is present.
 */
export function lookupTag(
  tags: Record<string, string>,
  logicalKey: keyof typeof TAG_ALIASES | string,
): string {
  const aliases = TAG_ALIASES[logicalKey] ?? [logicalKey];

  // Index the row's tags once by canonical form, so `Cost Center`, `costcenter`
  // and `cost_center` all collapse onto the same lookup.
  const byCanonical = new Map<string, string>();
  for (const [key, value] of Object.entries(tags)) {
    const canonical = canonicalTagKey(key);
    if (!byCanonical.has(canonical) && value) byCanonical.set(canonical, value);
  }

  for (const alias of aliases) {
    const value = byCanonical.get(canonicalTagKey(alias));
    if (value) return value;
  }
  return "";
}
