import type {
  BudgetBurnRate,
  BudgetBySubscription,
  BudgetVsActualPoint,
  ForecastConfidencePoint,
  ForecastPoint,
} from "../types";
import { getCustomerAssessment } from "../customer-assessment";
import { getCustomerDataset } from "../customer-dataset";
import type { BudgetEvidenceRow } from "../customer-data/assessment-evidence";
import type { AggregationContext } from "./context";
import {
  addDays,
  daysBetween,
  round2,
  startOfMonth,
  sumBy,
} from "./filters";

/**
 * In-memory equivalents of `src/lib/queries/budgets.ts`.
 *
 * A Cost Export carries no budgets, but the assessment snapshot may include
 * collected budget evidence from Azure Cost Management. When that evidence is
 * absent, callers can still supply the dashboard's current fallback budget.
 *
 * Fields neutralised because they require a real budget:
 *   - BudgetVsActualPoint.cumulativeBudget   → 0 when no collected or fallback budget exists
 *   - ForecastPoint.dailyBudgetTarget        → 0 when no collected or fallback budget exists
 *   - BudgetBurnRate.budget                  → 0 when no collected or fallback budget exists
 *   - BudgetBurnRate.budgetVariance          → 0 when no collected or fallback budget exists
 *   - BudgetBurnRate.budgetUsedPercent       → 0 when no collected or fallback budget exists
 *   - BudgetBurnRate.status                  → "NO_BUDGET" when no collected or fallback budget exists
 *   - BudgetBySubscription.percentOfBudget   → 0 when no collected or fallback budget exists
 *
 * Fields legitimately derived from actual spend:
 *   - BudgetVsActualPoint.dailyCost          → real daily cost
 *   - BudgetVsActualPoint.cumulativeActual   → running cumulative per month
 *   - ForecastPoint.dailyCost                → real historical daily cost
 *   - ForecastPoint.dailyForecast            → run-rate projection (see below)
 *   - ForecastConfidencePoint.actual         → real historical daily cost
 *   - ForecastConfidencePoint.forecast       → run-rate projection
 *   - ForecastConfidencePoint.lowerBound/upperBound → ±15% of forecast
 *   - BudgetBurnRate.spentSoFar              → MTD spend in dataset's last month
 *   - BudgetBurnRate.dailyBurnRate           → average daily cost, last 14 days
 *   - BudgetBurnRate.projectedMonthEnd       → spentSoFar + burn * remaining days
 *   - BudgetBySubscription.cost             → real cost in dataset's last month
 */

/**
 * Returns the window covering the dataset's last (possibly partial) month.
 * "Month to date" is anchored to the dataset, never to the wall clock.
 */
function lastMonthWindow(ctx: AggregationContext): {
  from: string;
  to: string;
} {
  const from = startOfMonth(ctx.anchor);
  const to = addDays(ctx.anchor, 1); // exclusive
  return { from, to };
}

function subscriptionIdFromResourceId(resourceId: string): string {
  const match = resourceId.match(/\/subscriptions\/([^/]+)/i);
  return match?.[1]?.trim().toLowerCase() ?? "";
}

function subscriptionNamesById(customerSlug?: string): Map<string, string> {
  const names = new Map<string, string>();
  const dataset = getCustomerDataset(customerSlug);
  if (!dataset) return names;

  for (const row of dataset.rows) {
    const id = subscriptionIdFromResourceId(row.resourceId);
    const name = row.subAccountName.trim();
    if (id && name && !names.has(id)) {
      names.set(id, name);
    }
  }

  return names;
}

function overlapsAnchorMonth(anchor: string, row: BudgetEvidenceRow): boolean {
  const start = row.startDateUtc.slice(0, 10);
  const end = row.endDateUtc.slice(0, 10);
  const monthStart = startOfMonth(anchor);
  const nextMonthStart = startOfMonth(addDays(anchor, 32));
  return start < nextMonthStart && (end === "" || end >= monthStart);
}

function activeMonthlyBudgets(
  anchor: string,
  customerSlug?: string,
): BudgetEvidenceRow[] {
  return (getCustomerAssessment(customerSlug)?.budgets ?? []).filter(
    (row) =>
      row.amount > 0 &&
      row.timeGrain.trim().toLowerCase() === "monthly" &&
      overlapsAnchorMonth(anchor, row),
  );
}

export interface BudgetAllocation {
  totalBudget: number;
  bySubscription: Map<string, number>;
  usingCollectedBudgets: boolean;
}

export function resolveBudgetAllocation(
  ctx: AggregationContext,
  fallbackBudget = 0,
): BudgetAllocation {
  const collected = activeMonthlyBudgets(ctx.anchor, ctx.customerSlug);
  if (collected.length === 0) {
    return {
      totalBudget: fallbackBudget,
      bySubscription: new Map<string, number>(),
      usingCollectedBudgets: false,
    };
  }

  const namesById = subscriptionNamesById(ctx.customerSlug);
  const scopedFilters =
    ctx.filters.subscriptions.length > 0 ||
    ctx.filters.regions.length > 0 ||
    ctx.filters.services.length > 0 ||
    ctx.filters.resourceGroups.length > 0 ||
    ctx.filters.tags.length > 0;
  const filteredIds = new Set<string>();
  const filteredNames = new Set<string>();
  const requestedSubscriptions = new Set(
    ctx.filters.subscriptions
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );

  for (const row of ctx.rows) {
    const id = subscriptionIdFromResourceId(row.resourceId);
    if (id) filteredIds.add(id);
    if (row.subAccountName.trim()) {
      filteredNames.add(row.subAccountName.trim().toLowerCase());
    }
  }

  const selectedById = new Map<string, BudgetEvidenceRow>();
  for (const budget of collected) {
    const subscriptionId = budget.subscriptionId.trim().toLowerCase();
    const subscriptionName =
      namesById.get(subscriptionId) ?? budget.subscriptionId.trim();
    const matchesFilters =
      !scopedFilters ||
      filteredIds.has(subscriptionId) ||
      filteredNames.has(subscriptionName.toLowerCase()) ||
      requestedSubscriptions.has(subscriptionId) ||
      requestedSubscriptions.has(subscriptionName.toLowerCase());

    if (!matchesFilters) continue;

    const current = selectedById.get(subscriptionId);
    if (!current || budget.amount > current.amount) {
      selectedById.set(subscriptionId, budget);
    }
  }

  const bySubscription = new Map<string, number>();
  let totalBudget = 0;

  for (const [subscriptionId, budget] of Array.from(selectedById.entries())) {
    const subscriptionName =
      namesById.get(subscriptionId) ?? budget.subscriptionId.trim();
    bySubscription.set(subscriptionName, round2(budget.amount));
    totalBudget += budget.amount;
  }

  return {
    totalBudget: round2(totalBudget),
    bySubscription,
    usingCollectedBudgets: true,
  };
}

function budgetStatus(
  spentSoFar: number,
  projectedMonthEnd: number,
  budget: number,
): BudgetBurnRate["status"] {
  if (budget <= 0) return "NO_BUDGET";
  if (spentSoFar > budget) return "EXCEEDED";
  if (projectedMonthEnd > budget) return "AT_RISK";
  return "ON_TRACK";
}

// ---------------------------------------------------------------------------
// Mirrors `budgetVsActual` KQL.
//
// KQL builds a daily cumulative series for the current month vs. a flat budget
// line. Here we reproduce the daily and cumulative actual spend, using a
// collected monthly budget when one is available.
// ---------------------------------------------------------------------------
export function aggregateBudgetVsActual(
  ctx: AggregationContext,
  fallbackBudget = 0,
): BudgetVsActualPoint[] {
  const { from, to } = lastMonthWindow(ctx);
  const rows = ctx.between(from, to);
  const { totalBudget } = resolveBudgetAllocation(ctx, fallbackBudget);
  const nextMonth = startOfMonth(addDays(ctx.anchor, 32));
  const totalDaysInMonth = daysBetween(from, addDays(nextMonth, -1));
  const dailyBudget =
    totalBudget > 0 && totalDaysInMonth > 0 ? totalBudget / totalDaysInMonth : 0;

  // Group by day, preserving order.
  const byDay = new Map<string, number>();
  for (const row of rows) {
    const day = row.chargePeriodStart;
    byDay.set(day, (byDay.get(day) ?? 0) + ctx.cost(row));
  }

  let cumulative = 0;
  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, dailyCost], index) => {
      cumulative += dailyCost;
      return {
        day: `${day}T00:00:00Z`,
        dailyCost: round2(dailyCost),
        cumulativeActual: round2(cumulative),
        cumulativeBudget: round2(dailyBudget * (index + 1)),
      };
    });
}

// ---------------------------------------------------------------------------
// Forecast method: simple run-rate projection.
//
// The last 14 days of the dataset are used to compute an average daily cost
// (avoiding the partial-month distortion that would affect a monthly average).
// Historical days are populated with real cost; future days (from anchor+1 to
// end of the anchor's month) use that daily rate.
//
// This is intentionally conservative and documentable to a customer:
//   "Projected spend = recent 14-day average × remaining days in the month."
// No budget comparison is possible without budget data.
// ---------------------------------------------------------------------------

/** Mirrors `forecastVsBudget` KQL. */
export function aggregateForecast(
  ctx: AggregationContext,
  fallbackBudget = 0,
): ForecastPoint[] {
  const { from, to } = lastMonthWindow(ctx);
  const { totalBudget } = resolveBudgetAllocation(ctx, fallbackBudget);

  // Compute daily rate from the last 14 days (capped to available data).
  const lookback = 14;
  const recentRows = ctx.lastDays(lookback);
  const recentCost = sumBy(recentRows, ctx.cost);
  // Number of distinct days present in the lookback window.
  const distinctDays = new Set(recentRows.map((r) => r.chargePeriodStart)).size;
  const dailyRate = distinctDays > 0 ? recentCost / distinctDays : 0;

  // Build a map of actual daily spend for the current month.
  const monthRows = ctx.between(from, to);
  const actualByDay = new Map<string, number>();
  for (const row of monthRows) {
    const d = row.chargePeriodStart;
    actualByDay.set(d, (actualByDay.get(d) ?? 0) + ctx.cost(row));
  }

  // Enumerate all days in the month from `from` to end of month.
  const nextMonth = startOfMonth(addDays(ctx.anchor, 32));
  const totalDaysInMonth = daysBetween(from, addDays(nextMonth, -1));
  const dailyBudgetTarget =
    totalBudget > 0 && totalDaysInMonth > 0 ? round2(totalBudget / totalDaysInMonth) : 0;
  const points: ForecastPoint[] = [];

  for (let i = 0; i < totalDaysInMonth; i += 1) {
    const day = addDays(from, i);
    if (day >= nextMonth) break;
    const isHistorical = day <= ctx.anchor;
    const actual = actualByDay.get(day) ?? null;

    points.push({
      day: `${day}T00:00:00Z`,
      dailyCost: isHistorical ? (actual !== null ? round2(actual) : null) : null,
      dailyForecast: !isHistorical ? round2(dailyRate) : null,
      dailyBudgetTarget,
    });
  }

  return points;
}

/** Mirrors `forecastWithConfidence` KQL (budget fields neutralised). */
export function aggregateForecastConfidence(
  ctx: AggregationContext,
): ForecastConfidencePoint[] {
  const { from } = lastMonthWindow(ctx);

  // Same run-rate computation as above.
  const lookback = 14;
  const recentRows = ctx.lastDays(lookback);
  const recentCost = sumBy(recentRows, ctx.cost);
  const distinctDays = new Set(recentRows.map((r) => r.chargePeriodStart)).size;
  const dailyRate = distinctDays > 0 ? recentCost / distinctDays : 0;

  const monthRows = ctx.between(from, addDays(ctx.anchor, 1));
  const actualByDay = new Map<string, number>();
  for (const row of monthRows) {
    const d = row.chargePeriodStart;
    actualByDay.set(d, (actualByDay.get(d) ?? 0) + ctx.cost(row));
  }

  const nextMonth = startOfMonth(addDays(ctx.anchor, 32));
  const totalDaysInMonth = daysBetween(from, addDays(nextMonth, -1));
  const points: ForecastConfidencePoint[] = [];

  for (let i = 0; i < totalDaysInMonth; i += 1) {
    const day = addDays(from, i);
    if (day >= nextMonth) break;
    const isHistorical = day <= ctx.anchor;
    const actual = actualByDay.get(day) ?? null;
    // Confidence band: ±15% of the forecast rate. This is a simple,
    // defensible interval for a POC; it does not claim statistical accuracy.
    const lower = round2(dailyRate * 0.85);
    const upper = round2(dailyRate * 1.15);

    points.push({
      day: `${day}T00:00:00Z`,
      actual: isHistorical ? (actual !== null ? round2(actual) : null) : null,
      forecast: round2(dailyRate),
      lowerBound: lower,
      upperBound: upper,
    });
  }

  return points;
}

// ---------------------------------------------------------------------------
// Mirrors `budgetBySubscription` KQL.
// Real cost per subscription for the dataset's current month.
// percentOfBudget is 0 — no budget is available.
// ---------------------------------------------------------------------------
export function aggregateBudgetBySubscription(
  ctx: AggregationContext,
  fallbackBudget = 0,
): BudgetBySubscription[] {
  const { from, to } = lastMonthWindow(ctx);
  const rows = ctx.between(from, to);
  const allocation = resolveBudgetAllocation(ctx, fallbackBudget);
  const costBySubscription = new Map<string, number>();

  for (const row of rows) {
    costBySubscription.set(
      row.subAccountName,
      (costBySubscription.get(row.subAccountName) ?? 0) + ctx.cost(row),
    );
  }

  const subscriptions = new Set<string>([
    ...Array.from(costBySubscription.keys()),
    ...Array.from(allocation.bySubscription.keys()),
  ]);

  return Array.from(subscriptions)
    .map((subscriptionName) => {
      const cost = round2(costBySubscription.get(subscriptionName) ?? 0);
      const budget = allocation.usingCollectedBudgets
        ? (allocation.bySubscription.get(subscriptionName) ?? 0)
        : allocation.totalBudget;
      return {
        subscriptionName,
        cost,
        percentOfBudget: budget > 0 ? round2((cost / budget) * 100) : 0,
      };
    })
    .sort((a, b) => b.cost - a.cost);
}

// ---------------------------------------------------------------------------
// Mirrors `budgetBurnRate` KQL.
//
// What IS derivable:
//   - spentSoFar: MTD spend in the dataset's anchor month
//   - dailyBurnRate: average daily cost over the last 14 days (avoids the
//     partial-final-month trap: the last month of the export is often
//     incomplete, so a simple monthly average would understate the rate)
//   - projectedMonthEnd: spentSoFar + dailyBurnRate × remaining days
//
// What is NOT derivable (no budget in the export):
//   - budget, budgetVariance, budgetUsedPercent, status
// ---------------------------------------------------------------------------
export function aggregateBurnRate(
  ctx: AggregationContext,
  fallbackBudget = 0,
): BudgetBurnRate {
  const { from, to } = lastMonthWindow(ctx);
  const mtdRows = ctx.between(from, to);
  const spentSoFar = round2(sumBy(mtdRows, ctx.cost));
  const { totalBudget } = resolveBudgetAllocation(ctx, fallbackBudget);

  // Daily burn rate: 14-day window anchored to the dataset.
  const lookback = 14;
  const recentRows = ctx.lastDays(lookback);
  const recentCost = sumBy(recentRows, ctx.cost);
  const distinctDays = new Set(recentRows.map((r) => r.chargePeriodStart)).size;
  const dailyBurnRate = round2(distinctDays > 0 ? recentCost / distinctDays : 0);

  // Remaining days in the anchor month (exclusive of days already spent).
  const nextMonth = startOfMonth(addDays(ctx.anchor, 32));
  const lastDayOfMonth = addDays(nextMonth, -1);
  const remainingDays = daysBetween(ctx.anchor, lastDayOfMonth) - 1; // -1: today is counted in spentSoFar

  const projectedMonthEnd = round2(spentSoFar + dailyBurnRate * remainingDays);
  const budgetVariance =
    totalBudget > 0 ? round2(projectedMonthEnd - totalBudget) : 0;
  const budgetUsedPercent =
    totalBudget > 0 ? round2((spentSoFar / totalBudget) * 100) : 0;

  return {
    spentSoFar,
    dailyBurnRate,
    projectedMonthEnd,
    budget: round2(totalBudget),
    budgetVariance,
    budgetUsedPercent,
    status: budgetStatus(spentSoFar, projectedMonthEnd, totalBudget),
  };
}
