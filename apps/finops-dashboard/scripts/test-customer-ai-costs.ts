/**
 * Smoke test for the AI costs customer POC aggregators.
 *
 * Follows the exact `check(name, fn)` pattern of test-customer-aggregations.ts.
 * Run after ingesting a customer dataset:
 *
 *   npx tsx scripts/test-customer-ai-costs.ts
 *
 * Run against both formats to verify legacy handling:
 *
 *   npx tsx scripts/generate-sample-export.ts --format focus  --out sample-export.csv
 *   npx tsx scripts/ingest-customer.ts "AI Test Focus"
 *   npx tsx scripts/test-customer-ai-costs.ts
 *
 *   npx tsx scripts/generate-sample-export.ts --format legacy --out sample-export.csv
 *   npx tsx scripts/ingest-customer.ts "AI Test Legacy"
 *   npx tsx scripts/test-customer-ai-costs.ts
 */
import assert from "node:assert/strict";

import { filterSchema } from "../src/lib/filter-schema";
import { getAggregationContext } from "../src/lib/customer-aggregations/context";
import {
  aggregateAiCostKpi,
  aggregateAiCostDaily,
  aggregateAiCostByResource,
  aggregateAiCostByModel,
  aggregateAiCostAllocation,
  aggregateAiAnomalyTimeline,
  aggregateAiAnomalyTopResources,
} from "../src/lib/customer-aggregations/ai-costs";

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
// Dataset
// ---------------------------------------------------------------------------

const filters = filterSchema.parse({});
const ctx = getAggregationContext(filters);

if (!ctx) {
  process.stdout.write(
    "\nNo customer dataset found — run `npm run ingest:customer` first.\n",
  );
  process.exit(failures > 0 ? 1 : 0);
}

const aiRows = ctx.rows.filter(
  (r) => r.serviceCategory === "AI and Machine Learning",
);

process.stdout.write(
  `\nAI cost aggregators (customer "${ctx.manifest.customer}", ${ctx.rows.length} total rows, ${aiRows.length} AI rows, anchor ${ctx.anchor})\n`,
);

if (aiRows.length === 0) {
  process.stdout.write(
    "\nWARN: No AI rows in this dataset — the sample generator always emits Azure OpenAI rows, so this dataset may not be a standard sample export.\n",
  );
}

// ---------------------------------------------------------------------------
// KPI
// ---------------------------------------------------------------------------

process.stdout.write("\nkpi\n");

check("KPI does not crash with no AI rows", () => {
  const emptyCtx = getAggregationContext(
    filterSchema.parse({ subscriptions: "__no_match__" }),
  );
  assert.ok(emptyCtx);
  const kpi = aggregateAiCostKpi(emptyCtx!);
  assert.equal(kpi.totalCost30d, 0);
  assert.equal(kpi.resourceCount, 0);
  assert.equal(kpi.momChangePercent, 0);
});

check("KPI totals are non-negative", () => {
  const kpi = aggregateAiCostKpi(ctx);
  assert.ok(kpi.totalCost30d >= 0, "totalCost30d >= 0");
  assert.ok(kpi.costPrevious30d >= 0, "costPrevious30d >= 0");
  assert.ok(kpi.avgCostPerResource >= 0, "avgCostPerResource >= 0");
  assert.ok(kpi.topModelCost >= 0, "topModelCost >= 0");
});

check("KPI topModelCost <= totalCost30d", () => {
  const kpi = aggregateAiCostKpi(ctx);
  assert.ok(
    kpi.topModelCost <= kpi.totalCost30d + 0.01,
    `topModelCost (${kpi.topModelCost}) must not exceed totalCost30d (${kpi.totalCost30d})`,
  );
});

if (aiRows.length > 0) {
  check("KPI is positive when dataset has AI rows", () => {
    const kpi = aggregateAiCostKpi(ctx);
    assert.ok(kpi.totalCost30d > 0, `totalCost30d is ${kpi.totalCost30d}`);
    assert.ok(kpi.resourceCount > 0, "resourceCount > 0");
    assert.notEqual(kpi.topModel, "N/A");
  });
}

// ---------------------------------------------------------------------------
// Daily
// ---------------------------------------------------------------------------

process.stdout.write("\ndaily\n");

check("daily does not crash with no AI rows", () => {
  const emptyCtx = getAggregationContext(
    filterSchema.parse({ subscriptions: "__no_match__" }),
  );
  assert.ok(emptyCtx);
  const rows = aggregateAiCostDaily(emptyCtx!);
  assert.deepEqual(rows, []);
});

if (aiRows.length > 0) {
  check("daily is non-empty when dataset has AI rows", () => {
    const rows = aggregateAiCostDaily(ctx);
    assert.ok(rows.length > 0, "expected at least one day");
  });

  check("daily is chronologically sorted", () => {
    const rows = aggregateAiCostDaily(ctx);
    for (let i = 1; i < rows.length; i += 1) {
      assert.ok(rows[i - 1].day < rows[i].day, "days must be ascending");
    }
  });

  check("daily costs are non-negative", () => {
    for (const row of aggregateAiCostDaily(ctx)) {
      assert.ok(row.cost >= 0, `negative cost on ${row.day}`);
    }
  });

  check("daily day strings are ISO-8601", () => {
    for (const row of aggregateAiCostDaily(ctx)) {
      assert.match(row.day, /^\d{4}-\d{2}-\d{2}T/, `bad date ${row.day}`);
    }
  });
}

// ---------------------------------------------------------------------------
// By resource
// ---------------------------------------------------------------------------

process.stdout.write("\nby-resource\n");

check("by-resource does not crash with empty filter", () => {
  const emptyCtx = getAggregationContext(
    filterSchema.parse({ subscriptions: "__no_match__" }),
  );
  assert.ok(emptyCtx);
  assert.deepEqual(aggregateAiCostByResource(emptyCtx!), []);
});

if (aiRows.length > 0) {
  check("by-resource returns rows when AI data exists", () => {
    const rows = aggregateAiCostByResource(ctx);
    assert.ok(rows.length > 0);
  });

  check("by-resource is sorted descending by cost", () => {
    const rows = aggregateAiCostByResource(ctx);
    for (let i = 1; i < rows.length; i += 1) {
      assert.ok(
        rows[i - 1].cost >= rows[i].cost,
        "rows must be sorted descending",
      );
    }
  });

  check("by-resource costs and dailyAvg are non-negative", () => {
    for (const row of aggregateAiCostByResource(ctx)) {
      assert.ok(row.cost >= 0, `cost < 0 for ${row.resourceName}`);
      assert.ok(row.dailyAvg >= 0, `dailyAvg < 0 for ${row.resourceName}`);
    }
  });

  check("by-resource model field is never empty", () => {
    for (const row of aggregateAiCostByResource(ctx)) {
      assert.ok(row.model.length > 0, `empty model for ${row.resourceName}`);
    }
  });
}

// ---------------------------------------------------------------------------
// By model
// ---------------------------------------------------------------------------

process.stdout.write("\nby-model\n");

check("by-model does not crash with empty filter", () => {
  const emptyCtx = getAggregationContext(
    filterSchema.parse({ subscriptions: "__no_match__" }),
  );
  assert.ok(emptyCtx);
  assert.deepEqual(aggregateAiCostByModel(emptyCtx!), []);
});

if (aiRows.length > 0) {
  check("by-model returns at most 10 rows", () => {
    const rows = aggregateAiCostByModel(ctx);
    assert.ok(rows.length > 0 && rows.length <= 10);
  });

  check("by-model percentages sum to ~100", () => {
    const rows = aggregateAiCostByModel(ctx);
    const total = rows.reduce((s, r) => s + r.percentage, 0);
    // Allow rounding slack; the sum of rounded percentages may differ by up to 1 per row.
    assert.ok(Math.abs(total - 100) <= rows.length, `sum=${total}`);
  });

  check("by-model sorted descending by cost", () => {
    const rows = aggregateAiCostByModel(ctx);
    for (let i = 1; i < rows.length; i += 1) {
      assert.ok(rows[i - 1].cost >= rows[i].cost, "must be sorted desc");
    }
  });

  check("by-model resourceName (model label) is never empty", () => {
    for (const row of aggregateAiCostByModel(ctx)) {
      assert.ok(
        row.resourceName.length > 0,
        "empty model label",
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Allocation
// ---------------------------------------------------------------------------

process.stdout.write("\nallocation\n");

check("allocation does not crash with empty filter", () => {
  const emptyCtx = getAggregationContext(
    filterSchema.parse({ subscriptions: "__no_match__" }),
  );
  assert.ok(emptyCtx);
  assert.deepEqual(aggregateAiCostAllocation(emptyCtx!), []);
});

if (aiRows.length > 0) {
  check("allocation returns rows when AI data exists", () => {
    const rows = aggregateAiCostAllocation(ctx);
    assert.ok(rows.length > 0);
  });

  check("allocation percentages sum to ~100", () => {
    const rows = aggregateAiCostAllocation(ctx);
    const total = rows.reduce((s, r) => s + r.percentage, 0);
    assert.ok(Math.abs(total - 100) <= rows.length, `sum=${total}`);
  });

  check("allocation businessUnit is never empty", () => {
    for (const row of aggregateAiCostAllocation(ctx)) {
      assert.ok(row.businessUnit.length > 0, "empty businessUnit");
    }
  });

  check("allocation costs are non-negative", () => {
    for (const row of aggregateAiCostAllocation(ctx)) {
      assert.ok(row.cost >= 0, `cost < 0 for BU=${row.businessUnit}`);
    }
  });
}

// ---------------------------------------------------------------------------
// Anomaly timeline
// ---------------------------------------------------------------------------

process.stdout.write("\nanomaly timeline\n");

check("anomaly timeline does not crash with empty filter", () => {
  const emptyCtx = getAggregationContext(
    filterSchema.parse({ subscriptions: "__no_match__" }),
  );
  assert.ok(emptyCtx);
  assert.deepEqual(aggregateAiAnomalyTimeline(emptyCtx!), []);
});

if (aiRows.length > 0) {
  check("anomaly timeline is non-empty when AI data exists", () => {
    const rows = aggregateAiAnomalyTimeline(ctx);
    assert.ok(rows.length > 0);
  });

  check("anomaly timeline baselines are non-negative", () => {
    for (const row of aggregateAiAnomalyTimeline(ctx)) {
      assert.ok(row.baseline >= 0, `negative baseline on ${row.day}`);
    }
  });

  check("anomaly timeline flags are only -1, 0, or 1", () => {
    for (const row of aggregateAiAnomalyTimeline(ctx)) {
      assert.ok(
        row.anomalyFlag === -1 || row.anomalyFlag === 0 || row.anomalyFlag === 1,
        `unexpected flag ${row.anomalyFlag} on ${row.day}`,
      );
    }
  });

  check("anomaly timeline day strings are ISO-8601", () => {
    for (const row of aggregateAiAnomalyTimeline(ctx)) {
      assert.match(row.day, /^\d{4}-\d{2}-\d{2}T/, `bad date ${row.day}`);
    }
  });
}

// ---------------------------------------------------------------------------
// Anomaly top resources
// ---------------------------------------------------------------------------

process.stdout.write("\nanomaly top-resources\n");

check("top-resources does not crash with empty filter", () => {
  const emptyCtx = getAggregationContext(
    filterSchema.parse({ subscriptions: "__no_match__" }),
  );
  assert.ok(emptyCtx);
  assert.deepEqual(aggregateAiAnomalyTopResources(emptyCtx!), []);
});

check("top-resources is capped at 5", () => {
  const rows = aggregateAiAnomalyTopResources(ctx);
  assert.ok(rows.length <= 5, `got ${rows.length} rows`);
});

check("top-resources sorted descending by deviationPercent", () => {
  const rows = aggregateAiAnomalyTopResources(ctx);
  for (let i = 1; i < rows.length; i += 1) {
    assert.ok(
      rows[i - 1].deviationPercent >= rows[i].deviationPercent,
      "must be sorted desc",
    );
  }
});

check("top-resources deviationPercent > 100 for every row", () => {
  for (const row of aggregateAiAnomalyTopResources(ctx)) {
    assert.ok(
      row.deviationPercent > 100,
      `deviationPercent=${row.deviationPercent} for ${row.resourceName}`,
    );
  }
});

check("top-resources dayCost and baselineCost are non-negative", () => {
  for (const row of aggregateAiAnomalyTopResources(ctx)) {
    assert.ok(row.dayCost >= 0);
    assert.ok(row.baselineCost >= 0);
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

process.stdout.write(
  failures === 0
    ? "\nAll checks passed.\n\n"
    : `\n${failures} check(s) failed.\n\n`,
);
process.exit(failures > 0 ? 1 : 0);
