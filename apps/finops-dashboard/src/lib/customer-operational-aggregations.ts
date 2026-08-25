import { getCustomerAssessment } from "./customer-assessment";
import { getCustomerDataset } from "./customer-dataset";
import {
  classifyActionType,
  classifyAgenticStage,
  classifyRecommendationCategory,
  parseResourceId,
} from "./resource-graph-client";
import type {
  AgenticRecommendation,
  AgenticSummary,
  CpuCostPoint,
  RightsizingRow,
  WorkloadKpi,
} from "./types";

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

function monthlyResourceCosts(customerSlug?: string | null): Map<string, number> {
  const dataset = getCustomerDataset(customerSlug ?? undefined);
  const result = new Map<string, number>();
  if (!dataset?.manifest.periodEnd) return result;
  const end = Date.parse(`${dataset.manifest.periodEnd}T00:00:00Z`);
  const start = new Date(end - 29 * 86_400_000).toISOString().slice(0, 10);
  for (const row of dataset.rows) {
    if (row.chargePeriodStart < start || !row.resourceId) continue;
    const key = normalized(row.resourceId);
    result.set(key, (result.get(key) ?? 0) + row.effectiveCost);
  }
  return result;
}

function cpuByResource(customerSlug?: string | null): Map<string, number> {
  const metrics = getCustomerAssessment(customerSlug)?.metrics ?? [];
  const grouped = new Map<string, number[]>();
  for (const metric of metrics) {
    if (!/percentage cpu|cpu percentage|cpu utilization/i.test(metric.metricName)) {
      continue;
    }
    const key = normalized(metric.resourceId);
    grouped.set(key, [...(grouped.get(key) ?? []), metric.average]);
  }
  return new Map(
    Array.from(grouped, ([key, values]) => [
      key,
      values.reduce((sum, value) => sum + value, 0) / values.length,
    ]),
  );
}

function costAdvisorRows(customerSlug?: string | null) {
  return (getCustomerAssessment(customerSlug)?.advisor ?? []).filter(
    (row) => normalized(row.category) === "cost",
  );
}

export function aggregateCustomerWorkload(customerSlug?: string | null): {
  kpi: WorkloadKpi;
  scatter: CpuCostPoint[];
  rightsizing: RightsizingRow[];
} | null {
  const assessment = getCustomerAssessment(customerSlug);
  if (!assessment) return null;

  const costs = monthlyResourceCosts(customerSlug);
  const cpu = cpuByResource(customerSlug);
  const resources = new Map(
    assessment.resources.map((resource) => [normalized(resource.id), resource]),
  );
  const candidates = costAdvisorRows(customerSlug).filter((row) =>
    /right.?siz|resize|underutil|shut.?down|deallocat/i.test(
      `${row.title} ${row.description} ${row.recommendationTypeId}`,
    ),
  );

  const rightsizing = candidates.map((row) => {
    const resource = resources.get(normalized(row.resourceId));
    const properties = row.extendedProperties;
    const currentCost = costs.get(normalized(row.resourceId)) ?? 0;
    const monthlySavings = Math.max(row.annualSavingsAmount, 0) / 12;
    return {
      resourceName: resource?.name ?? parseResourceId(row.resourceId).resourceName,
      resourceGroup:
        resource?.resourceGroup ?? parseResourceId(row.resourceId).resourceGroup,
      subscriptionName: resource?.subscriptionId ?? "",
      currentSku: properties.currentSku ?? properties.currentSize ?? resource?.sku ?? "",
      recommendedSku:
        properties.recommendedSku ?? properties.recommendedSize ?? "",
      cpuAvg: cpu.get(normalized(row.resourceId)) ?? 0,
      currentCost,
      projectedCost: Math.max(0, currentCost - monthlySavings),
      monthlySavings,
    } satisfies RightsizingRow;
  });

  const scatter = Array.from(cpu.entries()).map(([resourceId, cpuAvg]) => {
    const resource = resources.get(resourceId);
    return {
      name: resource?.name ?? parseResourceId(resourceId).resourceName,
      cpuAvg,
      monthlyCost: costs.get(resourceId) ?? 0,
      service: resource?.type ?? "Microsoft.Compute/virtualMachines",
    } satisfies CpuCostPoint;
  });

  const vmResources = assessment.resources.filter((resource) =>
    /microsoft\.compute\/(virtualmachines|virtualmachinescalesets)$/i.test(
      resource.type,
    ),
  );
  const cpuValues = Array.from(cpu.values());
  return {
    kpi: {
      totalVMs: vmResources.length,
      rightsizingCandidates: rightsizing.length,
      potentialMonthlySavings: rightsizing.reduce(
        (sum, row) => sum + row.monthlySavings,
        0,
      ),
      avgCpuUtilization:
        cpuValues.length > 0
          ? Math.round(
              cpuValues.reduce((sum, value) => sum + value, 0) / cpuValues.length,
            )
          : 0,
    },
    scatter,
    rightsizing,
  };
}

function buildAgenticSummary(recommendations: AgenticRecommendation[]): AgenticSummary {
  const summary: AgenticSummary = {
    totalRecommendations: recommendations.length,
    totalPotentialSavings: 0,
    readyForAction: 0,
    pendingApproval: 0,
    byRisk: { low: 0, medium: 0, high: 0 },
    byCategory: {},
    byStage: {
      detect: 0,
      analyze: 0,
      decide: 0,
      ready: 0,
      "pending-approval": 0,
    },
  };
  for (const item of recommendations) {
    summary.totalPotentialSavings += item.potentialSavings;
    summary.byRisk[item.riskLevel] += 1;
    summary.byCategory[item.recommendationCategory] =
      (summary.byCategory[item.recommendationCategory] ?? 0) + 1;
    summary.byStage[item.agenticStage] += 1;
    if (item.agenticStage === "ready") summary.readyForAction += 1;
    if (item.requiresApproval) summary.pendingApproval += 1;
  }
  return summary;
}

export function aggregateCustomerAgentic(customerSlug?: string | null): {
  recommendations: AgenticRecommendation[];
  summary: AgenticSummary;
} | null {
  const assessment = getCustomerAssessment(customerSlug);
  if (!assessment) return null;
  const resources = new Map(
    assessment.resources.map((resource) => [normalized(resource.id), resource]),
  );
  const recommendations = costAdvisorRows(customerSlug).map((row) => {
    const resource = resources.get(normalized(row.resourceId));
    const actionType = classifyActionType(row.resourceType, row.title);
    const classification = classifyAgenticStage(
      row.impact,
      actionType,
      row.annualSavingsAmount,
    );
    const parsed = parseResourceId(row.resourceId);
    return {
      id: row.id,
      resourceId: row.resourceId,
      resourceName: resource?.name ?? parsed.resourceName,
      resourceType: row.resourceType || resource?.type || "",
      resourceGroup: resource?.resourceGroup ?? parsed.resourceGroup,
      subscriptionName: resource?.subscriptionId ?? "",
      impact: normalized(row.impact) as "high" | "medium" | "low",
      title: row.title,
      description: row.description,
      solution: row.description,
      potentialSavings: Math.max(row.annualSavingsAmount, 0),
      agenticStage: classification.stage,
      riskLevel: classification.risk,
      confidenceScore: classification.confidence,
      requiresApproval: classification.requiresApproval,
      actionType,
      recommendationCategory: classifyRecommendationCategory(actionType),
    } satisfies AgenticRecommendation;
  });
  return { recommendations, summary: buildAgenticSummary(recommendations) };
}
