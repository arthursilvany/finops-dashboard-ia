import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { CustomerEvidenceMetadata } from "./contract";

export const ASSESSMENT_EVIDENCE_SCHEMA_VERSION = "1.0.0";

export const OPTIONAL_EVIDENCE_KINDS = [
  "policy",
  "security",
  "health",
  "patch",
  "operations",
  "metrics",
  "budgets",
  "commitments",
] as const;

export type OptionalEvidenceKind = (typeof OPTIONAL_EVIDENCE_KINDS)[number];
/**
 * Aliased to the manifest's status union rather than restated, so the two can
 * never drift apart again — they describe the same value at two points in the
 * pipeline (collection, then reporting).
 */
export type EvidenceCollectionStatus = CustomerEvidenceMetadata["status"];

const text = z.preprocess((value) => value == null ? "" : String(value), z.string());
const numberValue = z.preprocess((value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}, z.number());

export const policyEvidenceSchema = z.object({
  subscriptionId: text,
  resourceId: text,
  policyAssignmentId: text,
  policyDefinitionId: text,
  complianceState: text,
}).strict();

export const securityEvidenceSchema = z.object({
  subscriptionId: text,
  resourceId: text,
  assessmentKey: text,
  displayName: text,
  severity: text,
  status: text,
}).strict();

export const healthEvidenceSchema = z.object({
  subscriptionId: text,
  resourceId: text,
  availabilityState: text,
  reasonType: text,
}).strict();

export const patchEvidenceSchema = z.object({
  subscriptionId: text,
  resourceId: text,
  status: text,
  criticalCount: numberValue,
  securityCount: numberValue,
  otherCount: numberValue,
}).strict();

export const operationsEvidenceSchema = z.object({
  subscriptionId: text,
  resourceId: text,
  kind: z.preprocess((value) => String(value ?? "").toLowerCase(), z.enum([
    "backup",
    "diagnostic",
    "alert",
    "guest-configuration",
  ])),
  status: text,
}).strict();

export const metricEvidenceSchema = z.object({
  subscriptionId: text,
  resourceId: text,
  resourceName: text,
  resourceType: text,
  resourceGroup: text,
  metricName: text,
  average: numberValue,
  maximum: numberValue,
  sampleCount: numberValue.pipe(z.number().int().nonnegative()),
  startTimeUtc: text,
  endTimeUtc: text,
}).strict();

export const budgetEvidenceSchema = z.object({
  subscriptionId: text,
  name: text,
  amount: numberValue,
  currentSpend: numberValue,
  currency: text,
  timeGrain: text,
  startDateUtc: text,
  endDateUtc: text,
}).strict();

export const commitmentEvidenceSchema = z.object({
  subscriptionId: text,
  resourceType: text,
  recommendationType: text,
  term: text,
  lookBackPeriod: text,
  quantity: numberValue,
  annualSavings: numberValue,
  currency: text,
  utilizationPercentage: numberValue,
}).strict();

const schemas = {
  policy: policyEvidenceSchema,
  security: securityEvidenceSchema,
  health: healthEvidenceSchema,
  patch: patchEvidenceSchema,
  operations: operationsEvidenceSchema,
  metrics: metricEvidenceSchema,
  budgets: budgetEvidenceSchema,
  commitments: commitmentEvidenceSchema,
} satisfies Record<OptionalEvidenceKind, z.ZodTypeAny>;

export type PolicyEvidenceRow = z.infer<typeof policyEvidenceSchema>;
export type SecurityEvidenceRow = z.infer<typeof securityEvidenceSchema>;
export type HealthEvidenceRow = z.infer<typeof healthEvidenceSchema>;
export type PatchEvidenceRow = z.infer<typeof patchEvidenceSchema>;
export type OperationsEvidenceRow = z.infer<typeof operationsEvidenceSchema>;
export type MetricEvidenceRow = z.infer<typeof metricEvidenceSchema>;
export type BudgetEvidenceRow = z.infer<typeof budgetEvidenceSchema>;
export type CommitmentEvidenceRow = z.infer<typeof commitmentEvidenceSchema>;

export type OptionalEvidenceRow =
  | PolicyEvidenceRow
  | SecurityEvidenceRow
  | HealthEvidenceRow
  | PatchEvidenceRow
  | OperationsEvidenceRow
  | MetricEvidenceRow
  | BudgetEvidenceRow
  | CommitmentEvidenceRow;

export interface OptionalEvidenceFile<T = OptionalEvidenceRow> {
  schemaVersion: typeof ASSESSMENT_EVIDENCE_SCHEMA_VERSION;
  datasetGeneratedAtUtc: string;
  status: EvidenceCollectionStatus;
  sourceFiles: string[];
  rowCount: number;
  records: T[];
}

function unwrapRecords(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  for (const key of ["records", "data", "results", "value"]) {
    if (Array.isArray(object[key])) return object[key] as unknown[];
  }
  return [];
}

export function optionalEvidenceKind(file: string): OptionalEvidenceKind | null {
  const normalized = path.basename(file).toLowerCase();
  for (const kind of OPTIONAL_EVIDENCE_KINDS) {
    if (normalized === `${kind}.json`) return kind;
  }
  return null;
}

export async function readOptionalEvidenceFile(file: string): Promise<{
  kind: OptionalEvidenceKind;
  records: OptionalEvidenceRow[];
  status: EvidenceCollectionStatus;
} | null> {
  const kind = optionalEvidenceKind(file);
  if (!kind) return null;
  const parsed = JSON.parse(await fs.readFile(file, "utf8"));
  const rows = unwrapRecords(parsed);
  const rawStatus =
    parsed && typeof parsed === "object"
      ? String((parsed as Record<string, unknown>).status ?? "")
          .trim()
          .toLowerCase()
      : "";
  const status: EvidenceCollectionStatus =
    rawStatus === "forbidden" ||
    rawStatus === "failed" ||
    rawStatus === "skipped" ||
    rawStatus === "missing"
      ? rawStatus
      : rows.length > 0
        ? "available"
        : "empty";
  return {
    kind,
    records: rows.map((row) => schemas[kind].parse(row)) as OptionalEvidenceRow[],
    status,
  };
}

export function createOptionalEvidenceFile<T>(
  records: T[],
  sourceFiles: string[],
  datasetGeneratedAtUtc: string,
  collectionStatus?: EvidenceCollectionStatus,
): OptionalEvidenceFile<T> {
  return {
    schemaVersion: ASSESSMENT_EVIDENCE_SCHEMA_VERSION,
    datasetGeneratedAtUtc,
    status:
      collectionStatus ??
      (sourceFiles.length === 0
        ? "missing"
        : records.length > 0
          ? "available"
          : "empty"),
    sourceFiles,
    rowCount: records.length,
    records,
  };
}
