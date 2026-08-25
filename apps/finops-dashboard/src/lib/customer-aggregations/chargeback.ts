import type {
  ChargebackByBU,
  ChargebackKpi,
  ChargebackTrendPoint,
} from "../types";
import type { CustomerCostRow } from "../customer-data/contract";
import { lookupTag } from "../customer-data/contract";
import type { AggregationContext } from "./context";
import { groupEntries, round2, sumBy } from "./filters";

/** In-memory equivalents of `src/lib/queries/chargeback.ts`. */

/**
 * The tag that identifies the business unit paying for a resource. Resolved
 * through `lookupTag`, because real tenants spell it a dozen different ways.
 */
const BU_TAG = "cost-center";

function businessUnitOf(row: CustomerCostRow): string {
  return lookupTag(row.tags, BU_TAG);
}

/** Mirrors `chargebackKpiKql`, plus `topBU` which the route leaves empty in ADX mode. */
export function aggregateChargebackKpi(
  ctx: AggregationContext,
): ChargebackKpi {
  const allocated = ctx.rows.filter((r) => businessUnitOf(r) !== "");
  const totalAllocated = sumBy(allocated, ctx.cost);
  const untaggedCost = sumBy(
    ctx.rows.filter((r) => businessUnitOf(r) === ""),
    ctx.cost,
  );

  let topBU = "";
  let topCost = 0;
  for (const [bu, rows] of groupEntries(allocated, businessUnitOf)) {
    const cost = sumBy(rows, ctx.cost);
    if (cost > topCost) {
      topCost = cost;
      topBU = bu;
    }
  }

  return {
    totalAllocated: round2(totalAllocated),
    untaggedCost: round2(untaggedCost),
    businessUnits: new Set(allocated.map(businessUnitOf)).size,
    topBU,
  };
}

/** Mirrors `chargebackByBuKql`. */
export function aggregateChargebackByBu(
  ctx: AggregationContext,
): ChargebackByBU[] {
  // The KQL computes the percentage against the unfiltered grand total.
  const totalCost = sumBy(ctx.rows, ctx.cost);
  const allocated = ctx.rows.filter((r) => businessUnitOf(r) !== "");

  return groupEntries(allocated, businessUnitOf)
    .map(([businessUnit, rows]) => {
      const cost = sumBy(rows, ctx.cost);
      return {
        businessUnit,
        cost: round2(cost),
        percentage: totalCost > 0 ? Math.round((cost / totalCost) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.cost - a.cost);
}

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Formats `YYYY-MM-DD` as `MMM/yy`, matching `format_datetime(..., 'MMM/yy')`. */
function monthLabel(isoDate: string): string {
  const month = Number(isoDate.slice(5, 7));
  return `${MONTH_LABELS[month - 1]}/${isoDate.slice(2, 4)}`;
}

/** Mirrors `chargebackTrendKql`, already pivoted as the route expects. */
export function aggregateChargebackTrend(
  ctx: AggregationContext,
): ChargebackTrendPoint[] {
  const allocated = ctx.rows.filter((r) => businessUnitOf(r) !== "");

  // Keyed by the sortable `YYYY-MM` so the output stays chronological, which
  // the `MMM/yy` label alone would not guarantee.
  const byMonth = new Map<string, ChargebackTrendPoint>();

  for (const row of allocated) {
    const key = row.chargePeriodStart.slice(0, 7);
    const point =
      byMonth.get(key) ?? ({ month: monthLabel(row.chargePeriodStart) } as ChargebackTrendPoint);
    const bu = businessUnitOf(row);
    point[bu] = ((point[bu] as number | undefined) ?? 0) + ctx.cost(row);
    byMonth.set(key, point);
  }

  return Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, point]) => {
      for (const [key, value] of Object.entries(point)) {
        if (key !== "month") point[key] = round2(value as number);
      }
      return point;
    });
}