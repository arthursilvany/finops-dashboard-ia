/**
 * Ingests an Azure Cost Export dropped into `input/customer/` and writes a
 * normalized NDJSON dataset the dashboard can serve without ADX.
 *
 * Usage (from apps/finops-dashboard):
 *   npm run ingest:customer -- "Contoso"
 *
 * The customer name may also be passed as `--customer Contoso` or
 * `--customer=Contoso`. Note that npm swallows unknown `--flags` as its own
 * config, so the positional form above is the documented one; the flag form is
 * still recovered from the `npm_config_customer` environment variable that npm
 * sets when it does so.
 * * Customer data never leaves the machine: input and output both live under
 * `input/customer/`, which is git-ignored.
 */
import { createWriteStream } from "node:fs";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { once } from "node:events";

import type {
  CloudProvider,
  CustomerCostRow,
  CustomerDatasetManifest,
  CustomerEvidenceMetadata,
  CustomerExportFormat,
  CustomerProviderSummary,
} from "../src/lib/customer-data/contract";
import { CUSTOMER_DATASET_SCHEMA_VERSION } from "../src/lib/customer-data/contract";
import { CustomerExportError, NotACostExportError, readExportFile } from "../src/lib/customer-data/parser";
import { normalizeRow } from "../src/lib/customer-data/normalize";
import { buildSanitizedAssessmentFacts } from "../src/lib/customer-narrative-facts";
import { generateCustomerNarrative } from "../src/lib/customer-narrative-generator";
import {
  persistCustomerNarrative,
  persistCustomerNarrativeFailure,
} from "../src/lib/customer-narrative-store";
import {
  createEvidenceFile,
  readManualEvidenceFile,
  type AdvisorEvidenceRow,
  type ResourceGraphEvidenceRow,
} from "../src/lib/customer-data/evidence";
import {
  createOptionalEvidenceFile,
  OPTIONAL_EVIDENCE_KINDS,
  readOptionalEvidenceFile,
  type OptionalEvidenceKind,
  type OptionalEvidenceRow,
  type EvidenceCollectionStatus,
} from "../src/lib/customer-data/assessment-evidence";
import {
  LEGACY_WORKSPACE_SLUG,
  customerPaths,
  isSafeWorkspaceName,
  isValidSlug,
  slugify,
  type CustomerWorkspacePaths,
} from "../src/lib/customer-data/paths";
import {
  listWorkspaceSlugs,
  recordIngestedCustomer,
} from "../src/lib/customer-data/workspace";

/** Guard against exhausting memory / disk on very large enterprise exports. */
const MAX_ROWS = Number(process.env.CUSTOMER_MAX_ROWS ?? 3_000_000);

/**
 * Accepted export files. `.snappy.parquet` (some tooling) and Azure's own
 * `part_0_0001.parquet` both match. The reader confirms the real format from
 * the file's magic bytes, so the extension is only a first-pass filter.
 */
const EXPORT_FILE_PATTERN = /\.(csv(\.gz)?|parquet|json)$/i;

/** Azure export folder trees are shallow (export/date-range/run-id/part). */
const MAX_INPUT_DEPTH = 6;

/** UTC-safe date shift on a `YYYY-MM-DD` string. */
function addDaysIso(iso: string, days: number): string {
  const shifted = new Date(`${iso}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Resolves the customer name from, in order of precedence:
 *   1. `--customer <name>` / `--customer=<name>` (direct `tsx` invocation)
 *   2. positional arguments, joined (the documented `npm run ... -- "Contoso"`)
 *   3. `npm_config_customer`, which npm populates when it swallows `--customer`
 *      as one of its own config flags.
 */
function parseArgs(argv: string[]): { customer?: string; dir?: string } {
  const positional: string[] = [];
  let customer: string | undefined;
  let dir: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--customer") {
      customer = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--customer=")) {
      customer = arg.slice("--customer=".length);
    } else if (arg === "--dir") {
      dir = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--dir=")) {
      dir = arg.slice("--dir=".length);
    } else if (!arg.startsWith("--")) {
      positional.push(arg);
    }
  }

  const resolved =
    customer ?? (positional.length > 0 ? positional.join(" ") : undefined) ?? process.env.npm_config_customer;

  return {
    customer: resolved?.trim() || undefined,
    dir: dir?.trim() || undefined,
  };
}

/**
 * Picks the workspace to ingest into.
 *
 * Each customer owns `input/customer/<slug>/`, so two collections can coexist
 * on the same machine. The pre-workspace layout — export files sitting loose in
 * the root — still works, but only while it is unambiguous: once per-customer
 * folders exist, ingesting the root would merge unrelated customers into one
 * dataset. That used to happen silently and is exactly what this refuses to do.
 */
async function resolveWorkspace(
  customerName: string | undefined,
  dirFlag: string | undefined,
): Promise<{ paths: CustomerWorkspacePaths; isLegacy: boolean }> {
  // `--dir` re-roots everything, which makes the explicit path win over any
  // slug convention without a second code path for reading it back.
  if (dirFlag) {
    process.env.CUSTOMER_DATA_DIR = path.resolve(dirFlag);
    return { paths: customerPaths(LEGACY_WORKSPACE_SLUG), isLegacy: true };
  }

  if (!customerName) {
    throw new CustomerExportError(
      'Customer name is required. Run: npm run ingest:customer -- "Contoso"',
    );
  }

  const slug = slugify(customerName);
  if (!slug || !isValidSlug(slug)) {
    throw new CustomerExportError(
      `Could not derive a folder name from "${customerName}". ` +
        "Use letters and digits, or pass --dir with an explicit folder.",
    );
  }

  // A folder collected before this feature keeps the customer's own casing
  // ("Contoso"). Matching by slug means those folders are picked up as-is,
  // instead of demanding that people rename their collected data.
  const folder = findExistingWorkspaceFolder(slug) ?? slug;
  const workspace = customerPaths(folder);
  const workspaceFiles = await listExportFiles(workspace.dir, workspace.processed).catch(
    () => [] as string[],
  );
  if (workspaceFiles.length > 0) return { paths: workspace, isLegacy: false };

  // Nothing in the customer's own folder: fall back to the legacy root layout,
  // but only when no other customer folder could get mixed in.
  const legacy = customerPaths(LEGACY_WORKSPACE_SLUG);
  const rootFiles = await listRootLevelExportFiles(legacy.dir);
  const otherWorkspaces = listWorkspaceSlugs().filter(
    (candidate) =>
      candidate !== LEGACY_WORKSPACE_SLUG && candidate !== folder,
  );

  if (rootFiles.length > 0 && otherWorkspaces.length > 0) {
    throw new CustomerExportError(
      `Found export files loose in ${legacy.dir} while these customer folders ` +
        `also exist: ${otherWorkspaces.join(", ")}.\n` +
        "Ingesting the root would merge different customers into a single dataset.\n" +
        `Move the loose files into ${workspace.dir} and run the command again.`,
    );
  }

  if (rootFiles.length > 0) {
    process.stdout.write(
      `\n  ! Using the legacy layout: export files found directly in ${legacy.dir}.\n` +
        `    Move them to ${workspace.dir} to keep customers isolated.\n`,
    );
    return { paths: legacy, isLegacy: true };
  }

  throw new CustomerExportError(
    `No .csv, .csv.gz, .parquet or .json file found in ${workspace.dir}.\n` +
      "Run the collector with -CustomerName so it writes into that folder, or " +
      "drop the Azure Cost Management export there yourself.",
  );
}

/**
 * Existing folder that represents this customer, by slug equivalence.
 *
 * `input/customer/Contoso` and the slug `contoso` are the same customer; picking
 * the folder that is already on disk avoids creating a second, empty workspace
 * beside the collected data. Both trees are searched, so re-ingesting a
 * customer whose raw export was deleted still targets its existing output.
 */
function findExistingWorkspaceFolder(slug: string): string | null {
  const match = listWorkspaceSlugs().find(
    (name) =>
      name !== LEGACY_WORKSPACE_SLUG &&
      (name === slug || slugify(name) === slug),
  );
  return match ?? null;
}

/** Export files sitting in the root itself, ignoring customer subfolders. */
async function listRootLevelExportFiles(root: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const found: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      // Azure export trees are folders; only descend into ones that are not a
      // customer workspace, otherwise the "loose files" check answers itself.
      if (entry.name.startsWith(".") || isSafeWorkspaceName(entry.name)) continue;
      const nested = await listExportFiles(
        path.join(root, entry.name),
        path.join(root, ".processed"),
      ).catch(() => [] as string[]);
      found.push(...nested);
      continue;
    }
    if (EXPORT_FILE_PATTERN.test(entry.name)) found.push(path.join(root, entry.name));
  }
  return found;
}

async function listExportFiles(
  dir: string,
  processedDir: string,
): Promise<string[]> {
  const found: string[] = [];

  async function walk(current: string, depth: number): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      if (current === dir) {
        throw new CustomerExportError(
          `Input folder not found: ${dir}. Create it and drop the Cost Export file there.`,
        );
      }
      return;
    }

    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        // Azure writes Parquet (and dated CSV) exports as a folder tree of
        // part files, so the drop folder is routinely more than one level deep.
        // `.processed` holds our own output and must never be re-ingested.
        if (entry.name.startsWith(".")) continue;
        if (path.resolve(full) === path.resolve(processedDir)) continue;
        if (depth < MAX_INPUT_DEPTH) await walk(full, depth + 1);
        continue;
      }
      if (EXPORT_FILE_PATTERN.test(entry.name)) found.push(full);
    }
  }

  await walk(dir, 0);
  return found.sort();
}

async function main(): Promise<void> {
  const { customer, dir } = parseArgs(process.argv.slice(2));

  const { paths: workspace, isLegacy } = await resolveWorkspace(customer, dir);

  const files = await listExportFiles(workspace.dir, workspace.processed);
  if (files.length === 0) {
    throw new CustomerExportError(
      `No .csv, .csv.gz or .parquet file found in ${workspace.dir}.\n` +
        `Ask the customer for an Azure Cost Management export (FOCUS 1.0 preferred, ` +
        `amortized cost otherwise) and place the file in that folder.`,
    );
  }

  await fs.mkdir(workspace.processed, { recursive: true });

  const out = createWriteStream(workspace.rows, { encoding: "utf8" });
  const warnings: string[] = [];
  const currencies = new Set<string>();
  const formats = new Set<CustomerExportFormat>();
  /**
   * Per-provider slice of the dataset. A customer that runs both Azure and AWS
   * hands over both exports, and a single global period/currency would hide
   * that (say) the AWS export stops three weeks before the Azure one.
   */
  const providerStats = new Map<
    CloudProvider,
    { rowCount: number; periodStart: string | null; periodEnd: string | null; currencies: Set<string> }
  >();
  /** Files that produced rows, and sibling datasets that were passed over. */
  const usedFiles: string[] = [];
  const skippedFiles: string[] = [];
  const skippedCostFilesDueToLimit: string[] = [];
  const resourceGraphRows: ResourceGraphEvidenceRow[] = [];
  const advisorRows: AdvisorEvidenceRow[] = [];
  const resourceGraphFiles: string[] = [];
  const advisorFiles: string[] = [];
  let resourceGraphStatus: EvidenceCollectionStatus = "missing";
  let advisorStatus: EvidenceCollectionStatus = "missing";
  const acceptedInputFiles: string[] = [];
  const optionalRows = new Map<OptionalEvidenceKind, OptionalEvidenceRow[]>(
    OPTIONAL_EVIDENCE_KINDS.map((kind) => [kind, []]),
  );
  const optionalFiles = new Map<OptionalEvidenceKind, string[]>(
    OPTIONAL_EVIDENCE_KINDS.map((kind) => [kind, []]),
  );
  const optionalStatuses = new Map<OptionalEvidenceKind, EvidenceCollectionStatus>();

  let rowCount = 0;
  let skippedRowCount = 0;
  let hasUsdCosts = false;
  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  let truncated = false;

  for (const file of files) {
    const label = path.basename(file);
    process.stdout.write(`Reading ${label}...\n`);

    const optionalEvidence = await readOptionalEvidenceFile(file);
    if (optionalEvidence) {
      optionalRows.get(optionalEvidence.kind)!.push(...optionalEvidence.records);
      optionalFiles.get(optionalEvidence.kind)!.push(label);
      optionalStatuses.set(optionalEvidence.kind, optionalEvidence.status);
      acceptedInputFiles.push(file);
      process.stdout.write(
        `  accepted: ${optionalEvidence.records.length} ${optionalEvidence.kind} row(s).\n`,
      );
      continue;
    }

    const evidence = await readManualEvidenceFile(file);
    if (evidence?.kind === "resourceGraph") {
      resourceGraphRows.push(...evidence.records as ResourceGraphEvidenceRow[]);
      resourceGraphFiles.push(label);
      if (resourceGraphStatus === "missing" || evidence.status === "available") {
        resourceGraphStatus = evidence.status;
      }
      acceptedInputFiles.push(file);
      process.stdout.write(`  accepted: ${evidence.records.length} Resource Graph row(s).\n`);
      continue;
    }
    if (evidence?.kind === "advisor") {
      advisorRows.push(...evidence.records as AdvisorEvidenceRow[]);
      advisorFiles.push(label);
      if (advisorStatus === "missing" || evidence.status === "available") {
        advisorStatus = evidence.status;
      }
      acceptedInputFiles.push(file);
      process.stdout.write(`  accepted: ${evidence.records.length} Advisor row(s).\n`);
      continue;
    }
    if (path.extname(file).toLowerCase() === ".json") {
      skippedFiles.push(label);
      process.stdout.write("  skipped: unrecognized JSON dataset.\n");
      continue;
    }
    if (truncated) {
      skippedCostFilesDueToLimit.push(label);
      process.stdout.write(
        "  skipped: cost row limit already reached; continuing evidence discovery.\n",
      );
      continue;
    }

    let rowsFromFile = 0;

    try {
      for await (const { header, row } of readExportFile(file)) {
        formats.add(header.format);

        const { row: normalized, skipReason } = normalizeRow(row, header);
        if (!normalized) {
          skippedRowCount += 1;
          if (skippedRowCount === 1 && skipReason) {
            warnings.push(`${label}: dropping rows (${skipReason}); first occurrence.`);
          }
          continue;
        }

        if (rowCount >= MAX_ROWS) {
          truncated = true;
          break;
        }

        currencies.add(normalized.billingCurrency);
        if (normalized.effectiveCostInUsd !== 0) hasUsdCosts = true;
        if (!periodStart || normalized.chargePeriodStart < periodStart) {
          periodStart = normalized.chargePeriodStart;
        }
        if (!periodEnd || normalized.chargePeriodStart > periodEnd) {
          periodEnd = normalized.chargePeriodStart;
        }

        let stats = providerStats.get(normalized.providerName);
        if (!stats) {
          stats = { rowCount: 0, periodStart: null, periodEnd: null, currencies: new Set() };
          providerStats.set(normalized.providerName, stats);
        }
        stats.rowCount += 1;
        stats.currencies.add(normalized.billingCurrency);
        if (!stats.periodStart || normalized.chargePeriodStart < stats.periodStart) {
          stats.periodStart = normalized.chargePeriodStart;
        }
        if (!stats.periodEnd || normalized.chargePeriodStart > stats.periodEnd) {
          stats.periodEnd = normalized.chargePeriodStart;
        }

        if (!out.write(`${serialize(normalized)}\n`)) {
          await once(out, "drain");
        }
        rowCount += 1;
        rowsFromFile += 1;
      }
    } catch (error) {
      // Customers hand over the whole export folder, which holds the other
      // Cost Management datasets (reservation recommendations, price sheet,
      // ...) beside the cost file. Skip those instead of failing the run — but
      // only before any row was accepted, so a partially-read file can never be
      // written off as "not a cost export".
      if (error instanceof NotACostExportError && rowsFromFile === 0) {
        skippedFiles.push(label);
        process.stdout.write(`  skipped: ${error.datasetType} export, not cost and usage data.\n`);
        continue;
      }
      throw error;
    }

    usedFiles.push(label);
    acceptedInputFiles.push(file);
  }

  out.end();
  await once(out, "finish");

  if (rowCount === 0) {
    await fs.rm(workspace.rows, { force: true });
    if (skippedFiles.length > 0 && usedFiles.length === 0) {
      throw new CustomerExportError(
        `Only non-cost Cost Management exports were found (${skippedFiles.join(", ")}).\n` +
          `Those datasets are not the cost and usage export. Ask the customer for ` +
          `"Cost and usage details (FOCUS)" — or amortized cost if FOCUS is unavailable.`,
      );
    }
    throw new CustomerExportError(
      "No usable rows were found. Check that the export contains a date and a cost column.",
    );
  }

  if (skippedFiles.length > 0) {
    warnings.push(
      `Skipped ${skippedFiles.length} non-cost export file(s): ${skippedFiles.join(", ")}. ` +
        `They are different Cost Management datasets and are not used by the dashboard.`,
    );
  }

  if (truncated) {
    warnings.push(
      `Row limit of ${MAX_ROWS.toLocaleString()} reached; the dataset was truncated. ` +
        `Narrow the export period or raise CUSTOMER_MAX_ROWS.` +
        (skippedCostFilesDueToLimit.length > 0
          ? ` ${skippedCostFilesDueToLimit.length} later cost file(s) were not read.`
          : ""),
    );
  }
  if (currencies.size > 1) {
    warnings.push(
      `Multiple billing currencies found (${Array.from(currencies).join(", ")}). ` +
        `Totals mix currencies — export one billing account at a time.`,
    );
  }
  if (!hasUsdCosts) {
    warnings.push("No USD costs in the export; USD figures fall back to billing currency.");
  }

  const datasetGeneratedAtUtc = new Date().toISOString();
  const providers = Array.from(providerStats.keys()).sort();
  /**
   * Azure Resource Graph and Azure Advisor have no AWS equivalent. Reporting
   * them as "missing" on an AWS-only dataset frames a structural absence as an
   * operator mistake, and pushes the operator to hunt for a file that cannot
   * exist. "not-applicable" says what is actually true.
   */
  const azureOnlyEvidenceApplies = providers.length === 0 || providers.includes("Azure");
  const resolveAzureEvidenceStatus = (
    status: EvidenceCollectionStatus,
  ): CustomerEvidenceMetadata["status"] =>
    status === "missing" && !azureOnlyEvidenceApplies ? "not-applicable" : status;

  const resourceGraphEvidence = createEvidenceFile(
    resourceGraphRows,
    resourceGraphFiles,
    datasetGeneratedAtUtc,
    resourceGraphStatus,
  );
  const advisorEvidence = createEvidenceFile(
    advisorRows,
    advisorFiles,
    datasetGeneratedAtUtc,
    advisorStatus,
  );
  const optionalOutputs = {
    policy: workspace.policy,
    security: workspace.security,
    health: workspace.health,
    patch: workspace.patch,
    operations: workspace.operations,
    metrics: workspace.metrics,
    budgets: workspace.budgets,
    commitments: workspace.commitments,
  } satisfies Record<OptionalEvidenceKind, string>;
  const optionalEvidence = Object.fromEntries(
    OPTIONAL_EVIDENCE_KINDS.map((kind) => [
      kind,
      createOptionalEvidenceFile(
        optionalRows.get(kind)!,
        optionalFiles.get(kind)!,
        datasetGeneratedAtUtc,
        optionalStatuses.get(kind),
      ),
    ]),
  ) as Record<
    OptionalEvidenceKind,
    ReturnType<typeof createOptionalEvidenceFile<OptionalEvidenceRow>>
  >;
  await Promise.all([
    fs.writeFile(
      workspace.resourceGraph,
      `${JSON.stringify(resourceGraphEvidence, null, 2)}\n`,
      "utf8",
    ),
    fs.writeFile(
      workspace.advisor,
      `${JSON.stringify(advisorEvidence, null, 2)}\n`,
      "utf8",
    ),
    ...OPTIONAL_EVIDENCE_KINDS.map((kind) =>
      fs.writeFile(
        optionalOutputs[kind],
        `${JSON.stringify(optionalEvidence[kind], null, 2)}\n`,
        "utf8",
      ),
    ),
  ]);
  if (resourceGraphEvidence.status === "missing" && azureOnlyEvidenceApplies) {
    warnings.push("Azure Resource Graph assessment evidence was not provided.");
  }
  if (advisorEvidence.status === "missing" && azureOnlyEvidenceApplies) {
    warnings.push("Azure Advisor assessment evidence was not provided.");
  }
  if (!azureOnlyEvidenceApplies) {
    warnings.push(
      `Dataset has no Azure rows (providers: ${providers.join(", ")}). ` +
        `Azure Resource Graph / Advisor evidence and the Azure-only pages ` +
        `(Reservation Detail, AI Insights) do not apply.`,
    );
  } else if (providers.length > 1) {
    const nonAzure = providers.filter((p) => p !== "Azure");
    warnings.push(
      `Multicloud dataset (${providers.join(", ")}). Azure-only pages cover the ` +
        `Azure rows and exclude ${nonAzure.join(", ")}; use the Provider filter to compare.`,
    );
  }

  // "Other" means the export carried a ProviderName column and left it blank,
  // or named a vendor we do not map. Those rows are still counted in every
  // total, so silence would let an unidentified cloud's spend ride along
  // unlabelled — and it would be read as Azure by anyone glancing at the page.
  const unknownProviderRows = providerStats.get("Other")?.rowCount ?? 0;
  if (unknownProviderRows > 0) {
    warnings.push(
      `${unknownProviderRows.toLocaleString()} row(s) have a blank or unrecognised ` +
        `FOCUS ProviderName and are grouped as "Other". Their cost is included in ` +
        `dataset totals but they are excluded from the Azure-only pages. Check the ` +
        `export's ProviderName column before presenting per-cloud figures.`,
    );
  }

  // A short export is the single most common surprise in a customer meeting:
  // the pages render, but the month-over-month and anomaly panels are blank,
  // because there is genuinely nothing to compare against. Say so now, on the
  // console, rather than letting it be discovered in front of the customer.
  if (periodStart && periodEnd) {
    const spanDays =
      Math.round(
        (Date.parse(`${periodEnd}T00:00:00Z`) - Date.parse(`${periodStart}T00:00:00Z`)) /
          86_400_000,
      ) + 1;

    // "Last month" is the last *complete* calendar month before the newest day.
    const hasCompletePreviousMonth = periodStart.slice(0, 7) < periodEnd.slice(0, 7);

    if (!hasCompletePreviousMonth) {
      warnings.push(
        `The export covers a single calendar month (${periodEnd.slice(0, 7)}). ` +
          `Calendar-month KPIs (last month, previous month) have no earlier month ` +
          `to compare against, and the rolling 30-day change compares two windows ` +
          `inside the same month rather than two closed months. Ask for 3 months.`,
      );
    }
    if (spanDays < 14) {
      warnings.push(
        `The export spans only ${spanDays} day(s) (${periodStart} to ${periodEnd}). ` +
          `Anomaly detection needs a baseline of at least 14 days, and trend charts ` +
          `will show ${spanDays} point(s).`,
      );
    }

    // Relative windows ("last 30 days", "month to date") anchor to the newest
    // charge date in the *whole* dataset, so a provider whose export stops
    // earlier falls outside every one of them. Filtering to that provider then
    // renders a page of honest zeros, which reads as "this cloud costs nothing"
    // rather than "this cloud's export ends before the window". Two clouds
    // exported over different periods is a collection mismatch to fix at the
    // source, so it has to be said at ingestion, not discovered in the meeting.
    if (providers.length > 1) {
      const staleWindowStart = addDaysIso(periodEnd, -29);
      const stale = providers
        .map((provider) => ({
          provider,
          end: providerStats.get(provider)?.periodEnd ?? "",
        }))
        .filter((entry) => entry.end && entry.end < staleWindowStart);

      for (const { provider, end } of stale) {
        warnings.push(
          `${provider} data ends on ${end}, before the dataset's 30-day window ` +
            `(${staleWindowStart} to ${periodEnd}) which is anchored to the newest ` +
            `charge across all clouds. Relative-window panels — 30-day KPIs, month ` +
            `to date, anomalies — will read 0 for ${provider}. Re-export the clouds ` +
            `over the same period to compare them.`,
        );
      }
    }
  }

  const sourceStats = await Promise.all(
    acceptedInputFiles.map((file) => fs.stat(file)),
  );
  const sourceLastModifiedAtUtc = new Date(
    Math.min(...sourceStats.map((stat) => stat.mtimeMs)),
  ).toISOString();

  const manifest: CustomerDatasetManifest = {
    schemaVersion: CUSTOMER_DATASET_SCHEMA_VERSION,
    customer: customer?.trim() || "Customer",
    format: formats.has("focus") ? "focus" : "legacy",
    generatedAtUtc: datasetGeneratedAtUtc,
    sourceLastModifiedAtUtc,
    sourceFiles: usedFiles,
    rowCount,
    skippedRowCount,
    periodStart,
    periodEnd,
    currencies: Array.from(currencies).sort(),
    providers,
    rowCountByProvider: Object.fromEntries(
      providers.map((provider) => [provider, providerStats.get(provider)!.rowCount]),
    ) as Partial<Record<CloudProvider, number>>,
    providerSummaries: providers.map<CustomerProviderSummary>((provider) => {
      const stats = providerStats.get(provider)!;
      return {
        provider,
        rowCount: stats.rowCount,
        periodStart: stats.periodStart,
        periodEnd: stats.periodEnd,
        currencies: Array.from(stats.currencies).sort(),
      };
    }),
    hasUsdCosts,
    warnings,
    assessmentEvidence: {
      resourceGraph: {
        status: resolveAzureEvidenceStatus(resourceGraphEvidence.status),
        sourceFiles: resourceGraphFiles,
        rowCount: resourceGraphRows.length,
        outputFile: path.basename(workspace.resourceGraph),
      },
      advisor: {
        status: resolveAzureEvidenceStatus(advisorEvidence.status),
        sourceFiles: advisorFiles,
        rowCount: advisorRows.length,
        outputFile: path.basename(workspace.advisor),
      },
      ...Object.fromEntries(
        OPTIONAL_EVIDENCE_KINDS.map((kind) => [
          kind,
          {
            status: resolveAzureEvidenceStatus(optionalEvidence[kind].status),
            sourceFiles: optionalFiles.get(kind)!,
            rowCount: optionalRows.get(kind)!.length,
            outputFile: path.basename(optionalOutputs[kind]),
          },
        ]),
      ),
    },
  };

  await fs.writeFile(workspace.manifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  // Recorded after the manifest lands, so a failed ingest never becomes the
  // dashboard's default customer.
  recordIngestedCustomer(workspace.slug, manifest.customer);

  const skipNarrativeForTest =
    process.env.NODE_ENV === "test" &&
    process.env.CUSTOMER_SKIP_NARRATIVE_FOR_TESTS === "true";
  if (!skipNarrativeForTest) {
    process.stdout.write(
      "\nGenerating Narrative IA with Foundry + Microsoft Learn...\n",
    );
    try {
      const facts = await buildSanitizedAssessmentFacts(workspace.slug);
      const narrative = await generateCustomerNarrative(facts);
      await persistCustomerNarrative(narrative);
      process.stdout.write(
        `  Narrative: ready (${narrative.actions.length} prioritized action(s))\n`,
      );
    } catch (error) {
      await persistCustomerNarrativeFailure(error);
      const message = error instanceof Error ? error.message : String(error);
      throw new CustomerExportError(
        `The customer dataset was preserved, but Narrative IA generation failed: ${message}\n` +
          "Resolve the Resource Graph/Advisor evidence, Microsoft Learn MCP, or Foundry connection and re-run ingestion.",
      );
    }
  }

  process.stdout.write(
    [
      "",
      "Customer dataset ready.",
      `  Customer : ${manifest.customer}`,
      `  Format   : ${manifest.format}`,
      `  Rows     : ${rowCount.toLocaleString()} (${skippedRowCount.toLocaleString()} skipped)`,
      `  Provider : ${
        providers.length > 0
          ? providers
              .map((p) => `${p} ${providerStats.get(p)!.rowCount.toLocaleString()}`)
              .join(", ")
          : "none"
      }`,
      `  Period   : ${periodStart} -> ${periodEnd}`,
      `  Currency : ${manifest.currencies.join(", ")}`,
      `  Input    : ${workspace.dir}`,
      `  Output   : ${workspace.processed}`,
      `  Workspace: ${isLegacy ? "root folder (legacy)" : workspace.slug}`,
      `  ARG      : ${resourceGraphEvidence.status} (${resourceGraphRows.length.toLocaleString()} rows)`,
      `  Advisor  : ${advisorEvidence.status} (${advisorRows.length.toLocaleString()} rows)`,
      ...OPTIONAL_EVIDENCE_KINDS.map(
        (kind) =>
          `  ${kind.padEnd(8)} : ${optionalEvidence[kind].status} ` +
          `(${optionalEvidence[kind].rowCount.toLocaleString()} rows)`,
      ),
      "",
      ...warnings.map((w) => `  ! ${w}`),
      "",
      "Start the dashboard with `npm run dev` to view the customer data.",
      "",
    ].join("\n"),
  );
}

function serialize(row: CustomerCostRow): string {
  return JSON.stringify(row);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\nIngestion failed: ${message}\n\n`);
  process.exitCode = 1;
});
