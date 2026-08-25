// Anomaly detection KQL queries — FinOps Hub FOCUS schema

import type { ParsedFilters } from "../filter-schema";
import { buildFilterClauses, costColumn } from "./filter-builder";

export function anomalyTimeline(filters?: ParsedFilters): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";
  return `
let dataStart = toscalar(Costs() ${fc} | summarize min(ChargePeriodStart));
let startDate = startofday(dataStart);
let endDate = now();
Costs()
${fc}
| where ChargePeriodStart between (startDate .. endDate)
| summarize DailyCost = sum(${cc}) by Day = startofday(ChargePeriodStart)
| order by Day asc
| make-series CostSeries = sum(DailyCost) on Day from startDate to endDate step 1d
| extend (anomalies, score, baseline) = series_decompose_anomalies(CostSeries, 1.5)
| mv-expand Day to typeof(datetime),
    CostSeries to typeof(real),
    anomalies to typeof(int),
    score to typeof(real),
    baseline to typeof(real)
| project Day,
    ActualCost = round(CostSeries, 2),
    Baseline = round(baseline, 2),
    AnomalyFlag = anomalies,
    AnomalyScore = round(score, 2)
`;
}

export function anomalySummary(filters?: ParsedFilters): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";
  return `
let dataStart = toscalar(Costs() ${fc} | summarize min(ChargePeriodStart));
let startDate = startofday(dataStart);
let endDate = now();
Costs()
${fc}
| where ChargePeriodStart between (startDate .. endDate)
| summarize DailyCost = sum(${cc}) by Day = startofday(ChargePeriodStart)
| order by Day asc
| make-series CostSeries = sum(DailyCost) on Day from startDate to endDate step 1d
| extend (anomalies, score, baseline) = series_decompose_anomalies(CostSeries, 1.5)
| mv-expand Day to typeof(datetime),
    CostSeries to typeof(real),
    anomalies to typeof(int),
    score to typeof(real),
    baseline to typeof(real)
| where anomalies != 0
| summarize
    Anomalies7d = countif(Day >= ago(7d)),
    Anomalies30d = countif(Day >= ago(30d)),
    LargestDeviation = round(max(abs(CostSeries - baseline)), 2),
    LastAnomalyDate = max(Day)
`;
}

export function anomalyTopResources(
  anomalyDate: string,
  filters?: ParsedFilters,
): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";
  return `
let anomalyDate = datetime(${anomalyDate});
Costs()
${fc}
| where startofday(ChargePeriodStart) == anomalyDate
| summarize DayCost = sum(${cc}) by ServiceName, ResourceName, ResourceId
| top 15 by DayCost desc
| extend DayCost = round(DayCost, 2)
| project ServiceName, ResourceName, DayCost
`;
}
