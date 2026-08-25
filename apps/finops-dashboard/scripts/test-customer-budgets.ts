/**
 * Smoke test for the customer POC budget aggregators.
 *
 * Runs all four budget aggregators against whatever dataset is active under
 * `output/customer/` (or the roots set via CUSTOMER_DATA_DIR /
 * CUSTOMER_OUTPUT_DIR)
 * and asserts the invariants that would embarrass someone in a customer meeting.
 *
 * Usage:
 *   npx tsx scripts/test-customer-budgets.ts
 *
 * Run from apps/finops-dashboard. Works with both FOCUS and legacy datasets.
 */
import assert from "node:assert/strict";

import { filterSchema } from "../src/lib/filter-schema";
import { getAggregationContext } from "../src/lib/customer-aggregations/context";
import {
  aggregateBudgetVsActual,
  aggregateBudgetBySubscription,
  aggregateBurnRate,
  aggregateForecast,
  aggregateForecastConfidence,
} from "../src/lib/customer-aggregations/budgets";

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

const filters = filterSchema.parse({});
const ctx = getAggregationContext(filters);

if (!ctx) {
  process.stdout.write(
    "\nNo customer dataset found — run `npm run ingest:customer` first to test the budget aggregators.\n",
  );
  process.exit(0);
}

process.stdout.write(
  `\nbudget aggregators (customer "${ctx.manifest.customer}", ${ctx.rows.length} rows, anchor ${ctx.anchor})\n`,
);

// ---------------------------------------------------------------------------
// vs-actual
// ---------------------------------------------------------------------------
process.stdout.write("\nvs-actual\n");

const vsActual = aggregateBudgetVsActual(ctx);

check("vs-actual is non-empty", () => {
  assert.ok(vsActual.length > 0, "expected at least one daily point");
});

check("vs-actual days are ascending", () => {
  for (let i = 1; i < vsActual.length; i += 1) {
    assert.ok(
      vsActual[i - 1].day < vsActual[i].day,
      `day out of order at index ${i}`,
    );
  }
});

// Credits, refunds and rebates are legitimately negative charges, and AWS
// exports carry them routinely. The invariant worth protecting is that the
// aggregator never *invents* a negative day: it may only report one when the
// dataset actually contains negative charges.
const hasNegativeCharges = ctx.rows.some((row) => row.effectiveCost < 0);

check("vs-actual daily costs are non-negative", () => {
  if (hasNegativeCharges) {
    process.stdout.write("    (dataset has credits/refunds: negative days allowed)\n");
    return;
  }
  for (const pt of vsActual) {
    assert.ok(pt.dailyCost >= 0, `negative dailyCost on ${pt.day}`);
  }
});

check("vs-actual cumulative is monotonically non-decreasing", () => {
  if (hasNegativeCharges) {
    process.stdout.write("    (dataset has credits/refunds: dips allowed)\n");
    return;
  }
  for (let i = 1; i < vsActual.length; i += 1) {
    assert.ok(
      vsActual[i].cumulativeActual >= vsActual[i - 1].cumulativeActual - 0.01,
      `cumulative regressed at index ${i}`,
    );
  }
});

check("vs-actual cumulativeBudget is 0 (no budget in export)", () => {
  for (const pt of vsActual) {
    assert.equal(pt.cumulativeBudget, 0);
  }
});

check("vs-actual last cumulative matches sum of daily costs", () => {
  const sumDaily = vsActual.reduce((s, p) => s + p.dailyCost, 0);
  const last = vsActual[vsActual.length - 1].cumulativeActual;
  assert.ok(Math.abs(sumDaily - last) < 0.5, `sum=${sumDaily} vs cumulative=${last}`);
});

// ---------------------------------------------------------------------------
// by-subscription
// ---------------------------------------------------------------------------
process.stdout.write("\nby-subscription\n");

const bySub = aggregateBudgetBySubscription(ctx);

check("by-subscription is non-empty", () => {
  assert.ok(bySub.length > 0);
});

check("by-subscription costs are never negative", () => {
  // A subscription can legitimately have zero cost in a given window (e.g. one
  // that only holds free-tier resources), so zero is valid data, not a bug.
  // A negative total, however, would mean the sign handling is broken.
  for (const row of bySub) {
    assert.ok(row.cost >= 0, `negative cost for ${row.subscriptionName}`);
  }
  assert.ok(
    bySub.some((row) => row.cost > 0),
    "at least one subscription must have cost",
  );
});

check("by-subscription percentOfBudget is 0 (no budget in export)", () => {
  for (const row of bySub) {
    assert.equal(row.percentOfBudget, 0);
  }
});

check("by-subscription is sorted descending by cost", () => {
  for (let i = 1; i < bySub.length; i += 1) {
    assert.ok(
      bySub[i - 1].cost >= bySub[i].cost,
      `not sorted at index ${i}`,
    );
  }
});

check("by-subscription has no blank subscription names", () => {
  for (const row of bySub) {
    assert.ok(row.subscriptionName.trim() !== "", "blank subscriptionName");
  }
});

// ---------------------------------------------------------------------------
// burn-rate
// ---------------------------------------------------------------------------
process.stdout.write("\nburn-rate\n");

const burnRate = aggregateBurnRate(ctx);

check("burn-rate spentSoFar is positive", () => {
  assert.ok(burnRate.spentSoFar > 0);
});

check("burn-rate dailyBurnRate is positive", () => {
  assert.ok(burnRate.dailyBurnRate > 0);
});

check("burn-rate projectedMonthEnd >= spentSoFar", () => {
  assert.ok(
    burnRate.projectedMonthEnd >= burnRate.spentSoFar,
    `projected=${burnRate.projectedMonthEnd} spentSoFar=${burnRate.spentSoFar}`,
  );
});

check("burn-rate projectedMonthEnd is a sane multiple of spentSoFar (0.5x–40x)", () => {
  // Upper bound: if the anchor is the very first day of the month, spentSoFar = 1 day
  // and projectedMonthEnd includes up to 30 remaining days, so the ratio can reach ~31.
  // Allow 40x to accommodate datasets where anchor is the 1st and daily spend varies.
  const ratio = burnRate.projectedMonthEnd / burnRate.spentSoFar;
  assert.ok(
    ratio >= 0.5 && ratio <= 40,
    `projected/spent ratio ${ratio.toFixed(2)} is implausible`,
  );
});

check("burn-rate budget fields neutralised", () => {
  assert.equal(burnRate.budget, 0);
  assert.equal(burnRate.budgetVariance, 0);
  assert.equal(burnRate.budgetUsedPercent, 0);
  // Must be "NO_BUDGET", never "ON_TRACK" — that would falsely assert the
  // spend is within a budget when the export contains no budget data at all.
  assert.equal(
    burnRate.status,
    "NO_BUDGET",
    `status must be "NO_BUDGET" when no budget data is available, got "${burnRate.status}"`,
  );
});

// ---------------------------------------------------------------------------
// forecast (budget mode)
// ---------------------------------------------------------------------------
process.stdout.write("\nforecast (budget mode)\n");

const forecast = aggregateForecast(ctx);

check("forecast is non-empty", () => {
  assert.ok(forecast.length > 0);
});

check("forecast days are ascending", () => {
  for (let i = 1; i < forecast.length; i += 1) {
    assert.ok(forecast[i - 1].day < forecast[i].day, `day out of order at index ${i}`);
  }
});

check("forecast dailyBudgetTarget is 0 (no budget in export)", () => {
  for (const pt of forecast) {
    assert.equal(pt.dailyBudgetTarget, 0);
  }
});

check("forecast has at least one historical point and one projection", () => {
  const hasHistorical = forecast.some((p) => p.dailyCost !== null);
  const hasProjection = forecast.some((p) => p.dailyForecast !== null);
  assert.ok(hasHistorical, "no historical daily cost points");
  assert.ok(hasProjection, "no projection points");
});

check("forecast no point has BOTH dailyCost and dailyForecast set", () => {
  for (const pt of forecast) {
    const both = pt.dailyCost !== null && pt.dailyForecast !== null;
    assert.ok(!both, `both dailyCost and dailyForecast set on ${pt.day}`);
  }
});

check("forecast projected rate is within 0.05x–20x of historical average", () => {
  const historical = forecast.filter((p) => p.dailyCost !== null);
  const projected = forecast.filter((p) => p.dailyForecast !== null);
  if (historical.length === 0 || projected.length === 0) return;

  const avgHistorical =
    historical.reduce((s, p) => s + (p.dailyCost ?? 0), 0) / historical.length;
  const projectionRate = projected[0].dailyForecast ?? 0;

  if (avgHistorical > 0 && projectionRate > 0) {
    const ratio = projectionRate / avgHistorical;
    assert.ok(
      ratio >= 0.05 && ratio <= 20,
      `forecast rate / historical avg = ${ratio.toFixed(2)} (implausible)`,
    );
  }
});

// ---------------------------------------------------------------------------
// forecast (confidence mode)
// ---------------------------------------------------------------------------
process.stdout.write("\nforecast (confidence mode)\n");

const confidence = aggregateForecastConfidence(ctx);

check("confidence forecast is non-empty", () => {
  assert.ok(confidence.length > 0);
});

check("confidence forecast has lowerBound <= forecast <= upperBound", () => {
  for (const pt of confidence) {
    assert.ok(
      pt.lowerBound <= pt.forecast + 0.01 && pt.forecast <= pt.upperBound + 0.01,
      `bounds violated on ${pt.day}: [${pt.lowerBound}, ${pt.forecast}, ${pt.upperBound}]`,
    );
  }
});

check("confidence forecast days are ascending", () => {
  for (let i = 1; i < confidence.length; i += 1) {
    assert.ok(
      confidence[i - 1].day < confidence[i].day,
      `day out of order at index ${i}`,
    );
  }
});

check("confidence forecast rate is positive", () => {
  for (const pt of confidence) {
    assert.ok(pt.forecast >= 0, `negative forecast on ${pt.day}`);
  }
});

// ---------------------------------------------------------------------------
// Edge case: unmatched filter yields non-crashing results
// ---------------------------------------------------------------------------
process.stdout.write("\nedge cases\n");

const emptyCtx = getAggregationContext(
  filterSchema.parse({ subscriptions: "does-not-exist" }),
);

check("empty filter: aggregators do not crash", () => {
  assert.ok(emptyCtx, "context should still be returned for empty filter");
  assert.deepEqual(aggregateBudgetVsActual(emptyCtx!), []);
  assert.deepEqual(aggregateBudgetBySubscription(emptyCtx!), []);

  const br = aggregateBurnRate(emptyCtx!);
  assert.equal(br.spentSoFar, 0);
  assert.equal(br.dailyBurnRate, 0);
  assert.equal(br.projectedMonthEnd, 0);
});

check("empty filter: forecast returns days but no historical cost", () => {
  if (!emptyCtx) return;
  const fc = aggregateForecast(emptyCtx);
  // Historical days (up to and including the anchor) have dailyCost = null
  // because there are no rows. Future days have dailyForecast = 0 (zero rate).
  // No point should have a non-null dailyCost.
  for (const pt of fc) {
    assert.equal(
      pt.dailyCost,
      null,
      `expected dailyCost null on ${pt.day}, got ${pt.dailyCost}`,
    );
    // dailyForecast is null on historical days and 0 on projected days — never positive.
    assert.ok(
      pt.dailyForecast === null || pt.dailyForecast === 0,
      `expected null or 0 dailyForecast on ${pt.day}, got ${pt.dailyForecast}`,
    );
  }
});

process.stdout.write(
  failures === 0
    ? "\nAll budget checks passed.\n\n"
    : `\n${failures} check(s) failed.\n\n`,
);
process.exit(failures > 0 ? 1 : 0);
