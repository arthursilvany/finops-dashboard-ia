/**
 * Rule-based AI insights derived from the customer's Cost Export.
 *
 * Design principles (from task spec):
 * - Every emitted insight cites a number actually computed from the dataset.
 * - Fewer true insights are preferred over filled-quota invented findings.
 * - Thresholds are documented with comments explaining their rationale.
 * - No Azure OpenAI connection is required — this runs fully deterministically.
 * - Windows are anchored to the dataset period, never to `new Date()`.
 */

import type { AiInsight, AiInsightsCost, AiRadarDataset } from "../types";
import type { AggregationContext } from "./context";
import {
  aggregateAnomalySummary,
  aggregateAnomalyTimeline,
} from "./anomalies";
import {
  aggregateCostSummaryKpi,
  aggregateCostByService,
  aggregateDailyCost,
  aggregateMiniKpis,
} from "./cost-summary";
import { aggregateEsrSummary, aggregateSavingsSummary } from "./rate-optimization";
import { aggregateGovernanceKpi } from "./governance";
import { aggregateChargebackKpi } from "./chargeback";
import { round2 } from "./filters";

// ---------------------------------------------------------------------------
// Thresholds — all defensible against the underlying data shape
// ---------------------------------------------------------------------------

/** MoM cost increase that warrants an "unexpected growth" insight. */
const MOM_GROWTH_WARNING_PCT = 15;

/**
 * On-demand spend threshold for a "commitment gap" insight. Below this the
 * potential savings are not meaningful enough to mention in a customer meeting.
 * 30 % of the 30-day window means ~9 days of purely on-demand spend.
 */
const COMMITMENT_GAP_MIN_PCT_OF_TOTAL = 30;

/**
 * Minimum commitment coverage to avoid raising the commitment insight.
 * 80 % is the industry-standard FinOps target; it is also the value used by
 * `aggregateMiniKpis` for the Commitment Coverage gauge. Kept as a separate
 * constant from TAG_COMPLIANCE_WARNING_PCT so that tuning one does not
 * silently move the other.
 */
const COMMITMENT_COVERAGE_TARGET_PCT = 80;

/**
 * Tag compliance below this triggers a governance insight. 80 % is the
 * "warning" threshold already used by `aggregateMiniKpis`. Below 50 % we
 * escalate to "high" impact.
 */
const TAG_COMPLIANCE_WARNING_PCT = 80;
const TAG_COMPLIANCE_HIGH_PCT = 50;

/**
 * Untagged spend fraction that justifies a chargeback insight. We need at
 * least 20 % unallocated before the finding is actionable.
 */
const UNTAGGED_SPEND_MIN_PCT = 20;

/**
 * Minimum anomaly count to surface an anomaly insight. A single anomaly in a
 * 30-day window can be noise; we require at least 2 before raising it.
 */
const ANOMALY_MIN_COUNT_30D = 2;

/** Minimum MoM cost delta (absolute, in billing currency) worth mentioning. */
const MOM_MIN_ABSOLUTE_DELTA = 100;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function fmtPct(n: number): string {
  return `${Math.round(n * 10) / 10}%`;
}

/** Returns the currency label(s) from the manifest, e.g. "BRL" or "BRL/USD". */
function currencyLabel(ctx: AggregationContext): string {
  const currencies = ctx.manifest.currencies;
  if (!currencies || currencies.length === 0) return "";
  return currencies.join("/");
}

// ---------------------------------------------------------------------------
// Public aggregator
// ---------------------------------------------------------------------------

export interface CustomerAiInsightsResult {
  insights: AiInsight[];
  /**
   * Cost-forecast chart. Because the export is a historical snapshot (not a
   * live feed) we cannot produce a forward forecast, so we return actual
   * monthly totals only with empty forecast/bound arrays. The chart renders
   * the actuals as a bar series; bands are absent but that is honest.
   */
  costForecast: AiInsightsCost;
  /**
   * FinOps radar built from the same aggregates that back the insights, so the
   * two panels tell a consistent story.
   */
  finopsRadar: AiRadarDataset;
}

/** Generates rule-based insights grounded in the customer's Cost Export. */
export function aggregateCustomerAiInsights(
  ctx: AggregationContext,
): CustomerAiInsightsResult {
  const insights: AiInsight[] = [];
  const ccy = currencyLabel(ctx);
  const ccyPrefix = ccy ? `${ccy} ` : "";
  const period = `${ctx.manifest.periodStart ?? ctx.anchor} – ${ctx.manifest.periodEnd ?? ctx.anchor}`;

  // ---- Gather the facts once ------------------------------------------
  const kpi = aggregateCostSummaryKpi(ctx);
  const esrSummary = aggregateEsrSummary(ctx);
  const savingsSummary = aggregateSavingsSummary(ctx);
  const govKpi = aggregateGovernanceKpi(ctx);
  const chargebackKpi = aggregateChargebackKpi(ctx);
  const anomalySummary = aggregateAnomalySummary(ctx);
  const miniKpis = aggregateMiniKpis(ctx);
  const topServices = aggregateCostByService(ctx, 5);

  const commitmentMiniKpi = miniKpis.find((k) => k.label === "Commitment Coverage");
  const commitmentCoverage = commitmentMiniKpi?.value ?? 0;

  // ---- Rule 1: Significant MoM cost growth --------------------------------
  if (
    kpi.momChangePercent > MOM_GROWTH_WARNING_PCT &&
    Math.abs(kpi.momChangeDelta) > MOM_MIN_ABSOLUTE_DELTA
  ) {
    const topService = topServices[0];
    insights.push({
      id: "cust-growth",
      title: "Cost Growth vs Prior Period",
      summary:
        `Spend over the last 30 days of the export (${ccyPrefix}${fmt(kpi.totalCost30d)}) ` +
        `is ${fmtPct(kpi.momChangePercent)} above the previous 30-day window ` +
        `(delta: ${ccyPrefix}${fmt(Math.abs(kpi.momChangeDelta))}).` +
        (topService
          ? ` The largest contributor is "${topService.service}" at ${ccyPrefix}${fmt(topService.cost)} (${fmtPct(topService.percentage)} of period spend).`
          : "") +
        ` Dataset period: ${period}.`,
      impact: kpi.momChangePercent > 30 ? "high" : "medium",
      category: "Cost Trend",
    });
  }

  // ---- Rule 2: Commitment coverage below target ---------------------------
  // Only emit when total spend is measurable and coverage falls short of the
  // FinOps target. `commitmentGapSavings` in `savingsSummary` is the actual
  // on-demand spend from the export multiplied by the 30 % discount assumption
  // used by the phase-1 aggregator — the same figure shown in Rate Optimization.
  if (
    kpi.totalCost30d > 0 &&
    commitmentCoverage < COMMITMENT_COVERAGE_TARGET_PCT
  ) {
    // The enclosing `if` already guarantees commitmentCoverage < target, so
    // onDemandPct is always positive here.
    const onDemandPct = 100 - commitmentCoverage;

    if (onDemandPct >= COMMITMENT_GAP_MIN_PCT_OF_TOTAL) {
      const gap =
        savingsSummary.commitmentGapSavings > 0
          ? ` Closing that gap at an assumed 30% commitment discount would model ${ccyPrefix}${fmt(savingsSummary.commitmentGapSavings)}/month — a scenario, not a quote: confirming it needs the customer's price sheet.`
          : "";
      insights.push({
        id: "cust-commitment",
        title: "Commitment Coverage Below Target",
        summary:
          `${fmtPct(onDemandPct)} of usage spend (last 30 days of export) is on-demand ` +
          `pricing. The target is ≥${COMMITMENT_COVERAGE_TARGET_PCT}% commitment coverage.` +
          gap +
          ` Dataset period: ${period}.`,
        impact: commitmentCoverage < 50 ? "high" : "medium",
        category: "Commitments",
        // savingsEstimate intentionally absent: the figure is modeled from a
        // flat 30% assumption, and rendering it as a headline currency amount
        // presents an assumption as an audited number.
      });
    }
  }

  // ---- Rule 3: Tag compliance below threshold ------------------------------
  if (govKpi.totalResources > 0 && govKpi.overallCompliance < TAG_COMPLIANCE_WARNING_PCT) {
    const untaggedCount = govKpi.totalResources - govKpi.taggedResources;
    insights.push({
      id: "cust-tagging",
      title: "Tag Compliance Below Target",
      summary:
        `${fmtPct(govKpi.overallCompliance)} of charge rows carry all required tags ` +
        `(env, owner, cost-center). ${fmt(untaggedCount)} of ${fmt(govKpi.totalResources)} rows ` +
        `are non-compliant. This makes accurate chargeback and showback impossible. ` +
        `Dataset period: ${period}.`,
      impact: govKpi.overallCompliance < TAG_COMPLIANCE_HIGH_PCT ? "high" : "medium",
      category: "Governance",
      resourceCount: untaggedCount,
    });
  }

  // ---- Rule 4: Untagged / unallocated chargeback spend ---------------------
  const totalSpend = chargebackKpi.totalAllocated + chargebackKpi.untaggedCost;
  const untaggedPct =
    totalSpend > 0 ? (chargebackKpi.untaggedCost / totalSpend) * 100 : 0;

  if (untaggedPct >= UNTAGGED_SPEND_MIN_PCT && chargebackKpi.untaggedCost > 0) {
    insights.push({
      id: "cust-chargeback",
      title: "Unallocated Spend Limits Chargeback Accuracy",
      summary:
        `${fmtPct(untaggedPct)} of total spend (${ccyPrefix}${fmt(chargebackKpi.untaggedCost)}) ` +
        `cannot be attributed to a business unit because the "cost-center" tag is missing. ` +
        `This reduces showback accuracy and complicates budget ownership. ` +
        `Dataset period: ${period}.`,
      impact: untaggedPct >= 50 ? "high" : "medium",
      category: "Chargeback",
    });
  }

  // ---- Rule 5: Cost anomalies in the dataset -------------------------------
  if (anomalySummary.anomalies30d >= ANOMALY_MIN_COUNT_30D) {
    const lastDate = anomalySummary.lastAnomalyDate
      ? anomalySummary.lastAnomalyDate.slice(0, 10)
      : ctx.anchor;
    insights.push({
      id: "cust-anomaly",
      title: "Cost Anomalies Detected in Export Period",
      summary:
        `${anomalySummary.anomalies30d} anomalous daily-cost spikes or drops were detected ` +
        `in the last 30 days of the export (${anomalySummary.anomalies7d} in the last 7). ` +
        `Largest single-day deviation from baseline: ${ccyPrefix}${fmt(anomalySummary.largestDeviation)}. ` +
        `Most recent anomaly: ${lastDate}. ` +
        `Dataset period: ${period}.`,
      impact: anomalySummary.anomalies7d >= 3 ? "high" : "medium",
      category: "Anomaly",
    });
  }

  // ---- Rule 6: ESR is measurable and > 0 ----------------------------------
  // Only emitted when a baseline exists in the export. `listCost` here is the
  // baseline cascade (ListCost, else ContractedCost); when no row carries one
  // the rate is unknown and we say nothing rather than invent a finding.
  // No savingsEstimate is attached: any "you could save R$X" figure would
  // require an agreed ESR target that we do not have from the customer.
  if (
    esrSummary.listCost > 0 &&
    esrSummary.effectiveSavingsRate > 0 &&
    esrSummary.effectiveSavingsRate < 20 // below 20 % ESR is noteworthy
  ) {
    insights.push({
      id: "cust-esr",
      title: "Effective Savings Rate Has Room to Grow",
      summary:
        `Current Effective Savings Rate (ESR) is ${fmtPct(esrSummary.effectiveSavingsRate)} ` +
        `(list cost ${ccyPrefix}${fmt(esrSummary.listCost)}, effective cost ${ccyPrefix}${fmt(esrSummary.effectiveCost)}). ` +
        `Increasing commitment coverage and negotiating enterprise discounts are the primary levers. ` +
        `Dataset period: ${period}.`,
      impact: esrSummary.effectiveSavingsRate < 10 ? "high" : "medium",
      category: "Savings Rate",
      // savingsEstimate intentionally absent: a target-derived figure would
      // fabricate money the data does not support (honesty rule).
    });
  }

  // ---- Rule 6b: commitments purchased but not used -------------------------
  // Measured, not modeled: charges for reservation / savings-plan capacity that
  // covered no usage at all. Unlike the commitment gap, this number comes
  // straight from the export, so it is safe to quote as money.
  const unusedCommitment = esrSummary.unusedCommitmentCost ?? 0;
  if (unusedCommitment > 0) {
    const shareOfSpend = totalSpend > 0 ? (unusedCommitment / totalSpend) * 100 : 0;
    insights.push({
      id: "cust-unused-commitment",
      title: "Commitments Purchased but Not Used",
      summary:
        `${ccyPrefix}${fmt(unusedCommitment)} was billed for reservation or savings-plan ` +
        `capacity that covered no usage (${fmtPct(shareOfSpend)} of spend in the dataset). ` +
        `This is waste, not a discount opportunity: it is excluded from the Effective Savings Rate. ` +
        `Review scope, term and instance-size flexibility on the affected commitments. ` +
        `Dataset period: ${period}.`,
      impact: shareOfSpend >= 1 ? "high" : "medium",
      category: "Commitments",
      savingsEstimate: unusedCommitment,
    });
  }

  // -------------------------------------------------------------------------
  // Cost-forecast chart (actuals only — no forward model on a snapshot)
  // -------------------------------------------------------------------------
  const dailyPoints = aggregateDailyCost(ctx, 90);
  // Bucket daily points into months for the chart series.
  const monthBuckets = new Map<string, number>();
  for (const pt of dailyPoints) {
    const monthKey = pt.day.slice(0, 7); // "YYYY-MM"
    const prev = monthBuckets.get(monthKey) ?? 0;
    monthBuckets.set(monthKey, prev + pt.cost);
  }
  const monthEntries = Array.from(monthBuckets.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const categories = monthEntries.map(([key]) => {
    const month = parseInt(key.slice(5, 7), 10) - 1;
    return `${MONTH_LABELS[month]}/${key.slice(2, 4)}`;
  });
  const actual = monthEntries.map(([, v]) => round2(v));

  const costForecast: AiInsightsCost = {
    categories,
    actual: actual as (number | null)[],
    forecast: [],
    lowerBound: [],
    upperBound: [],
  };

  // -------------------------------------------------------------------------
  // FinOps radar — built from the same facts so both panels are consistent
  // -------------------------------------------------------------------------
  const tagScore = Math.min(100, Math.round(govKpi.overallCompliance));
  const commitScore = Math.min(100, Math.round(commitmentCoverage));
  // ESR score: 0 when listCost=0 (unknown), otherwise linear up to 100.
  // We scale by 3× because a well-optimised estate rarely exceeds ~33% ESR
  // (combining reservations, savings plans, and enterprise agreements); mapping
  // 33% → 100 keeps the radar dimension usable rather than perpetually low.
  const esrScore =
    esrSummary.listCost > 0
      ? Math.min(100, Math.round(esrSummary.effectiveSavingsRate * 3))
      : 0;
  // Anomaly health: 100 means no anomalies; subtract 10 per anomaly, min 0.
  const anomalyScore = Math.max(0, 100 - anomalySummary.anomalies30d * 10);
  // Chargeback coverage: fraction of spend with a cost-center tag.
  const chargebackScore =
    totalSpend > 0
      ? Math.min(100, Math.round((chargebackKpi.totalAllocated / totalSpend) * 100))
      : 0;

  const finopsRadar: AiRadarDataset = {
    indicators: [
      { name: "Tag Compliance", max: 100 },
      { name: "Commitment Coverage", max: 100 },
      { name: "Savings Rate", max: 100 },
      { name: "Anomaly Health", max: 100 },
      { name: "Chargeback Coverage", max: 100 },
    ],
    series: [
      {
        name: ctx.manifest.customer || "Customer",
        values: [tagScore, commitScore, esrScore, anomalyScore, chargebackScore],
        color: "#0078d4",
      },
    ],
  };

  return { insights, costForecast, finopsRadar };
}
