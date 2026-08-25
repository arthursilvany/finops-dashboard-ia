import { readFile, writeFile, mkdir, readdir } from "fs/promises";
import { join } from "path";

import {
  LEGACY_WORKSPACE_SLUG,
  isSafeWorkspaceName,
} from "./customer-data/paths";

export interface DailyInsightReport {
  date: string;
  content: string;
  generatedAt: string;
  tokens?: { prompt: number; completion: number; reasoning?: number; total: number };
}

const DEFAULT_NAMESPACE = "default";

function storeRootDir(): string {
  return process.env.DAILY_INSIGHTS_DIR ?? join(
    process.cwd(),
    ".data",
    "daily-insights",
  );
}

function reportNamespace(customerSlug?: string | null): string {
  if (!customerSlug) return DEFAULT_NAMESPACE;
  if (customerSlug === LEGACY_WORKSPACE_SLUG) return "legacy";
  if (!isSafeWorkspaceName(customerSlug)) {
    throw new Error("Invalid customer report namespace.");
  }
  return customerSlug;
}

function reportDir(customerSlug?: string | null): string {
  return join(storeRootDir(), reportNamespace(customerSlug));
}

function reportPath(date: string, customerSlug?: string | null): string {
  return join(reportDir(customerSlug), `${date}.json`);
}

export async function saveReport(
  report: DailyInsightReport,
  customerSlug?: string | null,
): Promise<void> {
  await mkdir(reportDir(customerSlug), { recursive: true });
  await writeFile(
    reportPath(report.date, customerSlug),
    JSON.stringify(report, null, 2),
    "utf-8",
  );
}

export async function loadReport(
  date: string,
  customerSlug?: string | null,
): Promise<DailyInsightReport | null> {
  const path = reportPath(date, customerSlug);
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as DailyInsightReport;
  } catch {
    return null;
  }
}

export async function listReports(
  customerSlug?: string | null,
): Promise<DailyInsightReport[]> {
  const dir = reportDir(customerSlug);
  try {
    await mkdir(dir, { recursive: true });
    const files = await readdir(dir);
    const reports: DailyInsightReport[] = [];
    for (const file of files
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse()) {
      try {
        const raw = await readFile(join(dir, file), "utf-8");
        reports.push(JSON.parse(raw));
      } catch {
        continue;
      }
    }
    return reports;
  } catch {
    return [];
  }
}
