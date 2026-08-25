/**
 * Parity test for the Parquet reader.
 *
 * The strongest available assertion is that the same synthetic export, written
 * once as CSV and once as Parquet/Snappy, normalizes to byte-identical rows.
 * If that holds, every aggregator downstream behaves the same regardless of
 * the format the customer sends us.
 *
 * Usage:
 *   npx tsx scripts/test-customer-parquet.ts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import {
  CustomerExportError,
  readExportFile,
  sniffFileKind,
} from "../src/lib/customer-data/parser";
import { normalizeRow } from "../src/lib/customer-data/normalize";
import type { CustomerCostRow } from "../src/lib/customer-data/contract";

let failures = 0;

async function check(name: string, assertion: () => void | Promise<void>): Promise<void> {
  try {
    await assertion();
    process.stdout.write(`  ok  ${name}\n`);
  } catch (error) {
    failures += 1;
    process.stdout.write(
      `  FAIL ${name}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "finops-parquet-"));
const generator = path.resolve(__dirname, "generate-sample-export.ts");

function generate(format: "focus" | "legacy", parquet: boolean): string {
  const out = path.join(tmpDir, `${format}${parquet ? ".parquet" : ".csv"}`);
  const extra = parquet ? ["--parquet"] : [];
  execFileSync(
    process.execPath,
    [require.resolve("tsx/cli"), generator, "--format", format, "--days", "12", "--out", out, ...extra],
    { stdio: "pipe" },
  );
  return out;
}

async function collect(file: string): Promise<{ format: string; rows: CustomerCostRow[] }> {
  const rows: CustomerCostRow[] = [];
  let format = "";
  for await (const { header, row } of readExportFile(file)) {
    format = header.format;
    const { row: normalized } = normalizeRow(row, header);
    if (normalized) rows.push(normalized);
  }
  return { format, rows };
}

async function main(): Promise<void> {
  process.stdout.write("\nformat sniffing\n");

  const csvFocus = generate("focus", false);
  const parquetFocus = generate("focus", true);
  const csvLegacy = generate("legacy", false);
  const parquetLegacy = generate("legacy", true);

  // A gzip copy, to prove detection is content-based rather than name-based.
  const gzMisnamed = path.join(tmpDir, "focus-gzipped.csv");
  fs.writeFileSync(gzMisnamed, zlib.gzipSync(fs.readFileSync(csvFocus)));

  // A parquet file carrying a .csv extension, same reasoning.
  const parquetMisnamed = path.join(tmpDir, "actually-parquet.csv");
  fs.copyFileSync(parquetFocus, parquetMisnamed);

  await check("plain CSV is detected as csv", async () => {
    assert.equal(await sniffFileKind(csvFocus), "csv");
  });

  await check("parquet is detected by its PAR1 magic", async () => {
    assert.equal(await sniffFileKind(parquetFocus), "parquet");
  });

  await check("gzip is detected even when the name says .csv", async () => {
    assert.equal(await sniffFileKind(gzMisnamed), "csv.gz");
  });

  await check("parquet is detected even when the name says .csv", async () => {
    assert.equal(await sniffFileKind(parquetMisnamed), "parquet");
  });

  process.stdout.write("\nCSV <-> Parquet parity\n");

  for (const [label, csvFile, parquetFile] of [
    ["focus", csvFocus, parquetFocus],
    ["legacy", csvLegacy, parquetLegacy],
  ] as const) {
    const csv = await collect(csvFile);
    const parquet = await collect(parquetFile);

    await check(`${label}: parquet yields the same row count as CSV`, () => {
      assert.ok(csv.rows.length > 0, "CSV fixture produced no rows");
      assert.equal(parquet.rows.length, csv.rows.length);
    });

    await check(`${label}: format detection agrees across both readers`, () => {
      assert.equal(parquet.format, csv.format);
      assert.equal(csv.format, label);
    });

    await check(`${label}: every normalized row is identical`, () => {
      assert.deepEqual(parquet.rows, csv.rows);
    });

    await check(`${label}: totals match to the cent`, () => {
      const sum = (rows: CustomerCostRow[]) =>
        Number(rows.reduce((acc, row) => acc + row.effectiveCost, 0).toFixed(2));
      assert.equal(sum(parquet.rows), sum(csv.rows));
    });
  }

  process.stdout.write("\nmulti row group handling\n");

  await check("parquet fixture really spans several row groups", async () => {
    const { asyncBufferFromFile, parquetMetadataAsync } = await import("hyparquet");
    const metadata = await parquetMetadataAsync(await asyncBufferFromFile(parquetFocus));
    assert.ok(
      metadata.row_groups.length > 1,
      `expected >1 row group, got ${metadata.row_groups.length}`,
    );
  });

  await check("parquet chunks are Snappy compressed, as Azure emits them", async () => {
    const { asyncBufferFromFile, parquetMetadataAsync } = await import("hyparquet");
    const metadata = await parquetMetadataAsync(await asyncBufferFromFile(parquetFocus));
    const codecs = new Set<string>();
    for (const group of metadata.row_groups) {
      for (const column of group.columns) codecs.add(String(column.meta_data?.codec));
    }
    assert.deepEqual(Array.from(codecs), ["SNAPPY"]);
  });

  process.stdout.write("\nfailure modes\n");

  await check("a parquet file missing required columns is rejected clearly", async () => {
    const { parquetWriteFile } = await import("hyparquet-writer");
    const bad = path.join(tmpDir, "bad.parquet");
    parquetWriteFile({
      filename: bad,
      columnData: [{ name: "Nonsense", data: ["a", "b"], type: "STRING" }],
      codec: "SNAPPY",
    });

    await assert.rejects(
      (async () => {
        for await (const _ of readExportFile(bad)) {
          void _;
        }
      })(),
      (error: unknown) =>
        error instanceof CustomerExportError &&
        /missing required column/i.test((error as Error).message),
    );
  });

  await check("an empty parquet file is rejected rather than silently ingested", async () => {
    const { parquetWriteFile } = await import("hyparquet-writer");
    const empty = path.join(tmpDir, "empty.parquet");
    parquetWriteFile({
      filename: empty,
      columnData: [
        { name: "ChargePeriodStart", data: [] as string[], type: "STRING" },
        { name: "BillingCurrency", data: [] as string[], type: "STRING" },
        { name: "ChargeCategory", data: [] as string[], type: "STRING" },
        { name: "EffectiveCost", data: [] as string[], type: "STRING" },
        { name: "ServiceName", data: [] as string[], type: "STRING" },
        { name: "SubAccountName", data: [] as string[], type: "STRING" },
      ],
      codec: "SNAPPY",
    });

    await assert.rejects(
      (async () => {
        for await (const _ of readExportFile(empty)) {
          void _;
        }
      })(),
      (error: unknown) => error instanceof CustomerExportError,
    );
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });

  process.stdout.write(
    failures === 0 ? "\nAll parquet checks passed.\n" : `\n${failures} check(s) FAILED.\n`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

void main();
