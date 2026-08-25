import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { parse } from "csv-parse";
import path from "node:path";

import type { CustomerExportFormat } from "./contract";
import { LEGACY_COLUMN_ALIASES, REQUIRED_FOCUS_COLUMNS } from "./contract";

/** A raw CSV record keyed by its (trimmed) header. */
export type RawRow = Record<string, string>;

export interface ParsedFileHeader {
  format: CustomerExportFormat;
  /** Maps a FOCUS column name to the header actually present in the file. */
  columnMap: Record<string, string>;
  headers: string[];
}

/** Headers that only ever appear in a FOCUS export. */
const FOCUS_MARKER_COLUMNS = [
  "ChargePeriodStart",
  "BillingCurrency",
  "ChargeCategory",
  "EffectiveCost",
];

function normalizeHeader(header: string): string {
  // Excel/UTF-8 BOM and stray whitespace are common in portal exports.
  return header.replace(/^\uFEFF/, "").trim();
}

function findHeader(headers: string[], candidate: string): string | undefined {
  const target = candidate.toLowerCase();
  return headers.find((h) => h.toLowerCase() === target);
}

/**
 * Decides whether the file is a FOCUS export or a legacy actual/amortized
 * export, and resolves each FOCUS column to the header present in the file.
 */
export function detectFormat(rawHeaders: string[]): ParsedFileHeader {
  const headers = rawHeaders.map(normalizeHeader);
  const focusHits = FOCUS_MARKER_COLUMNS.filter((c) =>
    findHeader(headers, c),
  ).length;
  const format: CustomerExportFormat =
    focusHits >= 2 ? "focus" : "legacy";

  const columnMap: Record<string, string> = {};

  if (format === "focus") {
    for (const header of headers) {
      columnMap[header] = header;
    }
  } else {
    for (const [focusColumn, aliases] of Object.entries(LEGACY_COLUMN_ALIASES)) {
      for (const alias of aliases) {
        const found = findHeader(headers, alias);
        if (found) {
          columnMap[focusColumn] = found;
          break;
        }
      }
    }
  }

  return { format, columnMap, headers };
}

/** Thrown when the file cannot be used at all. */
export class CustomerExportError extends Error {}

/**
 * Thrown when a file is a *different* Cost Management dataset rather than a
 * broken cost export — reservation recommendations, price sheet, and so on.
 *
 * This is deliberately a distinct type. A customer legitimately drops the whole
 * export folder, which holds sibling datasets next to the cost file; those must
 * be skipped. A cost export that is genuinely missing columns must still fail
 * loudly, because silently ingesting fewer rows than the customer sent is the
 * kind of error nobody notices until they are in the meeting.
 */
export class NotACostExportError extends CustomerExportError {
  constructor(
    message: string,
    /** Human-readable name of the dataset that was recognised. */
    readonly datasetType: string,
  ) {
    super(message);
  }
}

/**
 * Other Cost Management exports the customer may hand over in the same folder,
 * keyed by columns that only that dataset has. Header spellings differ between
 * EA and MCA and between dataset versions, so each entry lists several markers
 * and a file matches when at least two are present.
 */
const SIBLING_DATASETS: Array<{ name: string; markers: string[] }> = [
  {
    name: "reservation recommendations",
    markers: [
      "NetSavings",
      "RecommendedQuantity",
      "LookBackPeriod",
      "TotalCostWithReservedInstances",
      "CostWithNoReservedInstances",
    ],
  },
  {
    name: "reservation details",
    markers: ["ReservedHours", "UsedHours", "RIUsedHours", "TotalReservedQuantity"],
  },
  {
    name: "reservation transactions",
    markers: ["EventType", "ReservationOrderId", "BillingFrequency", "ReservationOrderName"],
  },
  {
    name: "price sheet",
    markers: ["UnitPrice", "TierMinimumUnits", "PriceType", "MeterName", "ProductId"],
  },
];

/**
 * Recognises a non-cost Cost Management export by its marker columns. Returns
 * the dataset name, or null when the file is not a dataset we know about.
 */
export function identifySiblingDataset(headers: string[]): string | null {
  for (const dataset of SIBLING_DATASETS) {
    const hits = dataset.markers.filter((marker) => findHeader(headers, marker)).length;
    if (hits >= 2) return dataset.name;
  }
  return null;
}

function assertUsable(header: ParsedFileHeader, file: string): void {
  const missing = REQUIRED_FOCUS_COLUMNS.filter((column) => {
    if (header.format === "focus") return !findHeader(header.headers, column);
    return !header.columnMap[column];
  });

  if (missing.length === 0) return;

  // Only consider the sibling-dataset explanation once we know this cannot be
  // a usable cost export, so a real cost export is never misclassified.
  const sibling = identifySiblingDataset(header.headers);
  if (sibling) {
    throw new NotACostExportError(
      `${path.basename(file)}: this is a ${sibling} export, not a cost and usage export.`,
      sibling,
    );
  }

  throw new CustomerExportError(
    `${path.basename(file)}: missing required column(s): ${missing.join(", ")}. ` +
      `Detected format: ${header.format}. Headers found: ${header.headers.join(", ")}`,
  );
}

/**
 * Streams a `.csv` or `.csv.gz` Cost Export. Streaming matters: enterprise
 * exports routinely reach hundreds of MB and must never be read into a string.
 */
async function* readCsvFile(
  filePath: string,
  gzip: boolean,
): AsyncGenerator<{ header: ParsedFileHeader; row: RawRow }> {
  const parser = parse({
    columns: (headerRow: string[]) => headerRow.map(normalizeHeader),
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });

  const source = createReadStream(filePath);
  const stream = gzip ? source.pipe(createGunzip()).pipe(parser) : source.pipe(parser);

  let header: ParsedFileHeader | null = null;

  for await (const row of stream as AsyncIterable<RawRow>) {
    if (!header) {
      header = detectFormat(Object.keys(row));
      assertUsable(header, filePath);
    }
    yield { header, row };
  }

  if (!header) {
    throw new CustomerExportError(
      `${path.basename(filePath)}: file is empty or has no data rows.`,
    );
  }
}

/**
 * Parquet holds typed values (number, bigint, Date, null); every downstream
 * consumer — `normalizeRow` in particular — is written against the strings a
 * CSV yields. Converting here keeps the two formats on one code path instead
 * of duplicating the normalizer.
 */
function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  return JSON.stringify(value);
}

/**
 * Column names of a Parquet file, taken from the *first-level* children of the
 * schema root rather than from its leaves.
 *
 * This distinction is not cosmetic. AWS Data Exports emit FOCUS `Tags` as a
 * Parquet MAP, which the schema encodes as a group whose descendants are the
 * generic leaves `key` and `value`. Reading leaves therefore produced three
 * indistinguishable `key`/`value` pairs and *no* `Tags` column at all, so every
 * AWS row arrived tagless and the governance views reported 0% tag coverage —
 * a fabricated finding, which is far worse than a missing one.
 *
 * `parquetReadObjects` already assembles groups into nested JS objects, so
 * naming the group is all that is required; `stringifyCell` then serialises it
 * to the JSON that `parseTags` consumes.
 *
 * The schema is a flat depth-first list, so a subtree is skipped by consuming
 * as many following elements as the running `num_children` count demands.
 */
export function topLevelParquetColumns(
  schema: Array<{ name: string; num_children?: number }>,
): string[] {
  const root = schema[0];
  if (!root) return [];

  const columns: string[] = [];
  let index = 1;

  for (let child = 0; child < (root.num_children ?? 0); child += 1) {
    const element = schema[index];
    if (!element) break;

    columns.push(normalizeHeader(element.name));

    // Walk past this child's own subtree.
    let offset = 1;
    let pending = element.num_children ?? 0;
    while (pending > 0 && schema[index + offset]) {
      pending -= 1;
      pending += schema[index + offset].num_children ?? 0;
      offset += 1;
    }
    index += offset;
  }

  return columns;
}

/**
 * Streams a `.parquet` Cost Export.
 *
 * Azure writes Parquet exports with Snappy compression; the codec is recorded
 * per column chunk inside the file, so it is never something the operator has
 * to declare. Registering the full `compressors` map means gzip/zstd/brotli
 * chunks produced by other tooling also read without special handling.
 *
 * Parquet is columnar, so reading a file "at once" materialises all of it in
 * memory. We walk row group by row group instead to keep the footprint bounded
 * the same way the CSV path is.
 */
async function* readParquetFile(
  filePath: string,
): AsyncGenerator<{ header: ParsedFileHeader; row: RawRow }> {
  // hyparquet is ESM-only. A dynamic import keeps this file loadable from the
  // CommonJS output that `tsx` produces for the ingest script.
  const { asyncBufferFromFile, parquetMetadataAsync, parquetReadObjects } = await import(
    "hyparquet"
  );
  const { compressors } = await import("hyparquet-compressors");

  const file = await asyncBufferFromFile(filePath);
  const metadata = await parquetMetadataAsync(file);

  const columns = topLevelParquetColumns(metadata.schema);

  if (columns.length === 0) {
    throw new CustomerExportError(
      `${path.basename(filePath)}: Parquet file declares no columns.`,
    );
  }

  const header = detectFormat(columns);
  assertUsable(header, filePath);

  let emitted = 0;
  let rowStart = 0;

  for (const group of metadata.row_groups) {
    const groupRows = Number(group.num_rows);
    if (groupRows <= 0) continue;
    const rowEnd = rowStart + groupRows;

    const records = await parquetReadObjects({
      file,
      metadata,
      compressors,
      rowStart,
      rowEnd,
    });

    for (const record of records) {
      const row: RawRow = {};
      // Build from the schema rather than the record's own keys so that every
      // row exposes the same columns even when a value is null.
      for (const column of columns) {
        row[column] = stringifyCell((record as Record<string, unknown>)[column]);
      }
      emitted += 1;
      yield { header, row };
    }

    rowStart = rowEnd;
  }

  if (emitted === 0) {
    throw new CustomerExportError(
      `${path.basename(filePath)}: file is empty or has no data rows.`,
    );
  }
}

export type ExportFileKind = "csv" | "csv.gz" | "parquet";

/**
 * Identifies the file by its magic bytes rather than its name. Azure names
 * Parquet parts `part_0_0001.parquet`, some tooling emits `.snappy.parquet`,
 * and files get renamed or re-compressed in transit between the customer and
 * us — the content is the only reliable signal.
 */
export async function sniffFileKind(filePath: string): Promise<ExportFileKind> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(4);
    const { bytesRead } = await handle.read(buffer, 0, 4, 0);
    if (bytesRead >= 4 && buffer.toString("latin1") === "PAR1") return "parquet";
    if (bytesRead >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) return "csv.gz";
    return "csv";
  } finally {
    await handle.close();
  }
}

/**
 * Single entry point for every supported Cost Export file. Callers get the
 * same `{ header, row }` contract regardless of the underlying format.
 */
export async function* readExportFile(
  filePath: string,
): AsyncGenerator<{ header: ParsedFileHeader; row: RawRow }> {
  const kind = await sniffFileKind(filePath);

  if (kind === "parquet") {
    yield* readParquetFile(filePath);
    return;
  }

  yield* readCsvFile(filePath, kind === "csv.gz");
}

