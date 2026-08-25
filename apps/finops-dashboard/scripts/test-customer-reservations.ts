/**
 * Smoke test for the customer POC reservation aggregators.
 *
 * Usage:
 *   npx tsx scripts/test-customer-reservations.ts
 */
import assert from "node:assert/strict";

import { filterSchema } from "../src/lib/filter-schema";
import { getAggregationContext } from "../src/lib/customer-aggregations/context";
import {
  aggregateReservationDetail,
  aggregateReservationOptions,
  aggregateReservationTrend,
} from "../src/lib/customer-aggregations/reservations";
import { normalizeRow } from "../src/lib/customer-data/normalize";
import { detectFormat } from "../src/lib/customer-data/parser";
import type { CustomerCostRow } from "../src/lib/customer-data/contract";
import type { AggregationContext } from "../src/lib/customer-aggregations/context";

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

// ---------------------------------------------------------------------------
// Unit tests for legacy CommitmentDiscountStatus derivation in normalize.ts.
// These run WITHOUT a real dataset on disk — they synthesize raw rows directly.
// This is the authoritative test for the unusedreservation fix.
// ---------------------------------------------------------------------------

process.stdout.write("\nnormalize.ts — legacy CommitmentDiscountStatus derivation\n");

// Build a legacy ParsedFileHeader using the real detectFormat logic.
const legacyHeaders = [
  "Date", "BillingCurrency", "ChargeType", "PricingModel",
  "UnitOfMeasure", "CostInBillingCurrency", "CostInUsd",
  "ConsumedService", "SubscriptionName", "ResourceLocation",
  "ResourceId", "ResourceGroup", "Tags", "ReservationId",
  "MeterCategory", "MeterSubCategory",
];
const legacyFileHeader = detectFormat(legacyHeaders);

function makeLegacyRow(chargeType: string, pricingModel: string): Record<string, string> {
  return {
    Date: "2026-07-15",
    BillingCurrency: "BRL",
    ChargeType: chargeType,
    PricingModel: pricingModel,
    UnitOfMeasure: "1 Hour",
    CostInBillingCurrency: "10.00",
    CostInUsd: "2.00",
    ConsumedService: "Virtual Machines",
    SubscriptionName: "prod-sub",
    ResourceLocation: "brazilsouth",
    ResourceId: "/subscriptions/00000000/resourceGroups/rg/providers/microsoft.compute/virtualmachines/vm1",
    ResourceGroup: "rg",
    Tags: "{}",
    ReservationId: "ri-test-001",
    MeterCategory: "Virtual Machines",
    MeterSubCategory: "Standard",
  };
}

check("legacy Usage + Reservation → status = 'Used'", () => {
  const result = normalizeRow(makeLegacyRow("Usage", "Reservation"), legacyFileHeader);
  assert.ok(result.row, "row should not be null");
  assert.equal(result.row!.commitmentDiscountStatus, "Used");
  assert.equal(result.row!.pricingCategory, "Committed");
});

check("legacy unusedreservation → status = 'Unused'", () => {
  const result = normalizeRow(makeLegacyRow("UnusedReservation", "Reservation"), legacyFileHeader);
  assert.ok(result.row, "row should not be null");
  assert.equal(result.row!.commitmentDiscountStatus, "Unused");
  assert.equal(result.row!.pricingCategory, "Committed");
  assert.equal(result.row!.commitmentDiscountId, "ri-test-001");
});

check("legacy unusedsavingsplan → status = 'Unused'", () => {
  const result = normalizeRow(makeLegacyRow("UnusedSavingsPlan", "SavingsPlan"), legacyFileHeader);
  assert.ok(result.row, "row should not be null");
  assert.equal(result.row!.commitmentDiscountStatus, "Unused");
  assert.equal(result.row!.pricingCategory, "Committed");
});

check("legacy OnDemand Usage → status = '' (not committed)", () => {
  const result = normalizeRow(makeLegacyRow("Usage", "OnDemand"), legacyFileHeader);
  assert.ok(result.row, "row should not be null");
  assert.equal(result.row!.commitmentDiscountStatus, "");
  assert.equal(result.row!.pricingCategory, "Standard");
});

check("FOCUS row: explicit CommitmentDiscountStatus is preserved unchanged", () => {
  const focusHeaders = [
    "ChargePeriodStart", "BillingCurrency", "ChargeCategory", "PricingCategory",
    "PricingUnit", "EffectiveCost", "ListCost", "x_EffectiveCostInUsd",
    "ServiceName", "ServiceCategory", "SubAccountName", "RegionName",
    "ResourceId", "ResourceName", "ResourceType", "x_ResourceGroupName",
    "Tags", "CommitmentDiscountId", "CommitmentDiscountType",
    "CommitmentDiscountCategory", "CommitmentDiscountStatus",
    "x_SkuMeterCategory", "x_SkuMeterSubcategory",
  ];
  const focusFileHeader = detectFormat(focusHeaders);
  const focusRow: Record<string, string> = {
    ChargePeriodStart: "2026-07-15",
    BillingCurrency: "BRL",
    ChargeCategory: "Usage",
    PricingCategory: "Committed",
    PricingUnit: "1 Hour",
    EffectiveCost: "5.00",
    ListCost: "6.25",
    x_EffectiveCostInUsd: "1.00",
    ServiceName: "Virtual Machines",
    ServiceCategory: "Compute",
    SubAccountName: "prod-sub",
    RegionName: "brazilsouth",
    ResourceId: "/subscriptions/00000000/resourceGroups/rg/providers/microsoft.compute/virtualmachines/vm1",
    ResourceName: "vm1",
    ResourceType: "microsoft.compute/virtualmachines",
    x_ResourceGroupName: "rg",
    Tags: "{}",
    CommitmentDiscountId: "ri-focus-001",
    CommitmentDiscountType: "Reservation",
    CommitmentDiscountCategory: "Usage",
    CommitmentDiscountStatus: "Unused",
    x_SkuMeterCategory: "Virtual Machines",
    x_SkuMeterSubcategory: "Standard",
  };
  const result = normalizeRow(focusRow, focusFileHeader);
  assert.ok(result.row, "row should not be null");
  assert.equal(result.row!.commitmentDiscountStatus, "Unused");
});

// Now test the aggregator path with a synthetic context built from normalized
// legacy rows that include an unusedreservation row.
check("aggregator: legacy dataset with unusedreservation rows reports unused > 0 and utilization < 100", () => {
  const usedResult = normalizeRow(makeLegacyRow("Usage", "Reservation"), legacyFileHeader);
  const unusedResult = normalizeRow(makeLegacyRow("UnusedReservation", "Reservation"), legacyFileHeader);
  assert.ok(usedResult.row && unusedResult.row);

  // Build a minimal synthetic AggregationContext with one used + one unused row.
  const rows: CustomerCostRow[] = [usedResult.row!, unusedResult.row!];
  const syntheticCtx: AggregationContext = {
    manifest: {
      schemaVersion: "1.0.0",
      customer: "Synthetic",
      format: "legacy",
      generatedAtUtc: "2026-07-15T00:00:00Z",
      sourceFiles: [],
      rowCount: 2,
      skippedRowCount: 0,
      periodStart: "2026-07-15",
      periodEnd: "2026-07-15",
      currencies: ["BRL"],
      hasUsdCosts: false,
      warnings: [],
    },
    rows,
    filters: filterSchema.parse({}),
    anchor: "2026-07-15",
    cost: (row) => row.effectiveCost,
    lastDays: (n) => rows,
    previousDays: (n) => [],
    between: (from, to) => rows.filter(
      (r) => r.chargePeriodStart >= from && r.chargePeriodStart < to,
    ),
  };

  const detail = aggregateReservationDetail(syntheticCtx);
  assert.equal(detail.length, 1, "should have one commitment");
  const row = detail[0];
  assert.ok(row.unused > 0, `unused should be > 0, got ${row.unused}`);
  assert.ok(row.utilization < 100, `utilization should be < 100, got ${row.utilization}`);
  assert.ok(row.used > 0, `used should be > 0, got ${row.used}`);
});

if (!ctx) {
  process.stdout.write(
    "\nNo customer dataset found — run `npm run ingest:customer` first to test the aggregators.\n",
  );
  process.exit(failures > 0 ? 1 : 0);
}

process.stdout.write(
  `\nreservations (customer "${ctx.manifest.customer}", ${ctx.rows.length} rows, anchor ${ctx.anchor})\n`,
);

// --- detail ----------------------------------------------------------------

process.stdout.write("\ndetail\n");

check("detail returns an array (empty is fine if no commitments)", () => {
  const rows = aggregateReservationDetail(ctx);
  assert.ok(Array.isArray(rows));
});

check("detail: no negative used or unused costs", () => {
  for (const row of aggregateReservationDetail(ctx)) {
    assert.ok(row.used >= 0, `used should be >= 0 for ${row.commitmentId}`);
    assert.ok(row.unused >= 0, `unused should be >= 0 for ${row.commitmentId}`);
  }
});

check("detail: utilization stays within 0..100", () => {
  for (const row of aggregateReservationDetail(ctx)) {
    assert.ok(
      row.utilization >= 0 && row.utilization <= 100,
      `utilization ${row.utilization} out of range for ${row.commitmentId}`,
    );
  }
});

check("detail: days is positive for each row", () => {
  for (const row of aggregateReservationDetail(ctx)) {
    assert.ok(row.days > 0, `days should be > 0 for ${row.commitmentId}`);
  }
});

check("detail: committed cost reconciles to dataset total committed cost", () => {
  const rows = aggregateReservationDetail(ctx);
  const detailTotal = rows.reduce((s, r) => s + r.used + r.unused, 0);

  // Total committed cost across all rows in dataset
  const datasetCommittedTotal = ctx.rows
    .filter(
      (r) =>
        r.chargeCategory === "Usage" &&
        r.pricingCategory === "Committed" &&
        r.commitmentDiscountId !== "",
    )
    .reduce((s, r) => s + ctx.cost(r), 0);

  // Allow floating-point rounding tolerance (round2 per row)
  assert.ok(
    Math.abs(detailTotal - datasetCommittedTotal) < rows.length * 0.01 + 1,
    `detail total ${detailTotal.toFixed(2)} vs dataset ${datasetCommittedTotal.toFixed(2)}`,
  );
});

check("detail: sorted by unused descending", () => {
  const rows = aggregateReservationDetail(ctx);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(
      rows[i - 1].unused >= rows[i].unused,
      `row ${i - 1} unused should be >= row ${i} unused`,
    );
  }
});

check("detail: filter by commitmentType returns only matching rows", () => {
  const all = aggregateReservationDetail(ctx);
  if (all.length === 0) return; // no commitments in dataset — skip
  const type = all[0].commitmentType;
  const filtered = aggregateReservationDetail(ctx, { commitmentType: type });
  for (const row of filtered) {
    assert.equal(row.commitmentType, type);
  }
});

check("detail: unmatched filter yields empty array without crashing", () => {
  const rows = aggregateReservationDetail(ctx, {
    commitmentName: "__NO_MATCH_XYZZY__",
  });
  assert.deepEqual(rows, []);
});

// --- trend -----------------------------------------------------------------

process.stdout.write("\ntrend\n");

check("trend returns an array", () => {
  const points = aggregateReservationTrend(ctx);
  assert.ok(Array.isArray(points));
});

check("trend: months are ordered ascending", () => {
  const points = aggregateReservationTrend(ctx);
  for (let i = 1; i < points.length; i++) {
    assert.ok(
      points[i - 1].month <= points[i].month,
      `month ${points[i - 1].month} should be <= ${points[i].month}`,
    );
  }
});

check("trend: no negative used or unused", () => {
  for (const pt of aggregateReservationTrend(ctx)) {
    assert.ok(pt.used >= 0, `used should be >= 0 at ${pt.month}`);
    assert.ok(pt.unused >= 0, `unused should be >= 0 at ${pt.month}`);
  }
});

check("trend: no duplicate months", () => {
  const points = aggregateReservationTrend(ctx);
  const seen = new Set<string>();
  for (const pt of points) {
    assert.ok(!seen.has(pt.month), `duplicate month ${pt.month}`);
    seen.add(pt.month);
  }
});

check("trend: unmatched filter yields empty array without crashing", () => {
  const points = aggregateReservationTrend(ctx, {
    commitmentName: "__NO_MATCH_XYZZY__",
  });
  assert.deepEqual(points, []);
});

check("trend: committed cost reconciles to detail total by month", () => {
  const detail = aggregateReservationDetail(ctx);
  const trend = aggregateReservationTrend(ctx);
  const trendTotal = trend.reduce((s, p) => s + p.used + p.unused, 0);
  const detailTotal = detail.reduce((s, r) => s + r.used + r.unused, 0);
  assert.ok(
    Math.abs(trendTotal - detailTotal) < detail.length * 0.01 + 1,
    `trend total ${trendTotal.toFixed(2)} vs detail total ${detailTotal.toFixed(2)}`,
  );
});

// --- options ---------------------------------------------------------------

process.stdout.write("\noptions\n");

check("options returns commitmentNames/resourceTypes/commitmentTypes arrays", () => {
  const opts = aggregateReservationOptions(ctx);
  assert.ok(Array.isArray(opts.commitmentNames));
  assert.ok(Array.isArray(opts.resourceTypes));
  assert.ok(Array.isArray(opts.commitmentTypes));
});

check("options: commitmentTypes are a subset of detail types", () => {
  const detail = aggregateReservationDetail(ctx);
  const opts = aggregateReservationOptions(ctx);
  const detailTypes = new Set(detail.map((r) => r.commitmentType));
  for (const ct of opts.commitmentTypes) {
    assert.ok(
      detailTypes.has(ct) || detail.length === 0,
      `commitmentType "${ct}" not found in detail rows`,
    );
  }
});

check("options: commitmentNames sorted", () => {
  const opts = aggregateReservationOptions(ctx);
  const sorted = [...opts.commitmentNames].sort();
  assert.deepEqual(opts.commitmentNames, sorted);
});

check("options: empty dataset yields empty arrays without crashing", () => {
  const emptyCtx = getAggregationContext(
    filterSchema.parse({ subscriptions: "__NO_MATCH_XYZZY__" }),
  );
  if (!emptyCtx) return;
  const opts = aggregateReservationOptions(emptyCtx);
  assert.deepEqual(opts.commitmentNames, []);
  assert.deepEqual(opts.resourceTypes, []);
  assert.deepEqual(opts.commitmentTypes, []);
});

// --- cross-check: standard + committed cost reconciles to dataset total ---

process.stdout.write("\ncross-checks\n");

check("committed + standard usage cost reconciles to usage total", () => {
  const usageRows = ctx.rows.filter((r) => r.chargeCategory === "Usage");
  const committedTotal = usageRows
    .filter((r) => r.pricingCategory === "Committed")
    .reduce((s, r) => s + ctx.cost(r), 0);
  const standardTotal = usageRows
    .filter((r) => r.pricingCategory === "Standard")
    .reduce((s, r) => s + ctx.cost(r), 0);
  const otherTotal = usageRows
    .filter(
      (r) =>
        r.pricingCategory !== "Committed" && r.pricingCategory !== "Standard",
    )
    .reduce((s, r) => s + ctx.cost(r), 0);
  const allUsageTotal = usageRows.reduce((s, r) => s + ctx.cost(r), 0);
  assert.ok(
    Math.abs(committedTotal + standardTotal + otherTotal - allUsageTotal) < 0.1,
    "splits must sum to total",
  );
});

process.stdout.write(
  failures === 0 ? "\nAll checks passed.\n\n" : `\n${failures} check(s) failed.\n\n`,
);
process.exit(failures > 0 ? 1 : 0);
