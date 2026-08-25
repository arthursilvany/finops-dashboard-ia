import type { CustomerCostRow } from "../customer-data/contract";
import type { ParsedFilters } from "../filter-schema";

/**
 * In-memory equivalent of `queries/filter-builder.ts`. Any change to the KQL
 * filter semantics must be mirrored here so the POC and production views agree.
 */

function toSet(values: string[]): Set<string> | null {
  const cleaned = values.map((v) => v.trim().toLowerCase()).filter(Boolean);
  return cleaned.length > 0 ? new Set(cleaned) : null;
}

/**
 * Days a charge period shares with an inclusive `[from, to]` date range, over
 * the length of that period. 1 means fully inside, 0 means disjoint.
 *
 * Charge periods are not always a single day — an AWS export bills a whole
 * month on one row — so a range that clips such a period must keep the share
 * of the money that falls inside it rather than take all of it or none.
 */
function rangeOverlapFactor(
  row: CustomerCostRow,
  from: string | null,
  to: string | null,
): number {
  const start = row.chargePeriodStart;
  const end = row.chargePeriodEnd;
  const windowStart = from && from > start ? from : start;
  const windowEnd = to && addDays(to, 1) < end ? addDays(to, 1) : end;
  if (windowStart >= windowEnd) return 0;

  const span = spanDays(start, end);
  if (span <= 0) return 1;
  const overlap = spanDays(windowStart, windowEnd);
  return overlap >= span ? 1 : overlap / span;
}

/**
 * Scales the money on a row *and* the quantity that money bought; every other
 * field is left untouched.
 *
 * The quantity has to move with the cost. A unit rate is cost ÷ quantity, so
 * prorating only the numerator would inflate every rate by 1/factor on exactly
 * the rows that straddle a window boundary — the multi-day AWS rows this
 * function exists to handle.
 */
function prorateCost(row: CustomerCostRow, factor: number): CustomerCostRow {
  if (factor === 1) return row;
  return {
    ...row,
    effectiveCost: row.effectiveCost * factor,
    listCost: row.listCost * factor,
    contractedCost: row.contractedCost * factor,
    effectiveCostInUsd: row.effectiveCostInUsd * factor,
    consumedQuantity: row.consumedQuantity * factor,
  };
}

/**
 * Days in the half-open interval `[from, toExclusive)`.
 *
 * Distinct from `daysBetween`, which is inclusive of both ends. Charge periods
 * are half-open — a one-day charge runs `[May 1, May 2)` — so period maths must
 * not add the extra day.
 */
export function spanDays(from: string, toExclusive: string): number {
  return Math.round(
    (Date.parse(`${toExclusive}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}

/**
 * Rows whose charge period overlaps the half-open window `[from, toExclusive)`,
 * each carrying the share of its cost that falls inside.
 *
 * This is the single definition of window membership. Deciding it from
 * `chargePeriodStart` alone works only while every row covers exactly one day,
 * which is true of Azure Cost Exports and false of AWS Data Exports — there a
 * row dated the 1st can bill the whole month, and a start-date test dropped it
 * from every window that did not begin on that exact day.
 */
export function rowsOverlapping(
  rows: CustomerCostRow[],
  from: string,
  toExclusive: string,
): CustomerCostRow[] {
  const window: CustomerCostRow[] = [];
  for (const row of rows) {
    const { chargePeriodStart: start, chargePeriodEnd: end } = row;
    if (start >= from && end <= toExclusive) {
      window.push(row);
      continue;
    }
    const overlapStart = start > from ? start : from;
    const overlapEnd = end < toExclusive ? end : toExclusive;
    if (overlapStart >= overlapEnd) continue;

    const span = spanDays(start, end);
    window.push(
      span > 0
        ? prorateCost(row, spanDays(overlapStart, overlapEnd) / span)
        : row,
    );
  }
  return window;
}

export function applyFilters(
  rows: CustomerCostRow[],
  filters: ParsedFilters,
): CustomerCostRow[] {
  const dateFrom = filters.dateFrom?.slice(0, 10) || null;
  const dateTo = filters.dateTo?.slice(0, 10) || null;
  const providers = toSet(filters.providers);
  const subscriptions = toSet(filters.subscriptions);
  const regions = toSet(filters.regions);
  const services = toSet(filters.services);
  const resourceGroups = toSet(filters.resourceGroups);
  const tagFilters = filters.tags
    .map((tag) => ({
      key: tag.key.trim().toLowerCase(),
      values: toSet(tag.values),
    }))
    .filter((tag) => tag.key && tag.values);

  const dateFiltered = !dateFrom && !dateTo ? null : true;

  const matched = rows.filter((row) => {
    if (dateFiltered && rangeOverlapFactor(row, dateFrom, dateTo) === 0) {
      return false;
    }
    if (providers && !providers.has(row.providerName.toLowerCase())) return false;
    if (subscriptions && !subscriptions.has(row.subAccountName.toLowerCase())) {
      return false;
    }
    if (regions && !regions.has(row.regionName.toLowerCase())) return false;
    if (services && !services.has(row.serviceName.toLowerCase())) return false;
    if (
      resourceGroups &&
      !resourceGroups.has(row.resourceGroupName.toLowerCase())
    ) {
      return false;
    }
    for (const tag of tagFilters) {
      const value = row.tags[tag.key];
      if (!value || !tag.values!.has(value.toLowerCase())) return false;
    }
    return true;
  });

  if (!dateFiltered) return matched;
  return matched.map((row) =>
    prorateCost(row, rangeOverlapFactor(row, dateFrom, dateTo)),
  );
}

/** In-memory equivalent of `costColumn()` in `filter-builder.ts`. */
export function costOf(row: CustomerCostRow, currency: string): number {
  return currency === "usd" ? row.effectiveCostInUsd : row.effectiveCost;
}

/** Sums a numeric projection over rows. */
export function sumBy<T>(items: T[], project: (item: T) => number): number {
  let total = 0;
  for (const item of items) total += project(item);
  return total;
}

/** Groups rows by a string key, preserving first-seen order. */
export function groupBy<T>(
  items: T[],
  keyOf: (item: T) => string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

/**
 * `groupBy` as an array of entries. Used instead of spreading the Map because
 * the project targets ES5 without `downlevelIteration`.
 */
export function groupEntries<T>(
  items: T[],
  keyOf: (item: T) => string,
): Array<[string, T[]]> {
  return Array.from(groupBy(items, keyOf).entries());
}

/** Rounds to two decimals, matching the `round(..., 2)` used across the KQL. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Adds `days` to an ISO date string (`YYYY-MM-DD`). */
export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Inclusive day count between two ISO dates. */
export function daysBetween(from: string, to: string): number {
  const ms =
    new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/** Month key (`YYYY-MM`) used by the monthly trend aggregations. */
export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** First day of the month containing `isoDate`. */
export function startOfMonth(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

/** Adds `months` to an ISO date, snapping to the first day of the month. */
export function addMonths(isoDate: string, months: number): string {
  const date = new Date(`${startOfMonth(isoDate)}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

/**
 * Start of the most recent *complete* month at the anchor.
 *
 * The KQL mirrors a live FinOps Hub, where `startofmonth(now())` is always a
 * partial month and "last month" is therefore the last complete one. A customer
 * Cost Export is a snapshot that usually ends exactly on a month boundary, so
 * applying the same arithmetic literally would treat a finished month as "in
 * progress" and report the month before it — presenting May/June figures while
 * a complete July sits in the data. This preserves the intent instead: if the
 * anchor is the last day of its month, that month is complete.
 */
export function lastCompleteMonthStart(anchor: string): string {
  const monthStart = startOfMonth(anchor);
  const nextMonthStart = addMonths(monthStart, 1);
  const lastDayOfAnchorMonth = addDays(nextMonthStart, -1);

  return anchor >= lastDayOfAnchorMonth ? monthStart : addMonths(monthStart, -1);
}

/**
 * The KQL uses `now()` / `ago(30d)` because the FinOps Hub is refreshed daily.
 * A customer Cost Export is a historical snapshot — anchoring to the wall clock
 * would render every "last 30 days" panel empty a month after the export was
 * taken. The anchor is therefore the latest charge date in the dataset, which
 * makes the relative windows behave exactly as they do in production.
 */
export function datasetAnchor(rows: { chargePeriodStart: string }[]): string {
  let latest = "";
  for (const row of rows) {
    if (row.chargePeriodStart > latest) latest = row.chargePeriodStart;
  }
  return latest || new Date().toISOString().slice(0, 10);
}
