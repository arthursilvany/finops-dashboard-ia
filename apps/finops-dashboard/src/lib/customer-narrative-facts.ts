import fs from "node:fs";
import fsPromises from "node:fs/promises";
import readline from "node:readline";

import type {
  CustomerCostRow,
  CustomerDatasetManifest,
} from "./customer-data/contract";
import type {
  AdvisorEvidenceRow,
  CustomerEvidenceFile,
  ResourceGraphEvidenceRow,
} from "./customer-data/evidence";
import type {
  BudgetEvidenceRow,
  CommitmentEvidenceRow,
  HealthEvidenceRow,
  MetricEvidenceRow,
  OperationsEvidenceRow,
  OptionalEvidenceFile,
  PatchEvidenceRow,
  PolicyEvidenceRow,
  SecurityEvidenceRow,
} from "./customer-data/assessment-evidence";
import {
  LEGACY_WORKSPACE_SLUG,
  customerPaths,
} from "./customer-data/paths";
import { resolveActiveCustomerSlug } from "./customer-data/workspace";
import {
  NARRATIVE_SCHEMA_VERSION,
  assertSanitizedAssessmentFacts,
  type SanitizedAssessmentFacts,
} from "./customer-narrative-contract";

const RESOURCE_TYPE_PATTERN = /^microsoft\.[a-z0-9.]+\/[a-z0-9./]+$/;

type ServiceCategory =
  SanitizedAssessmentFacts["cost"]["topServices"][number]["serviceCategory"];
type AdvisorCategory =
  SanitizedAssessmentFacts["advisor"][number]["category"];
type AdvisorImpact = SanitizedAssessmentFacts["advisor"][number]["impact"];
type RecommendationTheme =
  SanitizedAssessmentFacts["advisor"][number]["recommendationTheme"];

const SERVICE_CATEGORIES = new Set<ServiceCategory>([
  "AI and Machine Learning",
  "Compute",
  "Storage",
  "Databases",
  "Networking",
  "Management and Governance",
  "Security",
  "Analytics",
  "Other",
]);

function controlledServiceCategory(value: string): ServiceCategory {
  return SERVICE_CATEGORIES.has(value as ServiceCategory)
    ? (value as ServiceCategory)
    : "Other";
}

function controlledAdvisorCategory(value: string): AdvisorCategory {
  const normalized = value.replace(/[\s_-]/g, "").toLowerCase();
  const categories: Record<string, AdvisorCategory> = {
    cost: "Cost",
    highavailability: "HighAvailability",
    reliability: "HighAvailability",
    security: "Security",
    performance: "Performance",
    operationexcellence: "OperationalExcellence",
    operationalexcellence: "OperationalExcellence",
  };
  return categories[normalized] ?? "Other";
}

function controlledAdvisorImpact(value: string): AdvisorImpact {
  const normalized = value.trim().toLowerCase();
  if (normalized === "high") return "High";
  if (normalized === "low") return "Low";
  return "Medium";
}

function recommendationTheme(row: AdvisorEvidenceRow): RecommendationTheme {
  const value = [
    row.recommendationTypeId,
    row.title,
    row.description,
  ]
    .join(" ")
    .toLowerCase();

  if (/availability|zone|redundan|resilien|failover/.test(value)) {
    return "availability";
  }
  if (/backup|restore|recovery|disaster/.test(value)) {
    return "backup-and-recovery";
  }
  if (/security|defender|encrypt|network security|mfa|vulnerab/.test(value)) {
    return "security-hardening";
  }
  if (/cost|saving|idle|unused|right.?siz|reservation/.test(value)) {
    return "cost-optimization";
  }
  if (/performance|throughput|latency|scale/.test(value)) {
    return "performance-efficiency";
  }
  if (/monitor|log|diagnostic|operation|alert/.test(value)) {
    return "operational-excellence";
  }
  if (/govern|policy|tag|compliance/.test(value)) return "governance";
  return "other";
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fsPromises.readFile(file, "utf8")) as T;
}

async function readOptionalRecords<T>(
  file: string,
  datasetGeneratedAtUtc: string,
): Promise<Pick<OptionalEvidenceFile<T>, "status" | "records">> {
  if (!fs.existsSync(file)) return { status: "missing", records: [] };
  const evidence = await readJson<OptionalEvidenceFile<T>>(file);
  if (evidence.datasetGeneratedAtUtc !== datasetGeneratedAtUtc) {
    return { status: "missing", records: [] };
  }
  return { status: evidence.status, records: evidence.records };
}

function wasCollected(evidence: Pick<OptionalEvidenceFile, "status">): boolean {
  return evidence.status === "available" || evidence.status === "empty";
}

function countByCurrency<T>(
  rows: T[],
  currencyOf: (row: T) => string,
  valueOf: (row: T) => number,
): Array<{ currency: string; count: number; total: number }> {
  const grouped = new Map<string, { count: number; total: number }>();
  for (const row of rows) {
    const currency = currencyOf(row).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) continue;
    const current = grouped.get(currency) ?? { count: 0, total: 0 };
    current.count += 1;
    current.total += Math.max(0, valueOf(row));
    grouped.set(currency, current);
  }
  return Array.from(grouped, ([currency, value]) => ({ currency, ...value }))
    .sort((left, right) => right.total - left.total)
    .slice(0, 4);
}

async function aggregateCostRows(rowsFile: string): Promise<{
  totalEffectiveCost: number;
  byCategory: Map<ServiceCategory, number>;
}> {
  const byCategory = new Map<ServiceCategory, number>();
  let totalEffectiveCost = 0;
  const input = fs.createReadStream(rowsFile, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });

  for await (const line of lines) {
    if (!line) continue;
    const row = JSON.parse(line) as CustomerCostRow;
    const cost = Number.isFinite(row.effectiveCost) ? row.effectiveCost : 0;
    const category = controlledServiceCategory(row.serviceCategory);
    totalEffectiveCost += cost;
    byCategory.set(category, (byCategory.get(category) ?? 0) + cost);
  }

  return { totalEffectiveCost, byCategory };
}

function periodDays(manifest: CustomerDatasetManifest): number {
  if (!manifest.periodStart || !manifest.periodEnd) return 0;
  const start = Date.parse(`${manifest.periodStart}T00:00:00Z`);
  const end = Date.parse(`${manifest.periodEnd}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.floor((end - start) / 86_400_000) + 1;
}

export async function buildSanitizedAssessmentFacts(
  slug?: string,
): Promise<SanitizedAssessmentFacts> {
  const paths = customerPaths(
    slug ?? resolveActiveCustomerSlug() ?? LEGACY_WORKSPACE_SLUG,
  );
  const [manifest, resources, advisor, costs] = await Promise.all([
    readJson<CustomerDatasetManifest>(paths.manifest),
    readJson<CustomerEvidenceFile<ResourceGraphEvidenceRow>>(
      paths.resourceGraph,
    ),
    readJson<CustomerEvidenceFile<AdvisorEvidenceRow>>(paths.advisor),
    aggregateCostRows(paths.rows),
  ]);
  const [
    policyEvidence,
    securityEvidence,
    healthEvidence,
    patchEvidence,
    operationsEvidence,
    metricsEvidence,
    budgetsEvidence,
    commitmentsEvidence,
  ] =
    await Promise.all([
      readOptionalRecords<PolicyEvidenceRow>(
        paths.policy,
        manifest.generatedAtUtc,
      ),
      readOptionalRecords<SecurityEvidenceRow>(
        paths.security,
        manifest.generatedAtUtc,
      ),
      readOptionalRecords<HealthEvidenceRow>(
        paths.health,
        manifest.generatedAtUtc,
      ),
      readOptionalRecords<PatchEvidenceRow>(
        paths.patch,
        manifest.generatedAtUtc,
      ),
      readOptionalRecords<OperationsEvidenceRow>(
        paths.operations,
        manifest.generatedAtUtc,
      ),
      readOptionalRecords<MetricEvidenceRow>(
        paths.metrics,
        manifest.generatedAtUtc,
      ),
      readOptionalRecords<BudgetEvidenceRow>(
        paths.budgets,
        manifest.generatedAtUtc,
      ),
      readOptionalRecords<CommitmentEvidenceRow>(
        paths.commitments,
        manifest.generatedAtUtc,
      ),
    ]);
  const policy = policyEvidence.records;
  const security = securityEvidence.records;
  const health = healthEvidence.records;
  const patch = patchEvidence.records;
  const operations = operationsEvidence.records;
  const metrics = metricsEvidence.records;
  const budgets = budgetsEvidence.records;
  const commitments = commitmentsEvidence.records;

  const inventoryCounts = new Map<string, number>();
  for (const resource of resources.records) {
    const type = resource.type.trim().toLowerCase();
    if (!RESOURCE_TYPE_PATTERN.test(type)) continue;
    inventoryCounts.set(type, (inventoryCounts.get(type) ?? 0) + 1);
  }

  const advisorGroups = new Map<
    string,
    SanitizedAssessmentFacts["advisor"][number]
  >();
  for (const item of advisor.records) {
    const category = controlledAdvisorCategory(item.category);
    const impact = controlledAdvisorImpact(item.impact);
    const theme = recommendationTheme(item);
    const normalizedCurrency = item.currency.trim().toUpperCase();
    const currency = /^[A-Z]{3}$/.test(normalizedCurrency)
      ? normalizedCurrency
      : undefined;
    const key = `${category}|${impact}|${theme}|${currency ?? "unknown"}`;
    const current = advisorGroups.get(key);
    if (current) {
      current.count += 1;
      if (currency) {
        current.annualSavings =
          (current.annualSavings ?? 0) +
          Math.max(item.annualSavingsAmount, 0);
      }
    } else {
      advisorGroups.set(key, {
        category,
        impact,
        recommendationTheme: theme,
        count: 1,
        ...(currency
          ? {
              annualSavings: Math.max(item.annualSavingsAmount, 0),
              currency,
            }
          : {}),
      });
    }
  }

  const limitations: SanitizedAssessmentFacts["coverage"]["limitations"] = [
    "static-snapshot",
  ];
  if (resources.status !== "available") limitations.push("missing-resource-graph");
  if (advisor.status !== "available") limitations.push("missing-advisor");
  if (wasCollected(policyEvidence) && policy.length === 0) {
    limitations.push("no-policy-assignments");
  } else if (!wasCollected(policyEvidence)) {
    limitations.push("missing-policy");
  }
  if (!wasCollected(securityEvidence)) limitations.push("missing-security");
  if (!wasCollected(healthEvidence)) limitations.push("missing-health");
  if (!wasCollected(operationsEvidence)) limitations.push("missing-operations");
  if (metrics.length === 0) {
    limitations.push("no-runtime-telemetry");
  }
  if (!wasCollected(metricsEvidence)) limitations.push("missing-metrics");
  if (!wasCollected(budgetsEvidence)) limitations.push("missing-budgets");
  if (!wasCollected(commitmentsEvidence)) limitations.push("missing-commitments");

  const monitoredResources = new Set(
    metrics.map((metric) => metric.resourceId.trim().toLowerCase()).filter(Boolean),
  ).size;
  if (
    monitoredResources > 0 &&
    monitoredResources < resources.records.length
  ) {
    limitations.push("partial-runtime-telemetry");
  }

  const policyCounts = { compliant: 0, nonCompliant: 0, unknown: 0 };
  for (const item of policy) {
    const state = item.complianceState.replace(/[\s_-]/g, "").toLowerCase();
    if (state === "compliant") policyCounts.compliant += 1;
    else if (state === "noncompliant") policyCounts.nonCompliant += 1;
    else policyCounts.unknown += 1;
  }
  const healthUnavailable = health.filter((item) =>
    /unavailable/i.test(item.availabilityState),
  ).length;
  const healthDegraded = health.filter((item) =>
    /degraded|unknown/i.test(item.availabilityState),
  ).length;
  const backupSignals = operations.filter((item) => item.kind === "backup");
  const budgetGroups = countByCurrency(
    budgets,
    (item) => item.currency,
    (item) => item.amount,
  );
  const commitmentGroups = countByCurrency(
    commitments,
    (item) => item.currency,
    (item) => item.annualSavings,
  );

  const positiveCategoryTotal = Array.from(costs.byCategory.values())
    .filter((cost) => cost > 0)
    .reduce((sum, cost) => sum + cost, 0);
  const topServices = Array.from(costs.byCategory.entries())
    .filter(([, cost]) => cost > 0)
    .sort(([, left], [, right]) => right - left)
    .slice(0, 10)
    .map(([serviceCategory, cost]) => ({
      serviceCategory,
      cost,
      percentage:
        positiveCategoryTotal > 0 ? (cost / positiveCategoryTotal) * 100 : 0,
    }));

  return assertSanitizedAssessmentFacts({
    schemaVersion: NARRATIVE_SCHEMA_VERSION,
    datasetGeneratedAtUtc: manifest.generatedAtUtc,
    sourceLastModifiedAtUtc:
      manifest.sourceLastModifiedAtUtc ?? manifest.generatedAtUtc,
    coverage: {
      costExport: true,
      resourceGraph: resources.status === "available",
      advisor: advisor.status === "available",
      policy: wasCollected(policyEvidence),
      security: wasCollected(securityEvidence),
      health: wasCollected(healthEvidence),
      operations: wasCollected(operationsEvidence),
      metrics: wasCollected(metricsEvidence),
      budgets: wasCollected(budgetsEvidence),
      commitments: wasCollected(commitmentsEvidence),
      limitations,
    },
    cost: {
      currencies: manifest.currencies
        .map((currency) => currency.toUpperCase())
        .filter((currency) => /^[A-Z]{3}$/.test(currency)),
      periodDays: periodDays(manifest),
      totalEffectiveCost: costs.totalEffectiveCost,
      topServices,
    },
    inventory: Array.from(inventoryCounts.entries())
      .sort(([, left], [, right]) => right - left)
      .slice(0, 100)
      .map(([resourceType, count]) => ({ resourceType, count })),
    advisor: Array.from(advisorGroups.values())
      .sort((left, right) => right.count - left.count)
      .slice(0, 100),
    governance: {
      policyStates: {
        total: policy.length,
        ...policyCounts,
      },
    },
    security: {
      assessments: {
        total: security.length,
        unhealthy: security.filter((item) =>
          /unhealthy|failed|noncompliant/i.test(item.status),
        ).length,
        highSeverity: security.filter((item) => /high|critical/i.test(item.severity))
          .length,
      },
    },
    reliability: {
      healthStates: {
        total: health.length,
        unavailable: healthUnavailable,
        degraded: healthDegraded,
      },
      backupSignals: {
        total: backupSignals.length,
        unhealthy: backupSignals.filter((item) =>
          /unhealthy|failed|error|warning/i.test(item.status),
        ).length,
      },
    },
    operations: {
      monitoredResources,
      inventoryResources: resources.records.length,
      metricCoveragePercentage:
        resources.records.length > 0
          ? Math.min(100, (monitoredResources / resources.records.length) * 100)
          : 0,
      diagnosticSignals: operations.filter((item) => item.kind === "diagnostic")
        .length,
      alertSignals: operations.filter((item) => item.kind === "alert").length,
      missingCriticalPatches: patch.reduce(
        (sum, item) => sum + Math.max(0, item.criticalCount),
        0,
      ),
      missingSecurityPatches: patch.reduce(
        (sum, item) => sum + Math.max(0, item.securityCount),
        0,
      ),
    },
    financialGovernance: {
      budgets: budgetGroups.map((item) => ({
        currency: item.currency,
        count: item.count,
        totalAmount: item.total,
      })),
      commitments: {
        recommendationCount: commitments.length,
        annualSavingsByCurrency: commitmentGroups.map((item) => ({
          currency: item.currency,
          annualSavings: item.total,
        })),
      },
    },
  });
}
