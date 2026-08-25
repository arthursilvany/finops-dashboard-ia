import type { ParsedFilters } from "@/lib/filter-schema";
import { buildFilterClauses, costColumn } from "@/lib/queries/filter-builder";

// Reservation recommendation rows mapped to the RightsizingRow shape.
// Queried against the Ingestion DB (passed via overrideDatabase).
export function workloadRightsizingKql(): string {
  return `
Recommendations_final_v1_2
| extend details = todynamic(x_RecommendationDetails)
| extend MonthlySavings = toreal(x_EffectiveCostSavings) * 30.0
| project
    ResourceName  = strcat(tostring(details.CommitmentDiscountNormalizedGroup), " - ", tostring(details.RegionName)),
    ResourceGroup = tostring(x_ResourceGroupName),
    SubscriptionName = tostring(SubAccountName),
    CurrentSku    = tostring(details.CommitmentDiscountNormalizedSize),
    RecommendedSku = tostring(details.SkuSize),
    CpuAvg        = 0.0,
    CurrentCost   = toreal(x_EffectiveCostBefore) * 30.0,
    ProjectedCost = toreal(x_EffectiveCostAfter) * 30.0,
    MonthlySavings
| order by MonthlySavings desc
`.trim();
}

// Cost scatter — savings % vs monthly cost per recommendation.
// No CPU data available; uses savings percentage as the "CpuAvg" axis.
export function workloadCpuScatterKql(): string {
  return `
Recommendations_final_v1_2
| extend details = todynamic(x_RecommendationDetails)
| extend MonthlyCost = toreal(x_EffectiveCostBefore) * 30.0
| extend SavingsPct  = iff(x_EffectiveCostBefore > 0, toreal(x_EffectiveCostSavings) / toreal(x_EffectiveCostBefore) * 100.0, 0.0)
| project
    Name = strcat(tostring(details.SkuSize), " (", tostring(details.RegionName), ")"),
    CpuAvg = SavingsPct,
    MonthlyCost,
    Service = "Virtual Machines"
| order by MonthlyCost desc
`.trim();
}

// Summary KPIs for Workload page (Ingestion DB).
// Uses reservation recommendations — no CPU data available.
export function workloadKpiKql(): string {
  return `
Recommendations_final_v1_2
| summarize
    totalRecs       = count(),
    dailySavings    = sum(toreal(x_EffectiveCostSavings)),
    avgDailyCostBefore = avg(toreal(x_EffectiveCostBefore))
| extend metric = "combined"
| project
    totalVMs             = totalRecs,
    rightsizingCandidates = totalRecs,
    potentialMonthlySavings = dailySavings * 30.0,
    avgCpuUtilization    = 0.0
`.trim();
}

// Not used directly but exported for completeness
export { buildFilterClauses, costColumn };
