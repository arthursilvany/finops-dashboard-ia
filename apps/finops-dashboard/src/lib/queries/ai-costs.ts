// AI Cost Observability KQL queries — FinOps Hub FOCUS schema
// All queries filter on ServiceCategory == "AI and Machine Learning"

import type { ParsedFilters } from "../filter-schema";
import { buildFilterClauses, costColumn } from "./filter-builder";

const AI_FILTER = `| where ServiceCategory == "AI and Machine Learning"`;

export function aiCostKpi(filters?: ParsedFilters): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";
  return `
Costs()
${fc}
${AI_FILTER}
| where ChargePeriodStart >= ago(30d)
| summarize TotalCost = sum(${cc}),
    ResourceCount = dcount(ResourceName)
| extend AvgCostPerResource = round(TotalCost / ResourceCount, 2)
`;
}

export function aiCostKpiPrevious(filters?: ParsedFilters): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";
  return `
Costs()
${fc}
${AI_FILTER}
| where ChargePeriodStart between (ago(60d) .. ago(30d))
| summarize TotalCost = sum(${cc})
`;
}

export function aiCostByModel(filters?: ParsedFilters): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";
  return `
Costs()
${fc}
${AI_FILTER}
| where ChargePeriodStart >= ago(30d)
| summarize Cost = round(sum(${cc}), 2) by ResourceName
| order by Cost desc
| take 10
`;
}

export function aiCostDaily(filters?: ParsedFilters): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";
  return `
Costs()
${fc}
${AI_FILTER}
| where ChargePeriodStart >= ago(30d)
| summarize DailyCost = round(sum(${cc}), 2) by bin(ChargePeriodStart, 1d)
| order by ChargePeriodStart asc
| project Day = format_datetime(ChargePeriodStart, 'yyyy-MM-dd'), Cost = DailyCost
`;
}

export function aiCostByResource(filters?: ParsedFilters): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";
  return `
Costs()
${fc}
${AI_FILTER}
| where ChargePeriodStart >= ago(30d)
| summarize Cost = round(sum(${cc}), 2),
    DailyAvg = round(avg(${cc}), 2)
    by ResourceName, x_ResourceGroupName, SubAccountName
| order by Cost desc
`;
}

export function aiAnomalyTimeline(filters?: ParsedFilters): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";
  return `
let startDate = ago(30d);
let endDate = now();
Costs()
${fc}
${AI_FILTER}
| where ChargePeriodStart between (startDate .. endDate)
| make-series CostSeries = sum(${cc}) on ChargePeriodStart from startDate to endDate step 1d
| extend (anomalies, score, baseline) = series_decompose_anomalies(CostSeries, 1.5)
| mv-expand ChargePeriodStart to typeof(datetime),
    CostSeries to typeof(real),
    anomalies to typeof(int),
    score to typeof(real),
    baseline to typeof(real)
| project Day = format_datetime(ChargePeriodStart, 'yyyy-MM-dd'),
    ActualCost = round(CostSeries, 2),
    Baseline = round(baseline, 2),
    AnomalyFlag = anomalies
`;
}

export function aiAnomalyTopResources(filters?: ParsedFilters): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";
  return `
Costs()
${fc}
${AI_FILTER}
| where ChargePeriodStart >= ago(7d)
| summarize DayCost = round(sum(${cc}), 2) by ResourceName, ServiceName
| join kind=inner (
    Costs()
    ${fc}
    ${AI_FILTER}
    | where ChargePeriodStart between (ago(37d) .. ago(7d))
    | summarize BaselineCost = round(avg(${cc}), 2) by ResourceName
) on ResourceName
| extend DeviationPercent = round((DayCost - BaselineCost) / BaselineCost * 100, 1)
| where DeviationPercent > 100
| order by DeviationPercent desc
| take 5
`;
}

export function aiCostAllocation(filters?: ParsedFilters): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";
  return `
Costs()
${fc}
${AI_FILTER}
| where ChargePeriodStart >= ago(30d)
| extend BU = tostring(todynamic(Tags)['cost-center']),
    AIApp = tostring(todynamic(Tags)['ai-app']),
    AIModel = tostring(todynamic(Tags)['ai-model'])
| summarize Cost = round(sum(${cc}), 2) by BU, AIApp, AIModel
| order by Cost desc
`;
}
