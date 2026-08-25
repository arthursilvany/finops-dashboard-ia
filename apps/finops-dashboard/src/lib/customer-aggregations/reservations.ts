import type {
  ReservationFilterOptions,
  ReservationRow,
  ReservationTrendPoint,
} from "../types";
import type { CustomerCostRow } from "../customer-data/contract";
import type { AggregationContext } from "./context";
import { groupEntries, monthOf, round2, sumBy } from "./filters";

/**
 * In-memory equivalents of `src/lib/queries/reservations.ts`.
 *
 * What a Cost Export genuinely provides:
 *  - CommitmentDiscountId, CommitmentDiscountName, CommitmentDiscountType,
 *    CommitmentDiscountStatus (Used / Unused), PricingCategory = "Committed".
 *  - CommitmentDiscountCategory (Usage | Spend).
 *  - x_SkuTerm — the commitment term in months. Azure's FOCUS export does emit
 *    this (verified against a real export: "36" for a 3-year reservation).
 *
 * What is NOT in a Cost Export (and therefore neutralised):
 *  - upfrontPaid / consumed — upfront payment rows are not present in an
 *    amortised Cost Export. Set to 0.
 *  - Purchase recommendations (options) — those come from Azure Advisor /
 *    Reservation Recommendations API, not from a Cost Export. See
 *    aggregateReservationOptions below.
 */

/**
 * Renders `x_SkuTerm` (a month count) the way the portal states terms. Anything
 * unrecognised is passed through as-is rather than guessed at, and a missing
 * value stays blank.
 */
function termLabel(skuTerm: string): string {
  const months = Number(skuTerm);
  if (!skuTerm || !Number.isFinite(months) || months <= 0) return skuTerm || "";
  if (months % 12 === 0) {
    const years = months / 12;
    return `${years} ${years === 1 ? "Year" : "Years"}`;
  }
  return `${months} Months`;
}

/** Usage rows that belong to a commitment. */
function commitmentUsageRows(ctx: AggregationContext): CustomerCostRow[] {
  return ctx.rows.filter(
    (r) =>
      r.chargeCategory === "Usage" &&
      r.pricingCategory === "Committed" &&
      r.commitmentDiscountId !== "",
  );
}

/**
 * Resolves the Used/Unused status for a row. After the normalize.ts fix, this
 * is already set correctly for both FOCUS and legacy exports (legacy derivation
 * from ChargeType happens at ingest time). This helper is kept as a named
 * function for readability and to make the aggregation intent explicit.
 */
function effectiveStatus(row: CustomerCostRow): string {
  return row.commitmentDiscountStatus;
}

/**
 * Mirrors `reservationDetail`.
 *
 * Groups by commitmentDiscountId and sums Used / Unused costs. The KQL KPI
 * `Days` is the number of distinct days with any row for that commitment.
 *
 * `term` is set to "" because x_SkuTerm is not present in a Cost Export.
 * `resourceType` uses the FOCUS `resourceType` column, which is populated for
 * most VM/SQL reservations but may be empty for Savings Plan rows.
 * `upfrontPaid` and `consumed` are set to 0 — an amortised export does not
 * include the Purchase row, so there is no reliable upfront cost.
 */
export function aggregateReservationDetail(
  ctx: AggregationContext,
  params?: {
    commitmentName?: string;
    resourceType?: string;
    commitmentType?: string;
  },
): ReservationRow[] {
  let rows = commitmentUsageRows(ctx);

  if (params?.commitmentType) {
    const ct = params.commitmentType.toLowerCase();
    rows = rows.filter(
      (r) => r.commitmentDiscountType.toLowerCase() === ct,
    );
  }
  if (params?.resourceType) {
    const rt = params.resourceType.toLowerCase();
    rows = rows.filter((r) => r.resourceType.toLowerCase() === rt);
  }
  if (params?.commitmentName) {
    const cn = params.commitmentName.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.commitmentDiscountId.toLowerCase().includes(cn) ||
        r.resourceName.toLowerCase().includes(cn),
    );
  }

  return groupEntries(rows, (r) => r.commitmentDiscountId)
    .map(([id, grp]) => {
      const used = sumBy(
        grp.filter((r) => effectiveStatus(r) === "Used"),
        ctx.cost,
      );
      const unused = sumBy(
        grp.filter((r) => effectiveStatus(r) === "Unused"),
        ctx.cost,
      );
      const total = used + unused;
      const utilization =
        total > 0 ? Math.round((used / total) * 1000) / 10 : 0;
      const days = new Set(grp.map((r) => r.chargePeriodStart)).size;
      const first = grp[0];
      return {
        commitmentName: first.commitmentDiscountName || first.resourceName || id,
        commitmentId: id,
        commitmentType: first.commitmentDiscountType,
        // Azure's FOCUS export does carry x_SkuTerm, in months. Render it as a
        // term when present and leave it blank otherwise, rather than guessing.
        term: termLabel(first.skuTerm),
        resourceType: first.resourceType,
        // upfrontPaid/consumed: amortised export has no Purchase rows; set 0.
        upfrontPaid: 0,
        consumed: 0,
        used: round2(used),
        unused: round2(unused),
        utilization,
        days,
      };
    })
    .sort((a, b) => b.unused - a.unused);
}

/**
 * Mirrors `reservationTrend`.
 *
 * Groups commitment usage by month (anchored to the dataset, not wall clock),
 * summing Used and Unused cost per month. Months are ordered ascending.
 */
export function aggregateReservationTrend(
  ctx: AggregationContext,
  params?: { commitmentName?: string; commitmentType?: string },
): ReservationTrendPoint[] {
  let rows = commitmentUsageRows(ctx);

  if (params?.commitmentType) {
    const ct = params.commitmentType.toLowerCase();
    rows = rows.filter(
      (r) => r.commitmentDiscountType.toLowerCase() === ct,
    );
  }
  if (params?.commitmentName) {
    const cn = params.commitmentName.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.commitmentDiscountId.toLowerCase().includes(cn) ||
        r.resourceName.toLowerCase().includes(cn),
    );
  }

  return groupEntries(rows, (r) => monthOf(r.chargePeriodStart))
    .map(([month, grp]) => ({
      month,
      used: round2(
        sumBy(
          grp.filter((r) => effectiveStatus(r) === "Used"),
          ctx.cost,
        ),
      ),
      unused: round2(
        sumBy(
          grp.filter((r) => effectiveStatus(r) === "Unused"),
          ctx.cost,
        ),
      ),
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Mirrors `reservationFilterOptions`.
 *
 * Returns distinct commitment IDs (as "names"), resource types, and commitment
 * types observed in the export. Sorted alphabetically.
 *
 * NOTE: Purchase recommendations (the "options" in the route name) require
 * Azure Advisor / Reservation Recommendations API and are NOT derivable from a
 * Cost Export. This function derives what the export genuinely supports:
 * the filter-picker values for detail and trend. Any field that would require
 * Advisor or a price sheet is omitted.
 */
export function aggregateReservationOptions(
  ctx: AggregationContext,
): ReservationFilterOptions {
  const rows = ctx.rows.filter(
    (r) =>
      r.chargeCategory === "Usage" &&
      r.pricingCategory === "Committed" &&
      r.commitmentDiscountId !== "",
  );

  const namesSet = new Set<string>();
  const resourceTypesSet = new Set<string>();
  const commitmentTypesSet = new Set<string>();

  for (const r of rows) {
    namesSet.add(r.resourceName || r.commitmentDiscountId);
    if (r.resourceType) resourceTypesSet.add(r.resourceType);
    if (r.commitmentDiscountType) commitmentTypesSet.add(r.commitmentDiscountType);
  }

  return {
    commitmentNames: Array.from(namesSet).sort(),
    resourceTypes: Array.from(resourceTypesSet).sort(),
    commitmentTypes: Array.from(commitmentTypesSet).sort(),
  };
}
