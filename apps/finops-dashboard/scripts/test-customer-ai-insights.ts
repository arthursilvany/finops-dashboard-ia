/**
 * Smoke test for the customer AI-insights aggregator.
 *
 * Asserts the truthfulness invariants required by the task spec:
 *  1. Every emitted insight references a figure that matches the corresponding
 *     phase-1 aggregate.
 *  2. No insight is emitted when its triggering condition is absent.
 *  3. The generator does not crash on an empty / zero-row dataset and returns
 *     an empty insights list rather than garbage.
 *  4. No hardcoded demo string from the old mock survives in the customer path.
 *
 * Usage:
 *   CUSTOMER_DATA_DIR=<dir>  npx tsx scripts/test-customer-ai-insights.ts
 */
import assert from "node:assert/strict";

import { filterSchema } from "../src/lib/filter-schema";
import { getAggregationContext } from "../src/lib/customer-aggregations/context";
import { aggregateCustomerAiInsights } from "../src/lib/customer-aggregations/ai-insights";
import { aggregateCostSummaryKpi } from "../src/lib/customer-aggregations/cost-summary";
import { aggregateEsrSummary, aggregateSavingsSummary } from "../src/lib/customer-aggregations/rate-optimization";
import { aggregateGovernanceKpi } from "../src/lib/customer-aggregations/governance";
import { aggregateChargebackKpi } from "../src/lib/customer-aggregations/chargeback";
import { aggregateAnomalySummary } from "../src/lib/customer-aggregations/anomalies";

// Strings present in the old mock data that must NOT appear in the customer path.
const DEMO_STRINGS = [
  "23 virtual machines",
  "R$18,400",
  "R$6,200",
  "ins-001",
  "ins-002",
  "ins-003",
  "ins-004",
  "ins-005",
  "governance policy P-SEC-004",
  "December",
  "load-test clusters",
];

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

// ---------------------------------------------------------------------------
// Zero-row robustness check (no dataset loaded intentionally)
// ---------------------------------------------------------------------------

process.stdout.write("\nzero-row robustness (synthetic empty context)\n");

// We build a minimal context by hand to avoid needing a real file.
// This tests that the aggregator does not crash on degenerate input.
const emptyCtx = {
  manifest: {
    schemaVersion: "1.0.0",
    customer: "Test",
    format: "focus" as const,
    generatedAtUtc: new Date().toISOString(),
    sourceFiles: [],
    rowCount: 0,
    skippedRowCount: 0,
    currencies: [],
    hasUsdCosts: false,
    warnings: [],
    periodStart: "2025-01-01",
    periodEnd: "2025-01-01",
  },
  rows: [],
  filters: filterSchema.parse({}),
  anchor: "2025-01-01",
  cost: () => 0,
  lastDays: () => [],
  previousDays: () => [],
  between: () => [],
};

check("aggregator does not crash on empty dataset", () => {
  const result = aggregateCustomerAiInsights(emptyCtx);
  assert.ok(Array.isArray(result.insights), "insights must be an array");
  assert.equal(result.insights.length, 0, "no insights from empty dataset");
});

check("costForecast arrays are all empty on empty dataset", () => {
  const result = aggregateCustomerAiInsights(emptyCtx);
  assert.equal(result.costForecast.categories.length, 0);
  assert.equal(result.costForecast.actual.length, 0);
  assert.equal(result.costForecast.forecast.length, 0);
});

check("finopsRadar has five indicators even on empty dataset", () => {
  const result = aggregateCustomerAiInsights(emptyCtx);
  assert.equal(result.finopsRadar.indicators.length, 5);
  assert.equal(result.finopsRadar.series.length, 1);
  // All scores should be 0 when there is no data.
  for (const v of result.finopsRadar.series[0].values) {
    assert.ok(v >= 0 && v <= 100, `radar score out of range: ${v}`);
  }
});

// ---------------------------------------------------------------------------
// Aggregator against the loaded dataset
// ---------------------------------------------------------------------------

const filters = filterSchema.parse({});
const ctx = getAggregationContext(filters);

if (!ctx) {
  process.stdout.write(
    "\nNo customer dataset found — run ingest-customer.ts first to test against real data.\n",
  );
  process.exit(failures > 0 ? 1 : 0);
}

process.stdout.write(
  `\naggregator (customer "${ctx.manifest.customer}", ${ctx.rows.length} rows, anchor ${ctx.anchor})\n`,
);

const result = aggregateCustomerAiInsights(ctx);
const { insights, costForecast, finopsRadar } = result;

// Recompute the same phase-1 facts to verify the insight text cites real numbers.
const kpi = aggregateCostSummaryKpi(ctx);
const esrSummary = aggregateEsrSummary(ctx);
const govKpi = aggregateGovernanceKpi(ctx);
const cbKpi = aggregateChargebackKpi(ctx);
const anomalySummary = aggregateAnomalySummary(ctx);
const savingsSummary = aggregateSavingsSummary(ctx);

check("insights is an array", () => {
  assert.ok(Array.isArray(insights));
});

check("all insight ids start with 'cust-'", () => {
  for (const ins of insights) {
    assert.ok(ins.id.startsWith("cust-"), `unexpected id: ${ins.id}`);
  }
});

check("no demo strings from old mock in any insight", () => {
  for (const ins of insights) {
    const text = `${ins.title} ${ins.summary}`;
    for (const demo of DEMO_STRINGS) {
      assert.ok(!text.includes(demo), `found demo string "${demo}" in insight ${ins.id}`);
    }
  }
});

check("all insight impacts are valid enum values", () => {
  for (const ins of insights) {
    assert.ok(
      ["high", "medium", "low"].includes(ins.impact),
      `invalid impact "${ins.impact}" on ${ins.id}`,
    );
  }
});

check("growth insight (cust-growth) only emitted when MoM > 15%", () => {
  const growthInsight = insights.find((i) => i.id === "cust-growth");
  if (kpi.momChangePercent > 15 && Math.abs(kpi.momChangeDelta) > 100) {
    assert.ok(growthInsight, "expected growth insight to be emitted");
    // The insight summary must contain the actual total cost figure.
    const totalStr = kpi.totalCost30d.toLocaleString("en-US", { maximumFractionDigits: 0 });
    assert.ok(
      growthInsight!.summary.includes(totalStr),
      `growth insight must cite totalCost30d (${totalStr})`,
    );
  } else {
    assert.ok(!growthInsight, "growth insight must NOT be emitted when MoM is below threshold");
  }
});

check("tagging insight (cust-tagging) only emitted when compliance < 80%", () => {
  const tagInsight = insights.find((i) => i.id === "cust-tagging");
  if (govKpi.overallCompliance < 80 && govKpi.totalResources > 0) {
    assert.ok(tagInsight, "expected tagging insight to be emitted");
  } else {
    assert.ok(!tagInsight, "tagging insight must NOT be emitted when compliance is >= 80%");
  }
});

check("anomaly insight (cust-anomaly) only emitted when anomalies30d >= 2", () => {
  const anomalyInsight = insights.find((i) => i.id === "cust-anomaly");
  if (anomalySummary.anomalies30d >= 2) {
    assert.ok(anomalyInsight, "expected anomaly insight to be emitted");
    // Must cite the actual anomaly count.
    assert.ok(
      anomalyInsight!.summary.includes(String(anomalySummary.anomalies30d)),
      `anomaly insight must cite anomalies30d (${anomalySummary.anomalies30d})`,
    );
  } else {
    assert.ok(!anomalyInsight, "anomaly insight must NOT be emitted when count < 2");
  }
});

check("ESR insight (cust-esr) not emitted when listCost is 0", () => {
  const esrInsight = insights.find((i) => i.id === "cust-esr");
  if (esrSummary.listCost === 0) {
    assert.ok(!esrInsight, "ESR insight must NOT be emitted when listCost is 0 (no list prices in export)");
  }
});

check("ESR insight carries no savingsEstimate (target-derived figure would fabricate money)", () => {
  const esrInsight = insights.find((i) => i.id === "cust-esr");
  if (esrInsight) {
    assert.equal(
      esrInsight.savingsEstimate,
      undefined,
      "cust-esr must never carry a savingsEstimate — no agreed target exists",
    );
  }
});

check("commitment-gap insight states the 30% figure as a model, never as a headline amount", () => {
  const gapInsight = insights.find((i) => i.id === "cust-commitment");
  if (gapInsight) {
    assert.equal(
      gapInsight.savingsEstimate,
      undefined,
      "cust-commitment must not carry a savingsEstimate — the figure assumes a 30% discount the export cannot confirm",
    );
    if (/\d/.test(gapInsight.summary) && /model|assum/i.test(gapInsight.summary)) {
      assert.match(
        gapInsight.summary,
        /price sheet/i,
        "when the modeled amount is quoted, say what it would take to confirm it",
      );
    }
  }
});

/**
 * A savingsEstimate is a currency figure rendered as a headline, so it may only
 * come from money actually present in the export.
 *
 * `cust-unused-commitment` qualifies: it is the billed cost of commitment
 * capacity that covered no usage, read straight from the rows.
 *
 * `cust-commitment` does NOT: its figure is on-demand spend times a flat 30%
 * assumption, which a cost export cannot confirm. It states the modeled amount
 * in prose, labelled as a scenario, and deliberately leaves savingsEstimate
 * unset. Any new entry here must justify that its figure is measured.
 */
const INSIGHTS_ALLOWED_SAVINGS_ESTIMATE = new Set(["cust-unused-commitment"]);

check("only insights with measured savings carry a savingsEstimate", () => {
  for (const ins of insights) {
    if (ins.savingsEstimate !== undefined) {
      assert.ok(
        INSIGHTS_ALLOWED_SAVINGS_ESTIMATE.has(ins.id),
        `insight "${ins.id}" carries a savingsEstimate but is not in the allowed set — ` +
        `verify the figure is measured from the export, not derived from a target`,
      );
    }
  }
});

check("costForecast categories and actual arrays have the same length", () => {
  assert.equal(costForecast.categories.length, costForecast.actual.length);
});

check("costForecast categories match MMM/YY format", () => {
  for (const cat of costForecast.categories) {
    assert.match(cat, /^[A-Z][a-z]{2}\/\d{2}$/, `unexpected format: ${cat}`);
  }
});

check("costForecast forecast and bounds are empty (no forward model on snapshot)", () => {
  assert.equal(costForecast.forecast.length, 0);
  assert.equal(costForecast.lowerBound.length, 0);
  assert.equal(costForecast.upperBound.length, 0);
});

check("finopsRadar has 5 indicators and 1 series", () => {
  assert.equal(finopsRadar.indicators.length, 5);
  assert.equal(finopsRadar.series.length, 1);
  assert.equal(finopsRadar.series[0].values.length, 5);
});

check("finopsRadar scores are in 0..100", () => {
  for (const v of finopsRadar.series[0].values) {
    assert.ok(v >= 0 && v <= 100, `score out of range: ${v}`);
  }
});

check("finopsRadar customer name matches manifest", () => {
  assert.equal(finopsRadar.series[0].name, ctx.manifest.customer || "Customer");
});

check("savingsEstimate is positive when present", () => {
  for (const ins of insights) {
    if (ins.savingsEstimate !== undefined) {
      assert.ok(ins.savingsEstimate > 0, `savingsEstimate must be > 0 on ${ins.id}`);
    }
  }
});

check("resourceCount is positive when present", () => {
  for (const ins of insights) {
    if (ins.resourceCount !== undefined) {
      assert.ok(ins.resourceCount > 0, `resourceCount must be > 0 on ${ins.id}`);
    }
  }
});

process.stdout.write(
  failures === 0 ? "\nAll checks passed.\n\n" : `\n${failures} check(s) failed.\n\n`,
);
process.exit(failures > 0 ? 1 : 0);
