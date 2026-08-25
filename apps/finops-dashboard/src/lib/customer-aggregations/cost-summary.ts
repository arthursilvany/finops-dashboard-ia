import type {
  CostOverTimePoint,
  CostSummaryKpi,
  DailyCostByCategory,
  DailyCostPoint,
  KpiSummary,
  MiniKpiGauge,
  PricingModelBreakdown,
  ProviderCost,
  ServiceBreakdown,
  ServiceTrendItem,
  SubscriptionCost,
} from "../types";
import type { AggregationContext } from "./context";
import {
  addDays,
  addMonths,
  groupBy,
  groupEntries,
  lastCompleteMonthStart,
  round2,
  startOfMonth,
  sumBy,
} from "./filters";

/**
 * In-memory equivalents of `src/lib/queries/cost-summary.ts`.
 *
 * Each function names the KQL it mirrors. When a query changes, its aggregator
 * must change with it, otherwise the POC view and the production view diverge.
 */

/** Mirrors `kpiSummaryQuery`. */
export function aggregateKpiSummary(ctx: AggregationContext): KpiSummary {
  const lastMonthStart = lastCompleteMonthStart(ctx.anchor);
  const thisMonthStart = addMonths(lastMonthStart, 1);
  const prevMonthStart = addMonths(lastMonthStart, -1);

  const lastMonth = ctx.between(lastMonthStart, thisMonthStart);
  const prevMonth = ctx.between(prevMonthStart, lastMonthStart);

  const costLast = round2(sumBy(lastMonth, ctx.cost));
  const costPrev = round2(sumBy(prevMonth, ctx.cost));

  const daysInLastMonth = Math.round(
    (new Date(`${thisMonthStart}T00:00:00Z`).getTime() -
      new Date(`${lastMonthStart}T00:00:00Z`).getTime()) /
      86_400_000,
  );

  let topService = "N/A";
  let topServiceCost = 0;
  for (const [service, rows] of groupEntries(lastMonth, (r) => r.serviceName)) {
    const total = sumBy(rows, ctx.cost);
    if (total > topServiceCost) {
      topServiceCost = total;
      topService = service;
    }
  }

  return {
    costLastMonth: costLast,
    costPreviousMonth: costPrev,
    changePercent:
      costPrev > 0 ? ((costLast - costPrev) / costPrev) * 100 : 0,
    dailyAverage: daysInLastMonth > 0 ? round2(costLast / daysInLastMonth) : 0,
    topService,
    topServiceCost: round2(topServiceCost),
  };
}

/** Mirrors `costSummaryKpiQuery`. Savings fields need Advisor data (not in the export). */
export function aggregateCostSummaryKpi(
  ctx: AggregationContext,
): CostSummaryKpi {
  const last = ctx.lastDays(30);
  const prev = ctx.previousDays(30);

  const totalLast = round2(sumBy(last, ctx.cost));
  const totalPrev = round2(sumBy(prev, ctx.cost));

  const subscriptions = new Set(last.map((r) => r.subAccountName));
  const resources = new Set(last.map((r) => r.resourceId).filter(Boolean));

  return {
    totalCost30d: totalLast,
    subscriptionCount: subscriptions.size,
    resourceCount: resources.size,
    momChangePercent:
      totalPrev > 0
        ? Math.round(((totalLast - totalPrev) / totalPrev) * 1000) / 10
        : 0,
    momChangeDelta: round2(totalLast - totalPrev),
    savingsIdentified: 0,
    savingsRecommendations: 0,
    savingsRealized: 0,
    savingsActions: 0,
  };
}

/** Mirrors `miniKpiQuery`. */
export function aggregateMiniKpis(ctx: AggregationContext): MiniKpiGauge[] {
  const usage = ctx.lastDays(30).filter((r) => r.chargeCategory === "Usage");
  const total = sumBy(usage, ctx.cost);

  const committed = sumBy(
    usage.filter(
      (r) =>
        r.pricingCategory === "Committed" || r.pricingCategory === "Commitment",
    ),
    ctx.cost,
  );
  const tagged = sumBy(
    usage.filter((r) => Object.keys(r.tags).length > 0),
    ctx.cost,
  );

  const pct = (part: number) =>
    total > 0 ? Math.round((part / total) * 1000) / 10 : 0;

  const commitmentCoverage = pct(committed);
  const tagCoverage = pct(tagged);

  return [
    {
      label: "Commitment Coverage",
      value: commitmentCoverage,
      target: 80,
      targetLabel: "Meta: 80%",
      status:
        commitmentCoverage >= 80
          ? "good"
          : commitmentCoverage >= 50
            ? "warning"
            : "danger",
    },
    {
      label: "Tag Compliance",
      value: tagCoverage,
      target: 95,
      targetLabel: "Meta: 95%",
      status:
        tagCoverage >= 95 ? "good" : tagCoverage >= 70 ? "warning" : "danger",
    },
  ];
}

/** Mirrors `costOverTime`. */
export function aggregateCostOverTime(
  ctx: AggregationContext,
  months: number,
): CostOverTimePoint[] {
  // KQL: `ChargePeriodStart >= startofmonth(ago(months * 30d))`.
  const from = startOfMonth(addDays(ctx.anchor, -(months * 30)));
  const rows = ctx.between(from, addDays(ctx.anchor, 1));

  return groupEntries(rows, (r) => startOfMonth(r.chargePeriodStart))
    .map(([month, group]) => ({
      month: `${month}T00:00:00Z`,
      cost: round2(sumBy(group, ctx.cost)),
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Rows matching the KQL window `ChargePeriodStart >= startofmonth(ago(30d))`,
 * i.e. from the start of the month that contains "30 days ago" — which spans
 * the current and previous month, not just the last 30 days.
 */
function monthToDateWindow(ctx: AggregationContext) {
  return ctx.between(
    startOfMonth(addDays(ctx.anchor, -30)),
    addDays(ctx.anchor, 1),
  );
}

/** Mirrors `costByService`. */
export function aggregateCostByService(
  ctx: AggregationContext,
  top: number,
): ServiceBreakdown[] {
  const rows = monthToDateWindow(ctx);
  const total = sumBy(rows, ctx.cost);

  return groupEntries(rows, (r) => r.serviceName)
    .map(([service, group]) => {
      const cost = sumBy(group, ctx.cost);
      return {
        service,
        cost: round2(cost),
        percentage: total > 0 ? Math.round((cost / total) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.cost - a.cost)
    .slice(0, top);
}

/** Mirrors `costBySubscription`. */
export function aggregateCostBySubscription(
  ctx: AggregationContext,
): SubscriptionCost[] {
  const rows = monthToDateWindow(ctx);
  const total = sumBy(rows, ctx.cost);

  return groupEntries(rows, (r) => r.subAccountName)
    .map(([subscriptionName, group]) => {
      const cost = sumBy(group, ctx.cost);
      return {
        subscriptionName,
        cost: round2(cost),
        percentage: total > 0 ? Math.round((cost / total) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.cost - a.cost);
}

/**
 * Cost split by cloud provider over the month-to-date window.
 *
 * Has no KQL counterpart yet because the production FinOps Hub is Azure-only;
 * it exists for multicloud customer datasets, where the single headline total
 * silently merges two bills that are governed, discounted and optimized by
 * completely different mechanisms.
 */
export function aggregateCostByProvider(
  ctx: AggregationContext,
): ProviderCost[] {
  const rows = monthToDateWindow(ctx);
  const total = sumBy(rows, ctx.cost);

  return groupEntries(rows, (r) => r.providerName)
    .map(([providerName, group]) => {
      const cost = sumBy(group, ctx.cost);
      return {
        providerName,
        cost: round2(cost),
        percentage: total > 0 ? Math.round((cost / total) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.cost - a.cost);
}

/** Mirrors `dailyCostTrend`. */
export function aggregateDailyCost(
  ctx: AggregationContext,
  days: number,
): DailyCostPoint[] {
  return groupEntries(ctx.lastDays(days), (r) => r.chargePeriodStart)
    .map(([day, group]) => ({
      day: `${day}T00:00:00Z`,
      cost: round2(sumBy(group, ctx.cost)),
    }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/** Mirrors `pricingModelQuery`. */
export function aggregatePricingModel(
  ctx: AggregationContext,
): PricingModelBreakdown[] {
  const usage = ctx.lastDays(30).filter((r) => r.chargeCategory === "Usage");

  return groupEntries(usage, (r) => r.pricingCategory || "Other")
    .map(([model, group]) => ({ model, cost: round2(sumBy(group, ctx.cost)) }))
    .filter((item) => item.cost > 0)
    .sort((a, b) => b.cost - a.cost);
}

/** Mirrors the `case()` mapping in `dailyByCategoryQuery`. */
function toDisplayCategory(serviceCategory: string): string {
  switch (serviceCategory) {
    case "Compute":
      return "Compute";
    case "AI and Machine Learning":
      return "AI/ML";
    case "Databases":
      return "Database";
    case "Storage":
      return "Storage";
    case "Networking":
      return "Network";
    default:
      return "Others";
  }
}

/** Mirrors `dailyByCategoryQuery`, already pivoted as the route expects. */
export function aggregateDailyByCategory(
  ctx: AggregationContext,
  days: number,
): DailyCostByCategory[] {
  const byDay = new Map<string, Record<string, number>>();

  for (const row of ctx.lastDays(days)) {
    const day = row.chargePeriodStart;
    const category = toDisplayCategory(row.serviceCategory);
    const bucket = byDay.get(day) ?? {};
    bucket[category] = (bucket[category] ?? 0) + ctx.cost(row);
    byDay.set(day, bucket);
  }

  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, categories]) => ({
      day,
      categories: Object.fromEntries(
        Object.entries(categories).map(([key, value]) => [key, round2(value)]),
      ),
    }));
}

/** Mirrors `serviceTrendQuery`. */
export function aggregateServiceTrend(
  ctx: AggregationContext,
): ServiceTrendItem[] {
  const last = groupBy(ctx.lastDays(30), (r) => r.serviceName);
  const prev = groupBy(ctx.previousDays(30), (r) => r.serviceName);

  return Array.from(last.entries())
    .map(([service, group]) => {
      const cost = sumBy(group, ctx.cost);
      const prevCost = sumBy(prev.get(service) ?? [], ctx.cost);
      const mom = prevCost > 0 ? ((cost - prevCost) / prevCost) * 100 : 0;
      return {
        service,
        cost: round2(cost),
        momPercent: Math.round(mom * 10) / 10,
      };
    })
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 10);
}

