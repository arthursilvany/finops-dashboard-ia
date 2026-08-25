import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";

import { activeCustomerPaths } from "./customer-data/workspace";
import {
  NARRATIVE_SCHEMA_VERSION,
  customerNarrativeSchema,
  customerNarrativeStatusSchema,
  type CustomerNarrative,
  type CustomerNarrativeStatus,
} from "./customer-narrative-contract";

/**
 * Narrative files of the active customer.
 *
 * Resolved per call instead of at import time: the active customer changes per
 * request now, so a module-level constant would pin the whole process to
 * whichever customer happened to be selected first.
 */
export function customerNarrativeFile(customerSlug?: string | null): string {
  return activeCustomerPaths(customerSlug).narrative;
}

export function customerNarrativeStatusFile(
  customerSlug?: string | null,
): string {
  return activeCustomerPaths(customerSlug).narrativeStatus;
}

export interface CustomerNarrativeResult {
  narrative: CustomerNarrative | null;
  status: CustomerNarrativeStatus | null;
  freshness: "current" | "stale";
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await fsPromises.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fsPromises.writeFile(
    temporary,
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
  await fsPromises.rename(temporary, file);
}

export async function persistCustomerNarrative(
  narrative: CustomerNarrative,
): Promise<void> {
  const parsed = customerNarrativeSchema.parse(narrative);
  const status: CustomerNarrativeStatus = {
    schemaVersion: NARRATIVE_SCHEMA_VERSION,
    state: "ready",
    attemptedAtUtc: new Date().toISOString(),
    narrativeGeneratedAtUtc: parsed.generatedAtUtc,
  };
  await writeJsonAtomic(customerNarrativeFile(), parsed);
  await writeJsonAtomic(customerNarrativeStatusFile(), status);
}

export async function persistCustomerNarrativeFailure(
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const status: CustomerNarrativeStatus = {
    schemaVersion: NARRATIVE_SCHEMA_VERSION,
    state: "failed",
    attemptedAtUtc: new Date().toISOString(),
    error: message || "Narrative generation failed",
  };
  await fsPromises.rm(customerNarrativeFile(), { force: true });
  await writeJsonAtomic(customerNarrativeStatusFile(), status);
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function loadCustomerNarrative(
  expectedDatasetGeneratedAtUtc?: string,
  customerSlug?: string | null,
): CustomerNarrativeResult {
  let status: CustomerNarrativeStatus | null = null;
  let narrative: CustomerNarrative | null = null;

  try {
    const narrativeFile = customerNarrativeFile(customerSlug);
    const statusFile = customerNarrativeStatusFile(customerSlug);
    if (fs.existsSync(statusFile)) {
      status = customerNarrativeStatusSchema.parse(readJson(statusFile));
    }
    if (fs.existsSync(narrativeFile)) {
      narrative = customerNarrativeSchema.parse(readJson(narrativeFile));
    }
  } catch (error) {
    console.error("[customer-narrative] failed to load persisted narrative:", error);
    return {
      narrative: null,
      status: {
        schemaVersion: NARRATIVE_SCHEMA_VERSION,
        state: "failed",
        attemptedAtUtc: new Date().toISOString(),
        error: "Persisted narrative is invalid. Re-run customer ingestion.",
      },
      freshness: "current",
    };
  }

  if (
    narrative &&
    expectedDatasetGeneratedAtUtc &&
    narrative.datasetGeneratedAtUtc !== expectedDatasetGeneratedAtUtc
  ) {
    return {
      narrative: null,
      status: {
        schemaVersion: NARRATIVE_SCHEMA_VERSION,
        state: "failed",
        attemptedAtUtc: new Date().toISOString(),
        error:
          "Narrative belongs to a different dataset snapshot. Re-run customer ingestion.",
      },
      freshness: "current",
    };
  }

  const freshness =
    narrative !== null &&
    Date.now() - Date.parse(narrative.sourceLastModifiedAtUtc) >
      7 * 24 * 60 * 60 * 1000
      ? "stale"
      : "current";

  return { narrative, status, freshness };
}
