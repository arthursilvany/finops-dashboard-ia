/**
 * End-to-end check of AWS FOCUS ingestion.
 *
 * Reads the customer's AWS Data Exports parquet directly through the production
 * parser + normalizer and asserts the figures the dashboard will show. The
 * numbers below were measured from the file itself, so a regression in the
 * Parquet reader, the FOCUS detector or the AWS normalization fails here rather
 * than in front of the customer.
 *
 * The dataset is real customer data and is git-ignored, so the test skips
 * cleanly when the file is absent (CI, a fresh clone, another engineer's box).
 *
 * Usage:
 *   npx tsx scripts/test-customer-aws-ingest.ts
 *   AWS_FOCUS_FIXTURE=/path/to/export.parquet npx tsx scripts/test-customer-aws-ingest.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { readExportFile } from "../src/lib/customer-data/parser";
import { normalizeRow } from "../src/lib/customer-data/normalize";
import { customerRootDir } from "../src/lib/customer-data/paths";
import { normalizeProvider } from "../src/lib/customer-data/contract";
import {
  addDays,
  datasetAnchor,
  rowsOverlapping,
  spanDays,
} from "../src/lib/customer-aggregations/filters";
import type { CustomerCostRow } from "../src/lib/customer-data/contract";

/** Measured from a real AWS FOCUS export; see the header note. */
const EXPECTED = {
  rowCount: 19_827,
  taggedRows: 3_322,
  rowsWithResourceId: 18_183,
  effectiveCost: 82_246.63,
  listCost: 108_888.79,
  periodStart: "2026-05-01",
  periodEnd: "2026-05-31",
  distinctDays: 21,
  currency: "USD",
  subAccounts: 16,
};

/** Costs are floating point sums over ~20k rows; a cent of drift is expected. */
const COST_TOLERANCE = 0.05;

function findAwsExport(): string | null {
  const override = process.env.AWS_FOCUS_FIXTURE;
  if (override) return fs.existsSync(override) ? override : null;

  const stack = [customerRootDir()];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".")) stack.push(full);
        continue;
      }
      // AWS Data Exports name the part file after the export definition.
      if (/aws.*\.parquet$/i.test(entry.name)) return full;
    }
  }
  return null;
}

let failures = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    process.stdout.write(`  ok   ${name}\n`);
  } catch (error) {
    failures += 1;
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`  FAIL ${name}\n       ${message}\n`);
  }
}

async function main(): Promise<void> {
  const file = findAwsExport();
  if (!file) {
    process.stdout.write(
      "AWS FOCUS export not found (customer data is git-ignored) — skipping.\n" +
        "Set AWS_FOCUS_FIXTURE to run this test against a specific file.\n",
    );
    return;
  }

  process.stdout.write(`Reading ${path.basename(file)}\n\n`);

  const rows: CustomerCostRow[] = [];
  let format = "";
  let skipped = 0;

  for await (const { header, row } of readExportFile(file)) {
    format = header.format;
    const { row: normalized } = normalizeRow(row, header);
    if (!normalized) {
      skipped += 1;
      continue;
    }
    rows.push(normalized);
  }

  const sum = (project: (row: CustomerCostRow) => number): number =>
    rows.reduce((total, row) => total + project(row), 0);

  process.stdout.write("parsing\n");

  check("detected as a FOCUS export", () => {
    assert.equal(format, "focus");
  });

  check(`ingests ${EXPECTED.rowCount.toLocaleString()} rows`, () => {
    assert.equal(rows.length, EXPECTED.rowCount);
  });

  check("drops no rows", () => {
    assert.equal(skipped, 0);
  });

  process.stdout.write("\nprovider dimension\n");

  check("every row is tagged as the AWS provider", () => {
    const providers = new Set(rows.map((row) => row.providerName));
    assert.deepEqual(Array.from(providers), ["AWS"]);
  });

  process.stdout.write("\ntags (Parquet MAP column)\n");

  // The regression this guards: `Tags` is a Parquet MAP, and reading only leaf
  // columns dropped it entirely, so every AWS row looked untagged and the
  // governance page reported 0% coverage.
  check(`recovers tags on ${EXPECTED.taggedRows.toLocaleString()} rows`, () => {
    const tagged = rows.filter((row) => Object.keys(row.tags).length > 0);
    assert.equal(tagged.length, EXPECTED.taggedRows);
  });

  check("tag keys are real names, not the MAP's key/value leaves", () => {
    const keys = new Set(rows.flatMap((row) => Object.keys(row.tags)));
    assert.ok(keys.size > 0, "no tag keys at all");
    assert.ok(!keys.has("key"), "found raw MAP leaf 'key' as a tag name");
    assert.ok(!keys.has("value"), "found raw MAP leaf 'value' as a tag name");
  });

  process.stdout.write("\ncosts\n");

  check(`effective cost is ${EXPECTED.effectiveCost} ${EXPECTED.currency}`, () => {
    const total = sum((row) => row.effectiveCost);
    assert.ok(
      Math.abs(total - EXPECTED.effectiveCost) < COST_TOLERANCE,
      `expected ~${EXPECTED.effectiveCost}, got ${total.toFixed(2)}`,
    );
  });

  check(`list cost is ${EXPECTED.listCost} ${EXPECTED.currency}`, () => {
    const total = sum((row) => row.listCost);
    assert.ok(
      Math.abs(total - EXPECTED.listCost) < COST_TOLERANCE,
      `expected ~${EXPECTED.listCost}, got ${total.toFixed(2)}`,
    );
  });

  check("list cost exceeds effective cost (savings are real)", () => {
    assert.ok(sum((row) => row.listCost) > sum((row) => row.effectiveCost));
  });

  check("billing currency is uniform USD", () => {
    const currencies = new Set(rows.map((row) => row.billingCurrency));
    assert.deepEqual(Array.from(currencies), [EXPECTED.currency]);
  });

  process.stdout.write("\ndates\n");

  check(`period is ${EXPECTED.periodStart} to ${EXPECTED.periodEnd}`, () => {
    const days = rows.map((row) => row.chargePeriodStart).sort();
    assert.equal(days[0], EXPECTED.periodStart);
    assert.equal(days[days.length - 1], EXPECTED.periodEnd);
  });

  check("every charge date is a plain ISO day", () => {
    const bad = rows.find((row) => !/^\d{4}-\d{2}-\d{2}$/.test(row.chargePeriodStart));
    assert.equal(bad, undefined, `bad date: ${bad?.chargePeriodStart}`);
  });

  // Dates are read as UTC. Rendering the same instants in a negative-offset
  // local timezone shifts the first day back into April, so any expectation
  // derived from a local-time string would be silently off by one.
  check(`covers ${EXPECTED.distinctDays} distinct days, not a dense range`, () => {
    const days = new Set(rows.map((row) => row.chargePeriodStart));
    assert.equal(days.size, EXPECTED.distinctDays);
  });

  check("the export has a trailing gap after the last usage day", () => {
    const days = Array.from(new Set(rows.map((row) => row.chargePeriodStart))).sort();
    const lastContiguous = days[days.length - 2];
    // Usage stops on the 20th, but a later charge is dated the 31st. The
    // dataset anchor therefore sits ~11 days past the last real usage, which
    // pulls every "last N days" average down. Asserted so the gap stays a
    // known property of this export rather than a surprise in a meeting.
    assert.equal(lastContiguous, "2026-05-20");
    assert.equal(days[days.length - 1], "2026-05-31");
  });

  // The defect this guards against: every relative window used to be decided
  // from `chargePeriodStart` alone, which silently dropped any row whose
  // period began before the window. On this export that hid 78.7% of usage
  // cost behind a single row dated the 1st, and the "last 30 days" KPI read
  // ~4x under the real month.
  check("charge periods are mostly multi-day, not daily", () => {
    const multiDay = rows.filter(
      (row) => spanDays(row.chargePeriodStart, row.chargePeriodEnd) > 1,
    );
    const costOf = (list: CustomerCostRow[]) =>
      list.reduce((total, row) => total + row.effectiveCost, 0);
    const share = costOf(multiDay) / costOf(rows);
    assert.ok(
      share > 0.9,
      `expected >90% of cost on multi-day periods, got ${(share * 100).toFixed(1)}%`,
    );
  });

  check("every charge period ends strictly after it starts", () => {
    const bad = rows.find((row) => row.chargePeriodEnd <= row.chargePeriodStart);
    assert.equal(
      bad,
      undefined,
      `period does not advance: ${bad?.chargePeriodStart} -> ${bad?.chargePeriodEnd}`,
    );
  });

  check("a 30-day window keeps the month's cost instead of dropping it", () => {
    const anchor = datasetAnchor(rows);
    const window = rowsOverlapping(rows, addDays(anchor, -29), addDays(anchor, 1));
    const windowCost = window.reduce((total, row) => total + row.effectiveCost, 0);
    const totalCost = rows.reduce((total, row) => total + row.effectiveCost, 0);
    // Prorating a 31-day period into a 30-day window keeps ~30/31 of it. The
    // start-date test kept 21%.
    assert.ok(
      windowCost / totalCost > 0.85,
      `30-day window holds only ${((windowCost / totalCost) * 100).toFixed(1)}% of the export`,
    );
  });

  check("adjacent windows split a straddling charge, never duplicate it", () => {
    const anchor = datasetAnchor(rows);
    const current = rowsOverlapping(rows, addDays(anchor, -29), addDays(anchor, 1));
    const previous = rowsOverlapping(rows, addDays(anchor, -59), addDays(anchor, -29));
    const sum = (list: CustomerCostRow[]) =>
      list.reduce((total, row) => total + row.effectiveCost, 0);
    const totalCost = rows.reduce((total, row) => total + row.effectiveCost, 0);
    // Every row lies inside the two windows combined, so the halves must add
    // back up to the whole. Overlap without proration would exceed it.
    assert.ok(
      Math.abs(sum(current) + sum(previous) - totalCost) < 0.01,
      `windows sum to ${(sum(current) + sum(previous)).toFixed(2)}, export is ${totalCost.toFixed(2)}`,
    );
  });

  process.stdout.write("\nAWS normalization\n");

  check("resource group is empty for every AWS row", () => {
    const withRg = rows.filter((row) => row.resourceGroupName !== "");
    assert.equal(withRg.length, 0, "AWS has no resource group concept");
  });

  check("no row is left in the raw 'Any' / blank region", () => {
    const bad = rows.filter(
      (row) => row.regionName === "" || row.regionName === "Any",
    );
    assert.equal(bad.length, 0);
  });

  check("ARNs without a slash still yield a readable resource name", () => {
    const slashless = rows.find(
      (row) => row.resourceId.startsWith("arn:") && !row.resourceId.includes("/"),
    );
    if (!slashless) return; // dataset may not contain one
    assert.notEqual(slashless.resourceName, slashless.resourceId);
    assert.ok(slashless.resourceName.length > 0);
  });

  check(`resolves ${EXPECTED.rowsWithResourceId.toLocaleString()} resource ids`, () => {
    const withId = rows.filter((row) => row.resourceId !== "");
    assert.equal(withId.length, EXPECTED.rowsWithResourceId);
  });

  check("service category comes from FOCUS, not keyword guessing", () => {
    const categories = new Set(rows.map((row) => row.serviceCategory));
    // The derivation fallback can only ever produce 9 buckets; AWS supplies 16.
    assert.ok(
      categories.size > 10,
      `expected native FOCUS categories, got ${categories.size}`,
    );
    assert.ok(categories.has("AI and Machine Learning"));
  });

  check(`sees ${EXPECTED.subAccounts} AWS member accounts`, () => {
    const accounts = new Set(rows.map((row) => row.subAccountName));
    assert.equal(accounts.size, EXPECTED.subAccounts);
  });

  process.stdout.write("\ncommitments\n");

  check("Savings Plan and Reservation lines are both recognized", () => {
    const types = new Set(
      rows.map((row) => row.commitmentDiscountType).filter(Boolean),
    );
    assert.ok(types.has("Savings Plan"), "no Savings Plan rows");
    assert.ok(types.has("Reservation"), "no Reservation rows");
  });

  check("unused commitment lines are preserved as waste", () => {
    const unused = rows.filter((row) => row.commitmentDiscountStatus === "Unused");
    assert.ok(unused.length > 0, "no Unused commitment rows survived ingestion");
  });

  // The reservation page is captioned "Azure only". AWS Savings Plans satisfy
  // the same generic FOCUS commitment predicate the aggregator selects on, so
  // if the Azure-only routes ever stop pinning the provider filter, that page
  // sums both clouds under an Azure label. On this export the AWS share of
  // that predicate is ~90%, so the mislabel would dominate the figure.
  check("AWS commitment rows match the generic Azure-page predicate", () => {
    const commitmentRows = rows.filter(
      (row) =>
        row.chargeCategory === "Usage" &&
        row.pricingCategory === "Committed" &&
        row.commitmentDiscountId !== "",
    );
    assert.ok(
      commitmentRows.length > 0,
      "expected AWS commitment rows — this is why Azure-only pages must filter by provider",
    );
  });

  process.stdout.write("\nprovider labelling\n");

  check("a blank ProviderName is never silently called Azure", () => {
    // Column present + blank value means the export declined to say. Calling
    // that Azure would fold an unidentified vendor's spend into Azure totals
    // and into the Azure-only pages.
    assert.equal(normalizeProvider("", "Other"), "Other");
    assert.equal(normalizeProvider("   ", "Other"), "Other");
    // Column absent entirely is a legacy Azure export, which can only be Azure.
    assert.equal(normalizeProvider("", "Azure"), "Azure");
  });

  check("vendor spellings map to one bucket each", () => {
    for (const spelling of ["AWS", "aws", " Amazon Web Services "]) {
      assert.equal(normalizeProvider(spelling, "Other"), "AWS");
    }
    for (const spelling of ["Microsoft", "microsoft azure", "Azure"]) {
      assert.equal(normalizeProvider(spelling, "Other"), "Azure");
    }
    assert.equal(normalizeProvider("Oracle Cloud", "Azure"), "Other");
  });

  process.stdout.write(
    failures === 0
      ? "\nAll AWS ingestion checks passed.\n"
      : `\n${failures} check(s) failed.\n`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\nAWS ingestion test failed: ${message}\n`);
  process.exitCode = 1;
});
