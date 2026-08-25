/**
 * Regression tests for the Effective Savings Rate baseline.
 *
 * These run on synthetic rows, not on whatever export happens to be on disk, so
 * they fail deterministically if the baseline logic regresses.
 *
 * The bug they guard against: `ListCost || effectiveCost` treated a real 0 as
 * "missing". Azure emits ListCost = 0 on every commitment-covered line and puts
 * the on-demand equivalent in ContractedCost, so the baseline collapsed onto the
 * cost on exactly the rows where the customer was saving ~62%, and the reported
 * savings rate fell to ~0.08%. Removing the fallback without adding the
 * ContractedCost leg is not a fix either: it drives the rate negative.
 *
 * Usage:
 *   npx tsx scripts/test-customer-esr.ts
 */
import assert from "node:assert/strict";

import { filterSchema } from "../src/lib/filter-schema";
import { baselineCost } from "../src/lib/customer-data/contract";
import type { CustomerCostRow } from "../src/lib/customer-data/contract";
import { CUSTOMER_DATASET_SCHEMA_VERSION } from "../src/lib/customer-data/contract";
import { detectFormat } from "../src/lib/customer-data/parser";
import { normalizeRow } from "../src/lib/customer-data/normalize";
import type { AggregationContext } from "../src/lib/customer-aggregations/context";
import {
  aggregateEsrBreakdown,
  aggregateEsrSummary,
} from "../src/lib/customer-aggregations/rate-optimization";

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

// --- Row factory mirroring the real FOCUS export ----------------------------

const FOCUS_HEADERS = [
  "ChargePeriodStart",
  "BillingCurrency",
  "ChargeCategory",
  "PricingCategory",
  "PricingUnit",
  "EffectiveCost",
  "ListCost",
  "ContractedCost",
  "x_EffectiveCostInUsd",
  "ServiceName",
  "ServiceCategory",
  "SubAccountName",
  "RegionName",
  "ResourceId",
  "ResourceName",
  "ResourceType",
  "x_ResourceGroupName",
  "Tags",
  "CommitmentDiscountId",
  "CommitmentDiscountType",
  "CommitmentDiscountCategory",
  "CommitmentDiscountStatus",
  "x_SkuMeterCategory",
  "x_SkuMeterSubcategory",
];

const focusHeader = detectFormat(FOCUS_HEADERS);

interface RowSpec {
  date?: string;
  chargeCategory?: string;
  pricingCategory?: string;
  effectiveCost: number;
  listCost: number;
  contractedCost: number;
  commitmentStatus?: string;
  commitmentCategory?: string;
}

function makeRow(spec: RowSpec): CustomerCostRow {
  const result = normalizeRow(
    {
      ChargePeriodStart: spec.date ?? "2026-07-15",
      BillingCurrency: "USD",
      ChargeCategory: spec.chargeCategory ?? "Usage",
      PricingCategory: spec.pricingCategory ?? "Standard",
      PricingUnit: "1 Hour",
      EffectiveCost: String(spec.effectiveCost),
      ListCost: String(spec.listCost),
      ContractedCost: String(spec.contractedCost),
      x_EffectiveCostInUsd: String(spec.effectiveCost),
      ServiceName: "Virtual Machines",
      ServiceCategory: "Compute",
      SubAccountName: "prod-sub",
      RegionName: "eastus",
      ResourceId:
        "/subscriptions/0/resourceGroups/rg/providers/microsoft.compute/virtualmachines/vm1",
      ResourceName: "vm1",
      ResourceType: "microsoft.compute/virtualmachines",
      x_ResourceGroupName: "rg",
      Tags: "{}",
      CommitmentDiscountId: spec.commitmentStatus ? "ri-001" : "",
      CommitmentDiscountType: spec.commitmentStatus ? "Reservation" : "",
      CommitmentDiscountCategory: spec.commitmentCategory ?? "",
      CommitmentDiscountStatus: spec.commitmentStatus ?? "",
      x_SkuMeterCategory: "Virtual Machines",
      x_SkuMeterSubcategory: "Standard",
    },
    focusHeader,
  );
  assert.ok(result.row, `row was skipped: ${result.skipReason}`);
  return result.row!;
}

function makeCtx(rows: CustomerCostRow[]): AggregationContext {
  return {
    manifest: {
      schemaVersion: CUSTOMER_DATASET_SCHEMA_VERSION,
      customer: "Synthetic",
      format: "focus",
      generatedAtUtc: "2026-07-31T00:00:00Z",
      sourceFiles: [],
      rowCount: rows.length,
      skippedRowCount: 0,
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      currencies: ["USD"],
      hasUsdCosts: true,
      warnings: [],
    },
    rows,
    filters: filterSchema.parse({}),
    anchor: "2026-07-31",
    cost: (row) => row.effectiveCost,
    lastDays: () => rows,
    previousDays: () => [],
    between: (from, to) =>
      rows.filter(
        (r) => r.chargePeriodStart >= from && r.chargePeriodStart < to,
      ),
  };
}

// --- Baseline cascade -------------------------------------------------------

process.stdout.write("\nbaseline cascade\n");

check("ListCost wins when populated", () => {
  const row = makeRow({ effectiveCost: 8, listCost: 10, contractedCost: 9 });
  assert.equal(row.hasBaseline, true);
  assert.equal(baselineCost(row), 10);
});

check("ContractedCost is the fallback when ListCost is 0", () => {
  // The real shape of a reservation-covered line in an Azure FOCUS export.
  const row = makeRow({
    pricingCategory: "Committed",
    commitmentStatus: "Used",
    commitmentCategory: "Usage",
    effectiveCost: 0.0315,
    listCost: 0,
    contractedCost: 0.0832,
  });
  assert.equal(row.hasBaseline, true);
  assert.equal(baselineCost(row), 0.0832);
});

check("the baseline never silently collapses onto the effective cost", () => {
  const row = makeRow({
    pricingCategory: "Committed",
    commitmentStatus: "Used",
    commitmentCategory: "Usage",
    effectiveCost: 0.0315,
    listCost: 0,
    contractedCost: 0.0832,
  });
  assert.notEqual(
    baselineCost(row),
    row.effectiveCost,
    "regression: ListCost=0 fell back to EffectiveCost, erasing the discount",
  );
});

check("an unused commitment has no baseline at all", () => {
  const row = makeRow({
    pricingCategory: "Committed",
    commitmentStatus: "Unused",
    commitmentCategory: "Usage",
    effectiveCost: 3.6,
    listCost: 0,
    contractedCost: 0,
  });
  assert.equal(row.hasBaseline, false);
  assert.equal(baselineCost(row), 0);
});

// --- ESR aggregation --------------------------------------------------------

process.stdout.write("\nESR aggregation\n");

/**
 * One on-demand line and one reservation-covered line, both real shapes, plus
 * an unused reservation charge.
 *
 *   on-demand:  baseline 100.00, effective 100.00 -> saves 0
 *   reserved:   baseline 100.00, effective  38.00 -> saves 62 (a 62% discount)
 *   unused:     no baseline,     effective  20.00 -> waste
 *
 * Expected: baseline 200, effective 138, savings 62, ESR 31%, waste 20.
 */
function mixedRows(date = "2026-07-15"): CustomerCostRow[] {
  return [
    makeRow({ date, effectiveCost: 100, listCost: 100, contractedCost: 100 }),
    makeRow({
      date,
      pricingCategory: "Committed",
      commitmentStatus: "Used",
      commitmentCategory: "Usage",
      effectiveCost: 38,
      listCost: 0,
      contractedCost: 100,
    }),
    makeRow({
      date,
      pricingCategory: "Committed",
      commitmentStatus: "Unused",
      commitmentCategory: "Usage",
      effectiveCost: 20,
      listCost: 0,
      contractedCost: 0,
    }),
  ];
}

check("reservation savings show up in the rate", () => {
  const esr = aggregateEsrSummary(makeCtx(mixedRows()));
  assert.equal(esr.listCost, 200);
  assert.equal(esr.effectiveCost, 138);
  assert.equal(esr.totalSavings, 62);
  assert.equal(esr.effectiveSavingsRate, 31);
});

check("unused commitment is reported as waste, not as negative savings", () => {
  const esr = aggregateEsrSummary(makeCtx(mixedRows()));
  assert.equal(esr.unusedCommitmentCost, 20);
  assert.ok(
    esr.effectiveSavingsRate >= 0,
    `rate must not go negative, got ${esr.effectiveSavingsRate}`,
  );
  assert.ok(
    !String(esr.effectiveCost).includes("158"),
    "unused spend must stay out of the rated effective cost",
  );
});

check("a commitment purchase (principal) is excluded from the rate", () => {
  const rows = [
    ...mixedRows(),
    makeRow({
      chargeCategory: "Purchase",
      pricingCategory: "Committed",
      commitmentCategory: "Usage",
      effectiveCost: 5000,
      listCost: 5000,
      contractedCost: 5000,
    }),
  ];
  const esr = aggregateEsrSummary(makeCtx(rows));
  assert.equal(esr.listCost, 200, "principal leaked into the baseline");
  assert.equal(esr.effectiveCost, 138, "principal leaked into the effective cost");
});

check("a dataset with no baseline at all reports 0%, never a negative rate", () => {
  const rows = [
    makeRow({
      pricingCategory: "Committed",
      commitmentStatus: "Unused",
      commitmentCategory: "Usage",
      effectiveCost: 42,
      listCost: 0,
      contractedCost: 0,
    }),
  ];
  const esr = aggregateEsrSummary(makeCtx(rows));
  assert.equal(esr.listCost, 0);
  assert.equal(esr.effectiveCost, 0);
  assert.equal(esr.effectiveSavingsRate, 0);
  assert.equal(esr.unusedCommitmentCost, 42);
});

check("the monthly breakdown splits by month and matches the summary", () => {
  const rows = [...mixedRows("2026-07-15"), ...mixedRows("2026-06-15")];
  const breakdown = aggregateEsrBreakdown(makeCtx(rows));
  assert.equal(breakdown.length, 2);
  assert.deepEqual(
    breakdown.map((r) => r.month),
    ["2026-07", "2026-06"],
    "months must be newest first",
  );
  for (const month of breakdown) {
    assert.equal(month.listCost, 200);
    assert.equal(month.effectiveCost, 138);
    assert.equal(month.esr, 31);
    assert.equal(month.unusedCommitmentCost, 20);
  }

  const summary = aggregateEsrSummary(makeCtx(rows));
  assert.equal(
    summary.listCost,
    breakdown.reduce((s, m) => s + m.listCost, 0),
    "summary and breakdown disagree on the baseline",
  );
  assert.equal(
    summary.unusedCommitmentCost,
    breakdown.reduce((s, m) => s + (m.unusedCommitmentCost ?? 0), 0),
    "summary and breakdown disagree on unused commitment spend",
  );
});

process.stdout.write(
  failures === 0 ? "\nAll checks passed.\n\n" : `\n${failures} check(s) failed.\n\n`,
);
process.exit(failures > 0 ? 1 : 0);
