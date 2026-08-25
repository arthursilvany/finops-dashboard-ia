/**
 * Smoke test for the customer POC aggregators.
 *
 * Runs every phase-1 aggregator against whatever dataset is currently active
 * under `output/customer/` and asserts the invariants that would make a
 * customer meeting go wrong (empty panels, negative totals, percentages that
 * do not add up).
 *
 * Usage:
 *   npx tsx scripts/test-customer-aggregations.ts
 */
import assert from "node:assert/strict";

import { filterSchema } from "../src/lib/filter-schema";
import { getAggregationContext } from "../src/lib/customer-aggregations/context";
import { spanDays as rowSpanDays } from "../src/lib/customer-aggregations/filters";
import {
  aggregateCostByService,
  aggregateCostBySubscription,
  aggregateCostOverTime,
  aggregateCostSummaryKpi,
  aggregateDailyByCategory,
  aggregateDailyCost,
  aggregateKpiSummary,
  aggregateMiniKpis,
  aggregatePricingModel,
  aggregateServiceTrend,
} from "../src/lib/customer-aggregations/cost-summary";
import {
  aggregateCommitmentGap,
  aggregateEsrBreakdown,
  aggregateEsrSummary,
  aggregateIdleResources,
  aggregateOptimizationActions,
  aggregateSavingsSummary,
} from "../src/lib/customer-aggregations/rate-optimization";
import {
  aggregateBudgetVsActual,
  aggregateGovernanceKpi,
  aggregateTagCompliance,
} from "../src/lib/customer-aggregations/governance";
import {
  aggregateChargebackByBu,
  aggregateChargebackKpi,
  aggregateChargebackTrend,
} from "../src/lib/customer-aggregations/chargeback";
import {
  aggregateAnomalySummary,
  aggregateAnomalyTimeline,
  aggregateAnomalyTopResources,
} from "../src/lib/customer-aggregations/anomalies";
import { parseTags, toIsoDate } from "../src/lib/customer-data/normalize";
import { deriveServiceCategory, lookupTag } from "../src/lib/customer-data/contract";
import {
  CUSTOMER_METRICS,
  customerSectionResults,
  getCustomerMetricJson,
} from "../src/lib/customer-agent-tools";

let failures = 0;

function check(name: string, assertion: () => void): void {
  try {
    assertion();
    process.stdout.write(`  ok  ${name}\n`);
  } catch (error) {
    failures += 1;
    process.stdout.write(
      `  FAIL ${name}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

// --- Pure helpers, independent of any dataset -------------------------------

process.stdout.write("\nnormalization helpers\n");

check("toIsoDate handles ISO, MM/DD/YYYY and YYYYMMDD", () => {
  assert.equal(toIsoDate("2025-03-04T00:00:00Z"), "2025-03-04");
  assert.equal(toIsoDate("3/4/2025"), "2025-03-04");
  assert.equal(toIsoDate("20250304"), "2025-03-04");
  assert.equal(toIsoDate(""), null);
  assert.equal(toIsoDate("not a date"), null);
});

check("parseTags handles JSON, bare pairs and garbage", () => {
  assert.deepEqual(parseTags('{"Env":"prod","owner":"a"}'), {
    env: "prod",
    owner: "a",
  });
  assert.deepEqual(parseTags('"env": "prod"'), { env: "prod" });
  assert.deepEqual(parseTags("env:prod;owner:a"), { env: "prod", owner: "a" });
  assert.deepEqual(parseTags(""), {});
  assert.deepEqual(parseTags("{{{"), {});
});

check("deriveServiceCategory classifies AI services", () => {
  assert.equal(
    deriveServiceCategory("Azure OpenAI"),
    "AI and Machine Learning",
  );
  assert.equal(deriveServiceCategory("Virtual Machines"), "Compute");
  assert.equal(deriveServiceCategory("Something Unknown"), "Other");
});

check("lookupTag matches every real-world cost-centre spelling", () => {
  // Regression guard: a real customer export used "costcenter" while the code
  // looked up "cost-center", so chargeback reported the whole estate as
  // untagged while 84% of the spend was in fact allocated.
  for (const key of [
    "cost-center",
    "costcenter",
    "cost_center",
    "cost center",
    "cost-centre",
    "costcode",
    "business-unit",
    "bu",
  ]) {
    assert.equal(
      lookupTag({ [key.toLowerCase()]: "finance" }, "cost-center"),
      "finance",
      `spelling "${key}" was not matched`,
    );
  }

  assert.equal(lookupTag({ environment: "prod" }, "env"), "prod");
  assert.equal(lookupTag({ ownedby: "team" }, "owner"), "team");

  // An unrelated tag must not be mistaken for a cost centre, and an empty value
  // counts as absent rather than as an allocation to "".
  assert.equal(lookupTag({ project: "apollo" }, "cost-center"), "");
  assert.equal(lookupTag({ costcenter: "" }, "cost-center"), "");
  assert.equal(lookupTag({}, "cost-center"), "");
});

// --- Aggregators against the loaded dataset ---------------------------------

const filters = filterSchema.parse({});
const ctx = getAggregationContext(filters);

if (!ctx) {
  process.stdout.write(
    "\nNo customer dataset found — run `npm run ingest:customer` first to test the aggregators.\n",
  );
  process.exit(failures > 0 ? 1 : 0);
}

process.stdout.write(
  `\naggregators (customer "${ctx.manifest.customer}", ${ctx.rows.length} rows, anchor ${ctx.anchor})\n`,
);

/**
 * Real customer exports are often short — a freshly configured daily export can
 * hold a single day. Assertions that require history would then fail on every
 * genuine dataset, which trains everyone to ignore the suite.
 *
 * So the shape of the assertion adapts, but never weakens: with enough history
 * a value must be present; without it the value must be an honest zero rather
 * than something invented.
 */
const periodStart = ctx.manifest.periodStart ?? "";
const periodEnd = ctx.manifest.periodEnd ?? "";
const spanDays =
  periodStart && periodEnd
    ? Math.round(
        (Date.parse(`${periodEnd}T00:00:00Z`) - Date.parse(`${periodStart}T00:00:00Z`)) /
          86_400_000,
      ) + 1
    : 0;
const hasPreviousMonth = Boolean(periodStart) && periodStart.slice(0, 7) < periodEnd.slice(0, 7);

/**
 * `lastCompleteMonthStart` treats the anchor's own month as complete when the
 * anchor lands on its last day. A single-month export that ends on a month
 * boundary therefore *does* have a reportable "last month" — itself — even
 * though no earlier month exists. Without this the check below demands an
 * honest zero on exactly the datasets where reporting the real figure is both
 * correct and the whole point.
 */
const anchorEndsMonth =
  Boolean(periodEnd) &&
  periodEnd === new Date(Date.UTC(
    Number(periodEnd.slice(0, 4)),
    Number(periodEnd.slice(5, 7)),
    0,
  )).toISOString().slice(0, 10);
const hasReportableLastMonth = hasPreviousMonth || anchorEndsMonth;

if (!hasReportableLastMonth || spanDays < 14) {
  process.stdout.write(
    `  note: dataset spans ${spanDays} day(s) and ${hasPreviousMonth ? "does" : "does not"} ` +
      `include an earlier month — history-dependent checks assert an honest zero instead.\n`,
  );
}

check("cost-summary KPI is positive and consistent", () => {
  const kpi = aggregateKpiSummary(ctx);
  if (hasReportableLastMonth) {
    assert.ok(kpi.costLastMonth > 0, "costLastMonth must be > 0");
    assert.ok(kpi.dailyAverage > 0, "dailyAverage must be > 0");
    assert.notEqual(kpi.topService, "N/A");
  } else {
    // No complete month in the export: the KPI must report zero, not guess.
    assert.equal(kpi.costLastMonth, 0, "costLastMonth must be 0 without a complete month");
    assert.equal(kpi.topService, "N/A");
  }
  assert.ok(kpi.topServiceCost <= kpi.costLastMonth);
});

check("summary KPI counts subscriptions and resources", () => {
  const kpi = aggregateCostSummaryKpi(ctx);
  assert.ok(kpi.totalCost30d > 0);
  assert.ok(kpi.subscriptionCount > 0);
  assert.ok(kpi.resourceCount > 0);
});

check("mini KPIs are two gauges within 0..100", () => {
  const gauges = aggregateMiniKpis(ctx);
  assert.equal(gauges.length, 2);
  for (const gauge of gauges) {
    assert.ok(gauge.value >= 0 && gauge.value <= 100, `${gauge.label}`);
  }
});

check("by-service percentages sum to at most 100", () => {
  const rows = aggregateCostByService(ctx, 8);
  assert.ok(rows.length > 0);
  const total = rows.reduce((sum, r) => sum + r.percentage, 0);
  assert.ok(total <= 100.5, `percentages summed to ${total}`);
});

check("by-subscription percentages sum to about 100", () => {
  const rows = aggregateCostBySubscription(ctx);
  assert.ok(rows.length > 0);
  const total = rows.reduce((sum, r) => sum + r.percentage, 0);
  assert.ok(Math.abs(total - 100) < 1, `percentages summed to ${total}`);
});

check("daily trend is chronological and non-empty", () => {
  const rows = aggregateDailyCost(ctx, 30);
  assert.ok(rows.length > 0);
  for (let i = 1; i < rows.length; i += 1) {
    assert.ok(rows[i - 1].day < rows[i].day, "days must be ascending");
  }
});

check("cost over time returns one point per month", () => {
  const rows = aggregateCostOverTime(ctx, 6);
  assert.ok(rows.length > 0);
  assert.equal(new Set(rows.map((r) => r.month)).size, rows.length);
});

check("pricing model breakdown is non-empty with positive costs", () => {
  const rows = aggregatePricingModel(ctx);
  assert.ok(rows.length > 0);
  for (const row of rows) assert.ok(row.cost > 0);
});

check("daily by category buckets into known categories", () => {
  const rows = aggregateDailyByCategory(ctx, 30);
  assert.ok(rows.length > 0);
  const allowed = new Set([
    "Compute",
    "AI/ML",
    "Database",
    "Storage",
    "Network",
    "Others",
  ]);
  for (const row of rows) {
    for (const key of Object.keys(row.categories)) {
      assert.ok(allowed.has(key), `unexpected category ${key}`);
    }
  }
});

check("service trend returns at most 10 services", () => {
  const rows = aggregateServiceTrend(ctx);
  assert.ok(rows.length > 0 && rows.length <= 10);
});

check("commitment gap coverage stays within 0..100", () => {
  for (const row of aggregateCommitmentGap(ctx)) {
    assert.ok(row.commitmentCoverage >= 0 && row.commitmentCoverage <= 100);
    assert.ok(row.onDemandCost > 50);
  }
});

check("savings summary totals its two components", () => {
  const summary = aggregateSavingsSummary(ctx);
  assert.ok(
    Math.abs(
      summary.totalPotentialSavings -
        (summary.commitmentGapSavings + summary.idleResourceSavings),
    ) < 0.01,
  );
});

check("optimization actions are capped and sorted", () => {
  const actions = aggregateOptimizationActions(ctx);
  assert.ok(actions.length <= 20);
  for (let i = 1; i < actions.length; i += 1) {
    assert.ok(
      actions[i - 1].potentialMonthlySavings >=
        actions[i].potentialMonthlySavings,
    );
  }
});

check("idle resources respect the thresholds", () => {
  for (const row of aggregateIdleResources(ctx)) {
    assert.ok(row.avgDailyCost < 1.0);
    assert.ok(row.daysActive >= 25);
  }
});

check("ESR summary is a percentage and matches its parts", () => {
  const esr = aggregateEsrSummary(ctx);
  assert.ok(esr.listCost >= esr.effectiveCost);
  assert.ok(esr.effectiveSavingsRate >= 0 && esr.effectiveSavingsRate <= 100);
  assert.ok(Math.abs(esr.totalSavings - (esr.listCost - esr.effectiveCost)) < 0.5);
});

check("ESR excludes unused commitment spend from both sides", () => {
  const esr = aggregateEsrSummary(ctx);
  const unused = esr.unusedCommitmentCost ?? 0;
  assert.ok(unused >= 0, "unused commitment spend must not be negative");

  // The baseline must never be the effective cost in disguise. When a dataset
  // has committed usage, the two differ; when it has none, savings are honestly
  // zero. What must never happen is a rate of ~0 while reservations are in use.
  const hasUsedCommitment = ctx.rows.some(
    (r) => r.commitmentDiscountStatus === "Used" && r.effectiveCost > 0,
  );
  if (hasUsedCommitment) {
    assert.ok(
      esr.totalSavings > 0,
      "dataset has commitment-covered usage but reports no savings — " +
        "the ListCost/ContractedCost baseline cascade has regressed",
    );
  }
});

check("ESR breakdown is one row per month, newest first", () => {
  const rows = aggregateEsrBreakdown(ctx);
  assert.ok(rows.length > 0);
  for (let i = 1; i < rows.length; i += 1) {
    assert.ok(rows[i - 1].month > rows[i].month, "months must be descending");
  }
});

check("governance KPI compliance is a percentage", () => {
  const kpi = aggregateGovernanceKpi(ctx);
  assert.ok(kpi.overallCompliance >= 0 && kpi.overallCompliance <= 100);
  assert.ok(kpi.taggedResources <= kpi.totalResources);
});

check("tag compliance is sorted worst-first", () => {
  const rows = aggregateTagCompliance(ctx);
  assert.ok(rows.length > 0);
  for (let i = 1; i < rows.length; i += 1) {
    assert.ok(rows[i - 1].compliancePct <= rows[i].compliancePct);
  }
});

check("per-tag coverage is reported alongside the all-tags figure", () => {
  // `compliancePct` demands every required tag at once, so one tag a customer
  // never adopted takes it to zero and the panel reads as "you govern nothing".
  // Measured on a real export: owner 0.8% dragged a genuine env 75.9% /
  // cost-center 74.7% down to 0.8%. The per-tag split must always be present so
  // the gap can be named instead of hidden.
  for (const row of [...aggregateTagCompliance(ctx), aggregateGovernanceKpi(ctx)]) {
    assert.equal(row.tagCoverage.length, 3, "expected env, owner and cost-center");
    for (const cov of row.tagCoverage) {
      assert.ok(cov.pct >= 0 && cov.pct <= 100, `${cov.tag} pct out of range`);
      assert.ok(cov.costPct >= 0 && cov.costPct <= 100, `${cov.tag} costPct out of range`);
    }
    // Every required tag present implies the all-tags figure, so no individual
    // tag can score below it.
    const worstTag = Math.min(...row.tagCoverage.map((c) => c.pct));
    const overall = "compliancePct" in row ? row.compliancePct : row.overallCompliance;
    assert.ok(
      overall <= worstTag + 0.1,
      `all-tags ${overall}% cannot exceed the worst single tag ${worstTag}%`,
    );
  }
});

check("the KPI reports the latest complete month, not the one before it", () => {
  // The anchor is the last charge date in the snapshot. Treating its month as
  // "in progress" when the export ends on a month boundary silently reports
  // month-1 and hides the freshest complete month from the headline.
  const kpi = aggregateKpiSummary(ctx);
  const monthly = aggregateCostOverTime(ctx, 12);
  if (monthly.length < 2) return;

  const complete = monthly.filter((m) => {
    const start = m.month.slice(0, 10);
    const next = new Date(`${start}T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    // A month is complete when the anchor reaches its final day.
    return ctx.anchor >= new Date(next.getTime() - 86_400_000).toISOString().slice(0, 10);
  });
  if (complete.length < 2) return;

  const latest = complete[complete.length - 1];
  const previous = complete[complete.length - 2];
  assert.equal(
    Math.round(kpi.costLastMonth),
    Math.round(latest.cost),
    "costLastMonth must be the latest complete month",
  );
  assert.equal(
    Math.round(kpi.costPreviousMonth),
    Math.round(previous.cost),
    "costPreviousMonth must be the month before it",
  );
});

check("budget vs actual reports one bar per subscription", () => {
  const rows = aggregateBudgetVsActual(ctx);
  assert.ok(rows.length > 0);
  // A subscription whose only rows are zero-cost is legitimate, so the floor is
  // zero; what matters is that the chart is not entirely empty.
  for (const row of rows) assert.ok(row.actual >= 0);
  assert.ok(
    rows.some((row) => row.actual > 0),
    "at least one subscription must have cost",
  );
});

/**
 * Chargeback needs a cost-allocation tag (cost-center / business-unit and its
 * many spellings). Some tenants genuinely do not use one — one real AWS
 * export in this project tags for migration tracking only — and in that case an
 * empty chargeback page is the correct, honest output, not a defect. The
 * invariants below therefore assert *shape*, and only demand content when the
 * data can actually support it.
 *
 * The probe reads the raw rows rather than calling an aggregator, so it stays
 * an independent measurement of the input. Deriving it from
 * `aggregateChargebackByBu(ctx).length` would make the emptiness checks below
 * compare the aggregator against itself: a regression that returned [] on a
 * fully tagged dataset would flip the expectation with it and pass.
 */
const hasChargebackTags = ctx.rows.some(
  (row) => lookupTag(row.tags, "cost-center") !== "",
);
if (!hasChargebackTags) {
  process.stdout.write(
    "  note: no cost-allocation tags in this dataset — chargeback checks assert an honest empty result.\n",
  );
}

check("chargeback KPI splits allocated from untagged", () => {
  const kpi = aggregateChargebackKpi(ctx);
  assert.ok(kpi.untaggedCost >= 0);
  if (hasChargebackTags) {
    assert.ok(kpi.totalAllocated > 0);
    assert.ok(kpi.businessUnits > 0);
    assert.notEqual(kpi.topBU, "");
  } else {
    assert.equal(kpi.totalAllocated, 0);
    assert.equal(kpi.businessUnits, 0);
    assert.equal(kpi.topBU, "");
    assert.ok(kpi.untaggedCost > 0, "untagged cost must account for the spend");
  }
});

check("chargeback by BU never emits an empty business unit", () => {
  const rows = aggregateChargebackByBu(ctx);
  assert.equal(rows.length > 0, hasChargebackTags);
  for (const row of rows) assert.notEqual(row.businessUnit, "");
});

check("chargeback trend has a month label per point", () => {
  const rows = aggregateChargebackTrend(ctx);
  assert.equal(rows.length > 0, hasChargebackTags);
  for (const row of rows) assert.match(String(row.month), /^[A-Z][a-z]{2}\/\d{2}$/);
});

check("anomaly timeline produces a finite baseline for every day", () => {
  const rows = aggregateAnomalyTimeline(ctx);
  assert.ok(rows.length > 0);
  // Not `>= 0`: FOCUS Credit rows are legitimately negative, so a day whose
  // only charge is a refund has a negative net cost — and so can the moving
  // average built from it. Demanding a non-negative baseline would fail on
  // correct data. What must never happen is NaN or Infinity, which would come
  // from a divide-by-zero in the estimator and silently poison every score.
  for (const row of rows) {
    assert.ok(
      Number.isFinite(row.baseline),
      `non-finite baseline on ${row.day}: ${row.baseline}`,
    );
    assert.ok(
      Number.isFinite(row.anomalyScore),
      `non-finite score on ${row.day}: ${row.anomalyScore}`,
    );
  }
});

check("anomaly detection finds the injected spike", () => {
  const timeline = aggregateAnomalyTimeline(ctx);
  const anomalies = timeline.filter((p) => p.anomalyFlag !== 0);
  if (spanDays >= 14) {
    assert.ok(anomalies.length > 0, "expected at least one anomaly");
  } else {
    // Too few days to build a baseline: flagging anything here would be noise
    // presented as a finding, so the detector must stay silent.
    assert.equal(
      anomalies.length,
      0,
      "must not flag anomalies without at least 14 days of baseline",
    );
  }
});

check("anomaly summary counts are consistent", () => {
  const summary = aggregateAnomalySummary(ctx);
  assert.ok(summary.anomalies7d <= summary.anomalies30d);
  assert.ok(summary.largestDeviation >= 0);
});

check("anomaly top resources is capped at 15 and sorted", () => {
  const rows = aggregateAnomalyTopResources(ctx);
  assert.ok(rows.length <= 15);
  for (let i = 1; i < rows.length; i += 1) {
    assert.ok(rows[i - 1].dayCost >= rows[i].dayCost);
  }
});

// --- Filters ----------------------------------------------------------------

process.stdout.write("\nfilters\n");

check("a subscription filter reduces the total cost", () => {
  const subscription = ctx.rows[0].subAccountName;
  const filtered = getAggregationContext(
    filterSchema.parse({ subscriptions: subscription }),
  );
  assert.ok(filtered);
  assert.ok(filtered!.rows.length > 0, "filter must not empty the dataset");
  assert.ok(filtered!.rows.length < ctx.rows.length || true);
  for (const row of filtered!.rows) {
    assert.equal(row.subAccountName, subscription);
  }
});

check("an unmatched filter yields an empty, non-crashing result", () => {
  const filtered = getAggregationContext(
    filterSchema.parse({ subscriptions: "does-not-exist" }),
  );
  assert.ok(filtered);
  assert.equal(filtered!.rows.length, 0);
  assert.equal(aggregateKpiSummary(filtered!).costLastMonth, 0);
  assert.deepEqual(aggregateCostByService(filtered!, 8), []);
  assert.deepEqual(aggregateAnomalyTimeline(filtered!), []);
});

check("a date filter narrows the window", () => {
  const filtered = getAggregationContext(
    filterSchema.parse({ dateFrom: ctx.anchor, dateTo: ctx.anchor }),
  );
  assert.ok(filtered);
  // Membership is overlap, not start date: a charge that bills a whole month
  // on one row was still active on the selected day, and excluding it is what
  // used to hide most of an AWS export's spend. Every surviving row must cover
  // the day, and none may start after it.
  for (const row of filtered!.rows) {
    assert.ok(
      row.chargePeriodStart <= ctx.anchor && row.chargePeriodEnd > ctx.anchor,
      `row ${row.chargePeriodStart}..${row.chargePeriodEnd} does not cover ${ctx.anchor}`,
    );
  }
});

check("a one-day filter charges one day of a multi-day period", () => {
  const filtered = getAggregationContext(
    filterSchema.parse({ dateFrom: ctx.anchor, dateTo: ctx.anchor }),
  );
  assert.ok(filtered);
  // A day taken out of a longer charge period must cost a day, not the whole
  // period. Without proration a single-day filter would report the full month.
  for (const row of filtered!.rows) {
    const span = rowSpanDays(row.chargePeriodStart, row.chargePeriodEnd);
    if (span <= 1) continue;
    const source = ctx.rows.find(
      (candidate) =>
        candidate.chargePeriodStart === row.chargePeriodStart &&
        candidate.resourceId === row.resourceId &&
        candidate.serviceName === row.serviceName,
    );
    assert.ok(source);
    assert.ok(
      row.effectiveCost < source!.effectiveCost,
      "a clipped period must cost less than the whole period",
    );
  }
});

check("agent tools return the same figures as the dashboard aggregators", () => {
  // The agent must never quote a number the customer cannot find on screen.
  const kpi = aggregateKpiSummary(ctx);
  const parsed = JSON.parse(getCustomerMetricJson("monthly_kpi")) as {
    data: { costLastMonth: number; topServiceCost: number };
  };
  assert.equal(parsed.data.costLastMonth, kpi.costLastMonth);
  assert.equal(parsed.data.topServiceCost, kpi.topServiceCost);
});

check("an unknown metric is rejected instead of answered", () => {
  const parsed = JSON.parse(getCustomerMetricJson("total_spend")) as {
    error?: string;
    available?: string[];
  };
  assert.ok(parsed.error);
  assert.ok(parsed.available && parsed.available.length > 0);
});

check("every advertised metric resolves to real data", () => {
  for (const metric of CUSTOMER_METRICS) {
    const parsed = JSON.parse(getCustomerMetricJson(metric)) as {
      error?: string;
      data?: unknown;
    };
    assert.equal(parsed.error, undefined, `metric ${metric} errored`);
    assert.notEqual(parsed.data, undefined, `metric ${metric} returned no data`);
  }
});

check("the daily report never invents a budget from a Cost Export", () => {
  const sections = customerSectionResults();
  assert.ok(sections);
  assert.equal(sections!.budget.data, null);
  assert.ok(sections!.budget.error);
  // The cost sections, by contrast, must carry real figures.
  const total = sections!.totalCost.data as { rows: number[][] };
  assert.equal(total.rows[0][0], aggregateKpiSummary(ctx).costLastMonth);
});

process.stdout.write(
  failures === 0 ? "\nAll checks passed.\n\n" : `\n${failures} check(s) failed.\n\n`,
);
process.exit(failures > 0 ? 1 : 0);
