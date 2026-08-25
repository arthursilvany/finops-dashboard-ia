import type {
  CommitmentGapItem,
  EffectiveSavingsRateBreakdownItem,
  EffectiveSavingsRateSummary,
  IdleResource,
  OptimizationAction,
  SavingsSummary,
} from "../types";
import type { CustomerCostRow } from "../customer-data/contract";
import { baselineCost } from "../customer-data/contract";
import type { AggregationContext } from "./context";
import { groupEntries, monthOf, round2, sumBy } from "./filters";

/**
 * In-memory equivalents of `src/lib/queries/rate-optimization.ts`.
 * Thresholds are copied verbatim from the KQL so the numbers match production.
 */

/**
 * Assumed commitment discount used throughout the KQL and mirrored here.
 *
 * This is an ASSUMPTION, not a measurement. A cost export contains no
 * reservation prices, and the Retail Prices API does not reliably expose them
 * either, so anything derived from this constant is a model and must be
 * labelled as such wherever it is shown. Confirming it requires the customer's
 * price sheet.
 */
const COMMITMENT_SAVINGS_RATE = 0.3;
/** A resource averaging under this much per day is treated as idle. */
const IDLE_AVG_DAILY_COST = 1.0;
/** An idle resource must have been billed on at least this many days. */
const IDLE_MIN_DAYS_ACTIVE = 25;

function usageRows(ctx: AggregationContext): CustomerCostRow[] {
  return ctx.lastDays(30).filter((r) => r.chargeCategory === "Usage");
}

function sumIf(
  rows: CustomerCostRow[],
  ctx: AggregationContext,
  predicate: (row: CustomerCostRow) => boolean,
): number {
  return sumBy(rows.filter(predicate), ctx.cost);
}

const isStandard = (r: CustomerCostRow) => r.pricingCategory === "Standard";
const isCommitted = (r: CustomerCostRow) => r.pricingCategory === "Committed";

/** Mirrors `commitmentGap`. */
export function aggregateCommitmentGap(
  ctx: AggregationContext,
): CommitmentGapItem[] {
  const usage = usageRows(ctx);

  return groupEntries(usage, (r) => r.serviceName)
    .map(([service, rows]) => {
      const onDemandCost = sumIf(rows, ctx, isStandard);
      const committedCost = sumIf(rows, ctx, isCommitted);
      const totalUsageCost = sumBy(rows, ctx.cost);
      return {
        service,
        onDemandCost: round2(onDemandCost),
        committedCost: round2(committedCost),
        commitmentCoverage:
          totalUsageCost > 0
            ? Math.round((committedCost / totalUsageCost) * 1000) / 10
            : 0,
        potentialSavings: round2(onDemandCost * COMMITMENT_SAVINGS_RATE),
      };
    })
    .filter((item) => item.onDemandCost > 50)
    .sort((a, b) => b.onDemandCost - a.onDemandCost)
    .slice(0, 15);
}

/** Per-resource aggregate used by both the idle list and the idle savings total. */
interface ResourceUsage {
  resourceId: string;
  resourceName: string;
  serviceName: string;
  subAccountName: string;
  totalCost: number;
  daysActive: number;
  avgDailyCost: number;
}

function summarizeByResource(ctx: AggregationContext): ResourceUsage[] {
  const usage = usageRows(ctx);

  return groupEntries(usage, (r) => r.resourceId || r.resourceName).map(
    ([resourceId, rows]) => {
      const totalCost = sumBy(rows, ctx.cost);
      const days = new Set(rows.map((r) => r.chargePeriodStart)).size;
      return {
        resourceId,
        resourceName: rows[0].resourceName,
        serviceName: rows[0].serviceName,
        subAccountName: rows[0].subAccountName,
        totalCost,
        daysActive: days,
        // The KQL uses avg() over line items, not over days.
        avgDailyCost: totalCost / rows.length,
      };
    },
  );
}

/** Mirrors `idleResources`. */
export function aggregateIdleResources(
  ctx: AggregationContext,
): IdleResource[] {
  return summarizeByResource(ctx)
    .filter(
      (r) =>
        r.totalCost > 0 &&
        r.avgDailyCost < IDLE_AVG_DAILY_COST &&
        r.daysActive >= IDLE_MIN_DAYS_ACTIVE,
    )
    .map((r) => ({
      resourceName: r.resourceName,
      consumedService: r.serviceName,
      subscriptionName: r.subAccountName,
      monthlyCost: round2(r.totalCost),
      avgDailyCost: Math.round(r.avgDailyCost * 10_000) / 10_000,
      daysActive: r.daysActive,
    }))
    .sort((a, b) => b.monthlyCost - a.monthlyCost)
    .slice(0, 20);
}

/** Mirrors `savingsOpportunitySummary`. */
export function aggregateSavingsSummary(
  ctx: AggregationContext,
): SavingsSummary {
  const usage = usageRows(ctx);
  const onDemand = sumIf(usage, ctx, isStandard);
  const commitmentGapSavings = round2(onDemand * COMMITMENT_SAVINGS_RATE);

  // Note: the idle-waste leg of the KQL does not apply the DaysActive filter.
  const idleResourceSavings = round2(
    sumBy(
      summarizeByResource(ctx).filter(
        (r) => r.avgDailyCost < IDLE_AVG_DAILY_COST && r.totalCost > 0,
      ),
      (r) => r.totalCost,
    ),
  );

  return {
    commitmentGapSavings,
    idleResourceSavings,
    totalPotentialSavings: round2(commitmentGapSavings + idleResourceSavings),
  };
}

/** Mirrors `topOptimizationActions`. */
export function aggregateOptimizationActions(
  ctx: AggregationContext,
): OptimizationAction[] {
  const usage = usageRows(ctx);

  const commitmentActions: OptimizationAction[] = groupEntries(
    usage,
    (r) => r.serviceName,
  )
    .map(([service, rows]) => ({
      service,
      onDemandCost: sumIf(rows, ctx, isStandard),
    }))
    .filter((item) => item.onDemandCost > 100)
    .map((item) => ({
      action: `Purchase commitment for ${item.service}`,
      category: "Commitment",
      potentialMonthlySavings: round2(
        item.onDemandCost * COMMITMENT_SAVINGS_RATE,
      ),
    }));

  const idleActions: OptimizationAction[] = summarizeByResource(ctx)
    .filter(
      (r) =>
        r.avgDailyCost < IDLE_AVG_DAILY_COST &&
        r.daysActive >= IDLE_MIN_DAYS_ACTIVE &&
        r.totalCost > 0,
    )
    .map((r) => ({
      action: `Deallocate idle: ${r.resourceName} (${r.serviceName})`,
      category: "Idle Resource",
      potentialMonthlySavings: round2(r.totalCost),
    }));

  return [...commitmentActions, ...idleActions]
    .sort((a, b) => b.potentialMonthlySavings - a.potentialMonthlySavings)
    .slice(0, 20);
}

/**
 * Mirrors the `x_AmortizationClass` classification: a commitment purchase is
 * the principal payment and must be excluded from list cost, otherwise the
 * savings rate is double counted against its amortized charges.
 */
function isPrincipal(row: CustomerCostRow): boolean {
  return (
    row.chargeCategory === "Purchase" && row.commitmentDiscountCategory !== ""
  );
}

/** A commitment charge that covered no usage — waste, with no baseline. */
function isUnusedCommitment(row: CustomerCostRow): boolean {
  return row.commitmentDiscountStatus === "Unused";
}

/**
 * Rows that can carry a savings rate: they have a baseline to compare against.
 *
 * Rows without one (unused commitments, credits/adjustments) are dropped from
 * BOTH sides of the ratio. Keeping them only in the numerator's effective cost
 * — as the code did before — drives the rate negative, which is just a
 * different wrong number.
 */
function ratedRows(rows: CustomerCostRow[]): CustomerCostRow[] {
  return rows.filter((r) => !isPrincipal(r) && r.hasBaseline);
}

function esrOf(rows: CustomerCostRow[]) {
  const rated = ratedRows(rows);
  const listCost = sumBy(rated, baselineCost);
  const effectiveCost = sumBy(rated, (r) => r.effectiveCost);
  const savings = listCost - effectiveCost;
  return {
    listCost: round2(listCost),
    effectiveCost: round2(effectiveCost),
    savings: round2(savings),
    esr: listCost === 0 ? 0 : round2((savings / listCost) * 100),
    unusedCommitmentCost: round2(
      sumBy(rows.filter(isUnusedCommitment), (r) => r.effectiveCost),
    ),
  };
}

/** Mirrors `effectiveSavingsRateSummary`. Uses the whole filtered period. */
export function aggregateEsrSummary(
  ctx: AggregationContext,
): EffectiveSavingsRateSummary {
  const { listCost, effectiveCost, savings, esr, unusedCommitmentCost } =
    esrOf(ctx.rows);

  return {
    totalSavings: savings,
    listCost,
    effectiveCost,
    effectiveSavingsRate: esr,
    unusedCommitmentCost,
  };
}

/** Mirrors `effectiveSavingsRateBreakdown`. */
export function aggregateEsrBreakdown(
  ctx: AggregationContext,
): EffectiveSavingsRateBreakdownItem[] {
  return groupEntries(ctx.rows, (r) => monthOf(r.chargePeriodStart))
    .map(([month, rows]) => ({ month, ...esrOf(rows) }))
    .sort((a, b) => b.month.localeCompare(a.month));
}