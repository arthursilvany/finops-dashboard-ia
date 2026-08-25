import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";

import { parse } from "csv-parse";
import { z } from "zod";

import type { CustomerEvidenceMetadata } from "./contract";

export type ManualEvidenceKind = "resourceGraph" | "advisor";
type EvidenceStatus = CustomerEvidenceMetadata["status"];

const stringValue = z.preprocess((value) => value == null ? "" : String(value), z.string());
const numberValue = z.preprocess((value) => {
  if (value == null || value === "") return 0;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}, z.number());
const stringMap = z.preprocess((value) => {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value;
}, z.record(z.preprocess((value) => value == null ? "" : String(value), z.string())));

export const ResourceGraphEvidenceRowSchema = z.object({
  id: stringValue,
  name: stringValue,
  type: stringValue,
  subscriptionId: stringValue,
  resourceGroup: stringValue,
  location: stringValue,
  sku: stringValue,
  tags: stringMap,
}).strict();

export const AdvisorEvidenceRowSchema = z.object({
  id: stringValue,
  category: stringValue,
  impact: stringValue,
  title: stringValue,
  description: stringValue,
  resourceId: stringValue,
  resourceType: stringValue,
  recommendationTypeId: stringValue,
  annualSavingsAmount: numberValue,
  currency: stringValue,
  extendedProperties: stringMap,
}).strict();

export type ResourceGraphEvidenceRow = z.infer<typeof ResourceGraphEvidenceRowSchema>;
export type AdvisorEvidenceRow = z.infer<typeof AdvisorEvidenceRowSchema>;

export interface CustomerEvidenceFile<T> {
  schemaVersion: "1.0.0";
  datasetGeneratedAtUtc: string;
  status: EvidenceStatus;
  sourceFiles: string[];
  rowCount: number;
  records: T[];
}

function keyMap(row: Record<string, unknown>): Map<string, unknown> {
  return new Map(Object.entries(row).map(([key, value]) => [
    key.replace(/[\s_.-]/g, "").toLowerCase(),
    value,
  ]));
}

function get(row: Record<string, unknown>, ...names: string[]): unknown {
  const keys = keyMap(row);
  for (const name of names) {
    const value = keys.get(name.replace(/[\s_.-]/g, "").toLowerCase());
    if (value !== undefined) return value;
  }
  return undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return objectValue(parsed);
    } catch {
      return {};
    }
  }
  return {};
}

function normalizeResource(row: Record<string, unknown>): ResourceGraphEvidenceRow {
  return ResourceGraphEvidenceRowSchema.parse({
    id: get(row, "id", "resourceId"),
    name: get(row, "name", "resourceName"),
    type: get(row, "type", "resourceType"),
    subscriptionId: get(row, "subscriptionId"),
    resourceGroup: get(row, "resourceGroup", "resourceGroupName"),
    location: get(row, "location", "region"),
    sku: get(row, "sku", "skuName"),
    tags: get(row, "tags"),
  });
}

function normalizeAdvisor(row: Record<string, unknown>): AdvisorEvidenceRow {
  const properties = objectValue(get(row, "properties"));
  const shortDescription = objectValue(get(row, "shortDescription") ?? properties.shortDescription);
  const extended = objectValue(get(row, "extendedProperties") ?? properties.extendedProperties);
  const metadata = objectValue(properties.resourceMetadata);
  return AdvisorEvidenceRowSchema.parse({
    id: get(row, "id"),
    category: get(row, "category") ?? properties.category,
    impact: get(row, "impact") ?? properties.impact,
    title: get(row, "title", "problem") ?? shortDescription.problem,
    description: get(row, "description", "solution") ?? shortDescription.solution,
    resourceId: get(row, "resourceId", "resId") ?? metadata.resourceId,
    resourceType: get(row, "resourceType", "impactedField") ?? properties.impactedField,
    recommendationTypeId: get(row, "recommendationTypeId") ?? properties.recommendationTypeId,
    annualSavingsAmount:
      get(row, "annualSavingsAmount", "savingsAmount", "savings") ??
      extended.annualSavingsAmount,
    currency: get(row, "currency") ?? extended.savingsCurrency,
    extendedProperties: extended,
  });
}

function classifyRows(rows: Record<string, unknown>[]): ManualEvidenceKind | null {
  if (rows.length === 0) return null;
  const sample = rows.slice(0, 20);
  const advisor = sample.some((row) => {
    const type = String(get(row, "type") ?? "").toLowerCase();
    const properties = objectValue(get(row, "properties"));
    return type === "microsoft.advisor/recommendations" ||
      Boolean(get(row, "category", "impact", "recommendationTypeId") ?? properties.category);
  });
  if (advisor) return "advisor";

  const resourceRows = sample.filter((row) =>
    get(row, "id", "resourceId") !== undefined &&
    get(row, "type", "resourceType") !== undefined
  ).length;
  return resourceRows >= Math.ceil(sample.length / 2) ? "resourceGraph" : null;
}

function unwrapJson(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((row): row is Record<string, unknown> =>
    Boolean(row && typeof row === "object" && !Array.isArray(row)));
  if (!value || typeof value !== "object") return [];
  const envelope = value as Record<string, unknown>;
  for (const key of ["records", "data", "results", "value"]) {
    if (Array.isArray(envelope[key])) return unwrapJson(envelope[key]);
  }
  return [];
}

async function readCsv(
  file: string,
  limit = Number.POSITIVE_INFINITY,
): Promise<Record<string, unknown>[]> {
  const parser = createReadStream(file).pipe(parse({
    columns: (headers: string[]) => headers.map((header) => header.replace(/^\uFEFF/, "").trim()),
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }));
  const rows: Record<string, unknown>[] = [];
  try {
    for await (const row of parser as AsyncIterable<Record<string, unknown>>) {
      rows.push(row);
      if (rows.length >= limit) break;
    }
  } finally {
    parser.destroy();
  }
  return rows;
}

function hasCostHeaders(row: Record<string, unknown>): boolean {
  const keys = keyMap(row);
  const hasDate = ["chargeperiodstart", "date", "usagedate", "usagedatetime"]
    .some((key) => keys.has(key));
  const hasCost = ["effectivecost", "costinbillingcurrency", "cost", "pretaxcost"]
    .some((key) => keys.has(key));
  return hasDate && hasCost;
}

async function readAndClassifyCsv(file: string): Promise<{
  kind: ManualEvidenceKind | null;
  rows: Record<string, unknown>[];
}> {
  const sample = await readCsv(file, 20);
  if (sample.length === 0 || hasCostHeaders(sample[0])) {
    return { kind: null, rows: sample };
  }
  const kind = classifyRows(sample);
  return {
    kind,
    rows: kind ? await readCsv(file) : sample,
  };
}

/**
 * Returns null for cost exports and unrelated files. Cost headers are checked
 * first so overlapping fields such as ResourceId and ResourceType cannot steal
 * a valid Cost Export from the existing streaming parser.
 */
export async function readManualEvidenceFile(file: string): Promise<{
  kind: ManualEvidenceKind;
  status: EvidenceStatus;
  records: ResourceGraphEvidenceRow[] | AdvisorEvidenceRow[];
} | null> {
  const extension = path.extname(file).toLowerCase();
  let rows: Record<string, unknown>[];
  let envelopeKind: ManualEvidenceKind | null = null;
  let status: EvidenceStatus = "available";
  if (extension === ".json") {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
    rows = unwrapJson(parsed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const envelope = parsed as Record<string, unknown>;
      const source = String(envelope.source ?? "").trim().toLowerCase();
      if (source === "resourcegraph") envelopeKind = "resourceGraph";
      if (source === "advisor") envelopeKind = "advisor";
      if (Object.prototype.hasOwnProperty.call(envelope, "status")) {
        const rawStatus = String(envelope.status ?? "").trim().toLowerCase();
        if (
          rawStatus === "available" ||
          rawStatus === "empty" ||
          rawStatus === "skipped" ||
          rawStatus === "forbidden" ||
          rawStatus === "failed" ||
          rawStatus === "missing"
        ) {
          status = rawStatus;
        } else {
          status = rows.length > 0 ? "available" : "empty";
        }
      }
    }
  } else if (extension === ".csv") {
    const classified = await readAndClassifyCsv(file);
    if (!classified.kind) return null;
    rows = classified.rows;
  } else {
    return null;
  }

  const kind = envelopeKind ?? classifyRows(rows);
  if (!kind) return null;
  return {
    kind,
    status,
    records: kind === "advisor" ? rows.map(normalizeAdvisor) : rows.map(normalizeResource),
  };
}

export function createEvidenceFile<T>(
  records: T[],
  sourceFiles: string[],
  datasetGeneratedAtUtc: string,
  status: EvidenceStatus = sourceFiles.length > 0
    ? "available"
    : "missing",
): CustomerEvidenceFile<T> {
  return {
    schemaVersion: "1.0.0",
    datasetGeneratedAtUtc,
    status,
    sourceFiles,
    rowCount: records.length,
    records,
  };
}
