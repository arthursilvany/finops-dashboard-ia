import type {
  AnomalySummary,
  CommitmentGapItem,
  CostSummaryKpi,
  EffectiveSavingsRateSummary,
  GovernanceKpi,
  IdleResource,
  MiniKpiGauge,
  OptimizationAction,
  SavingsSummary,
  SubscriptionCost,
} from "../types";
import type { ParsedFilters } from "../filter-schema";
import type { AggregationContext } from "../customer-aggregations/context";
import { getAggregationContext } from "../customer-aggregations/context";
import {
  aggregateCostBySubscription,
  aggregateCostSummaryKpi,
  aggregateMiniKpis,
} from "../customer-aggregations/cost-summary";
import {
  aggregateCommitmentGap,
  aggregateEsrSummary,
  aggregateIdleResources,
  aggregateOptimizationActions,
  aggregateSavingsSummary,
} from "../customer-aggregations/rate-optimization";
import { aggregateGovernanceKpi } from "../customer-aggregations/governance";
import { aggregateAnomalySummary } from "../customer-aggregations/anomalies";
import {
  mockCostSummaryKpi,
  mockMiniKpis,
  mockSubscriptionCosts,
} from "../mock-data/cost-summary";
import {
  mockCommitmentGap,
  mockEffectiveSavingsRateSummary,
  mockIdleResources,
  mockOptimizationActions,
  mockSavingsSummary,
} from "../mock-data/rate-optimization";
import { mockGovernanceKpi } from "../mock-data/governance";
import { mockAnomalySummary } from "../mock-data/anomalies";
import { buildScopeRollups } from "./scope";
import type { CoverageReport, StakeholderFacts } from "./types";

/**
 * Facts layer: **all** Stakeholder Card arithmetic lives here.
 *
 * Builders (`builders.ts`) only select and format. This separation makes the
 * "no new numbers are created" rule mechanically verifiable: the test flattens
 * this object and requires every card's `raw` value to exist in it.
 *
 * Inputs are always outputs from existing aggregators, never raw rows: if the
 * dashboard and a card disagree on a number, it is a bug, not an opinion.
 */

/** Annual recurrence of a monthly value. A constant, not a model. */
const MONTHS_PER_YEAR = 12;
/** Commitment coverage target used by the existing mini-KPI. */
const COMMITMENT_COVERAGE_TARGET = 80;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Action categories that do not change architecture. Buying commitment is a
 * commercial decision about consumption that already exists.
 */
const NO_PREREQ_CATEGORIES = new Set(["Commitment"]);

interface FactInputs {
  currency: string;
  dataSource: StakeholderFacts["dataSource"];
  customerName: string | null;
  costKpi: CostSummaryKpi;
  miniKpis: MiniKpiGauge[];
  subscriptions: SubscriptionCost[];
  savings: SavingsSummary;
  esr: EffectiveSavingsRateSummary;
  commitmentGap: CommitmentGapItem[];
  idle: IdleResource[];
  actions: OptimizationAction[];
  /** `null` when the layer was not collected — becomes "not assessed". */
  governance: GovernanceKpi | null;
  anomalies: AnomalySummary | null;
  /** Export's time coverage; `null` in demo mode. */
  period: { start: string; end: string } | null;
}

function coverageOf(inputs: FactInputs): CoverageReport {
  const limitations: string[] = [];

  if (inputs.governance === null) {
    limitations.push(
      "Governance not assessed: no tag or policy compliance data.",
    );
  }
  if (inputs.anomalies === null) {
    limitations.push(
      "Anomaly detection was not assessed in this collection.",
    );
  }
  if (inputs.esr.unusedCommitmentCost === null) {
    limitations.push(
      "Unused commitment was not reported by the source: it cannot be claimed absent.",
    );
  }
  if (inputs.dataSource === "mock") {
    limitations.push(
      "Demo data: the numbers do not describe a real environment.",
    );
  }

  // A single-month export does not contain two months to compare. The change
  // is still calculated because both 30-day windows exist, but it compares the
  // beginning of the month with its remainder. Presenting it as
  // "month-over-month" without this caveat has produced incorrect readings.
  if (
    inputs.period &&
    inputs.period.start.slice(0, 7) === inputs.period.end.slice(0, 7)
  ) {
    limitations.push(
      `Single-month export (${inputs.period.start.slice(0, 7)}): the month-over-month ` +
        "change compares two windows within the same month, not two completed " +
        "months. Request three months for a real trend.",
    );
  }

  // Without the required tags, cost-center allocation is impossible. The
  // summary "Tag Compliance" mini-KPI counts any tag and therefore reads much
  // higher: in an AWS export, a migration tag can cover almost all spend
  // without any FinOps tag existing.
  if (
    inputs.governance &&
    inputs.governance.totalResources > 0 &&
    inputs.governance.taggedResources === 0
  ) {
    limitations.push(
      "No row contains env+owner+cost-center: there is no basis for cost-center " +
        "chargeback, and any allocation below the total would be arbitrary.",
    );
  }

  return {
    costExport: true,
    governance: inputs.governance !== null,
    anomalies: inputs.anomalies !== null,
    commitments: inputs.esr.unusedCommitmentCost !== null,
    limitations,
  };
}

function buildFacts(inputs: FactInputs): StakeholderFacts {
  const {
    costKpi,
    miniKpis,
    subscriptions,
    savings,
    esr,
    commitmentGap,
    idle,
    actions,
    governance,
    anomalies,
  } = inputs;

  const commitmentCoverage =
    miniKpis.find((kpi) => kpi.label === "Commitment Coverage")?.value ?? null;
  const tagCoverage =
    miniKpis.find((kpi) => kpi.label === "Tag Compliance")?.value ?? null;

  const noPrereqActions = actions.filter((a) =>
    NO_PREREQ_CATEGORIES.has(a.category),
  );
  const requiresValidationActions = actions.filter(
    (a) => !NO_PREREQ_CATEGORIES.has(a.category),
  );

  const sumActions = (list: OptimizationAction[]) =>
    round2(list.reduce((total, a) => total + a.potentialMonthlySavings, 0));

  const topGap = commitmentGap[0];
  const topIdle = idle[0];

  const onDemandCost = round2(
    commitmentGap.reduce((total, item) => total + item.onDemandCost, 0),
  );
  const committedCost = round2(
    commitmentGap.reduce((total, item) => total + item.committedCost, 0),
  );

  return {
    currency: inputs.currency,
    dataSource: inputs.dataSource,
    customerName: inputs.customerName,
    coverage: coverageOf(inputs),

    cost: {
      total30d: costKpi.totalCost30d,
      momChangePercent: costKpi.momChangePercent,
      momChangeDelta: costKpi.momChangeDelta,
      subscriptionCount: costKpi.subscriptionCount,
      resourceCount: costKpi.resourceCount,
      topSubscription:
        subscriptions.length > 0 ? subscriptions[0].subscriptionName : "",
      topSubscriptionCost: subscriptions.length > 0 ? subscriptions[0].cost : 0,
      annualizedRunRate: round2(costKpi.totalCost30d * MONTHS_PER_YEAR),
    },

    savings: {
      commitmentGap: savings.commitmentGapSavings,
      idleResources: savings.idleResourceSavings,
      totalPotentialMonthly: savings.totalPotentialSavings,
      totalPotentialAnnual: round2(
        savings.totalPotentialSavings * MONTHS_PER_YEAR,
      ),
      noPrereqMonthly: sumActions(noPrereqActions),
      requiresValidationMonthly: sumActions(requiresValidationActions),
      actionCount: actions.length,
      noPrereqActionCount: noPrereqActions.length,
      requiresValidationActionCount: requiresValidationActions.length,
    },

    esr: {
      effectiveSavingsRate: esr.effectiveSavingsRate,
      totalSavings: esr.totalSavings,
      listCost: esr.listCost,
      effectiveCost: esr.effectiveCost,
      unusedCommitmentCost: esr.unusedCommitmentCost,
    },

    commitment: {
      coveragePercent: commitmentCoverage,
      onDemandCost,
      committedCost,
      topGapService: topGap?.service ?? "",
      topGapOnDemandCost: topGap?.onDemandCost ?? 0,
      servicesBelowTarget: commitmentGap.filter(
        (item) => item.commitmentCoverage < COMMITMENT_COVERAGE_TARGET,
      ).length,
    },

    idle: {
      count: idle.length,
      monthlyCost: round2(
        idle.reduce((total, item) => total + item.monthlyCost, 0),
      ),
      topResourceName: topIdle?.resourceName ?? "",
      topResourceMonthlyCost: topIdle?.monthlyCost ?? 0,
    },

    governance: {
      overallCompliance: governance?.overallCompliance ?? null,
      taggedResources: governance?.taggedResources ?? null,
      totalResources: governance?.totalResources ?? null,
      policiesActive: governance?.policiesActive ?? null,
      tagCoveragePercent: tagCoverage,
    },

    anomalies: {
      last7d: anomalies?.anomalies7d ?? null,
      last30d: anomalies?.anomalies30d ?? null,
      largestDeviation: anomalies?.largestDeviation ?? null,
      lastAnomalyDate: anomalies?.lastAnomalyDate ?? "",
    },

    scopes: buildScopeRollups(subscriptions, idle),
  };
}

/** Display currency. `usd` is a filter choice; otherwise use the billing currency. */
function currencyOf(ctx: AggregationContext): string {
  if (ctx.filters.currency === "usd") return "USD";
  return ctx.manifest.currencies[0] ?? "USD";
}

/** Facts from the customer's Cost Export (POC mode). */
export function buildFactsFromContext(
  ctx: AggregationContext,
): StakeholderFacts {
  return buildFacts({
    currency: currencyOf(ctx),
    dataSource: "customer",
    customerName: ctx.manifest.customer,
    costKpi: aggregateCostSummaryKpi(ctx),
    miniKpis: aggregateMiniKpis(ctx),
    subscriptions: aggregateCostBySubscription(ctx),
    savings: aggregateSavingsSummary(ctx),
    esr: aggregateEsrSummary(ctx),
    commitmentGap: aggregateCommitmentGap(ctx),
    idle: aggregateIdleResources(ctx),
    actions: aggregateOptimizationActions(ctx),
    governance: aggregateGovernanceKpi(ctx),
    anomalies: aggregateAnomalySummary(ctx),
    period:
      ctx.manifest.periodStart && ctx.manifest.periodEnd
        ? { start: ctx.manifest.periodStart, end: ctx.manifest.periodEnd }
        : null,
  });
}

/** Facts from static demo data. */
export function buildFactsFromMock(): StakeholderFacts {
  return buildFacts({
    currency: "USD",
    dataSource: "mock",
    customerName: null,
    costKpi: mockCostSummaryKpi,
    miniKpis: mockMiniKpis,
    subscriptions: mockSubscriptionCosts,
    savings: mockSavingsSummary,
    esr: mockEffectiveSavingsRateSummary,
    commitmentGap: mockCommitmentGap,
    idle: mockIdleResources,
    actions: mockOptimizationActions,
    governance: mockGovernanceKpi.data,
    anomalies: mockAnomalySummary,
    period: null,
  });
}

/**
 * Source precedence, like the rest of the dashboard:
 * customer dataset (pre-sales) > static mock (demo).
 *
 * The ADX path does not yet expose an equivalent single aggregator. Until it
 * does, the route calls this only inside the `isMockMode()` branch, as other
 * routes do.
 */
export function buildStakeholderFacts(
  filters: ParsedFilters,
  customerSlug?: string | null,
): StakeholderFacts {
  const ctx = getAggregationContext(filters, customerSlug);
  return ctx ? buildFactsFromContext(ctx) : buildFactsFromMock();
}

/**
 * Flattens facts into a numeric `path -> value` map. Used by auditing: every
 * card's `raw` value must match an entry in this map.
 */
export function flattenFacts(facts: StakeholderFacts): Map<string, number> {
  const flat = new Map<string, number>();

  const walk = (value: unknown, path: string) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      flat.set(path, value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        walk(child, path ? `${path}.${key}` : key);
      }
    }
  };

  walk(facts, "");
  return flat;
}
