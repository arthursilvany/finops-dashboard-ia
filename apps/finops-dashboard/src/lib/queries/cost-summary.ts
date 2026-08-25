// Cost Summary KQL queries — FinOps Hub FOCUS schema

import type { ParsedFilters } from "../filter-schema";
import { buildFilterClauses, costColumn } from "./filter-builder";

export function kpiSummaryQuery(filters?: ParsedFilters): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";
  return `
let lastMonthStart = startofmonth(ago(30d));
let thisMonthStart = startofmonth(now());
let prevMonthStart = startofmonth(ago(60d));
let costData = Costs()
${fc}
| where ChargePeriodStart >= prevMonthStart;
let costLast = toscalar(costData | where ChargePeriodStart >= lastMonthStart and ChargePeriodStart < thisMonthStart | summarize round(sum(${cc}), 2));
let costPrev = toscalar(costData | where ChargePeriodStart >= prevMonthStart and ChargePeriodStart < lastMonthStart | summarize round(sum(${cc}), 2));
let daysInLastMonth = datetime_diff('day', thisMonthStart, lastMonthStart);
let topSvc = costData | where ChargePeriodStart >= lastMonthStart and ChargePeriodStart < thisMonthStart | summarize Svc = round(sum(${cc}), 2) by ServiceName | top 1 by Svc desc;
print CostLastMonth = costLast,
      CostPreviousMonth = costPrev,
      DailyAverage = round(costLast / daysInLastMonth, 2),
      TopService = toscalar(topSvc | project ServiceName),
      TopServiceCost = toscalar(topSvc | project Svc)
`;
}

export function costOverTime(
  numberOfMonths: number,
  filters?: ParsedFilters,
): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";
  return `
Costs()
${fc}
| where ChargePeriodStart >= startofmonth(ago(${numberOfMonths * 30}d))
| summarize MonthlyCost = sum(${cc}) by Month = startofmonth(ChargePeriodStart)
| order by Month asc
| project Month, MonthlyCost = round(MonthlyCost, 2)
`;
}

export function costByService(
  maxGroupCount: number,
  filters?: ParsedFilters,
): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";
  return `
let topN = ${maxGroupCount};
Costs()
${fc}
| where ChargePeriodStart >= startofmonth(ago(30d))
| summarize ServiceCost = sum(${cc}) by ServiceName
| top topN by ServiceCost desc
| extend TotalCost = toscalar(
    Costs()
    ${fc}
    | where ChargePeriodStart >= startofmonth(ago(30d))
    | summarize sum(${cc})
  )
| extend Percentage = round(ServiceCost / TotalCost * 100, 1)
| project ServiceName, ServiceCost = round(ServiceCost, 2), Percentage
`;
}

export function costBySubscription(filters?: ParsedFilters): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";
  return `
Costs()
${fc}
| where ChargePeriodStart >= startofmonth(ago(30d))
| summarize SubscriptionCost = sum(${cc}) by SubAccountName
| extend TotalCost = toscalar(
    Costs()
    ${fc}
    | where ChargePeriodStart >= startofmonth(ago(30d))
    | summarize sum(${cc})
  )
| extend Percentage = round(SubscriptionCost / TotalCost * 100, 1)
| order by SubscriptionCost desc
| project SubAccountName, SubscriptionCost = round(SubscriptionCost, 2), Percentage
`;
}

/**
 * Cost split by cloud provider. Mirrors `aggregateCostByProvider`.
 *
 * `ProviderName` is the raw vendor spelling in FOCUS ("Microsoft", "AWS"), so
 * the API layer normalizes the label before it reaches the UI.
 */
export function costByProvider(filters?: ParsedFilters): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";
  return `
Costs()
${fc}
| where ChargePeriodStart >= startofmonth(ago(30d))
| summarize ProviderCost = sum(${cc}) by ProviderName
| extend TotalCost = toscalar(
    Costs()
    ${fc}
    | where ChargePeriodStart >= startofmonth(ago(30d))
    | summarize sum(${cc})
  )
| extend Percentage = round(ProviderCost / TotalCost * 100, 1)
| order by ProviderCost desc
| project ProviderName, ProviderCost = round(ProviderCost, 2), Percentage
`;
}

export function dailyCostTrend(
  numberOfDays: number,
  filters?: ParsedFilters,
): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";
  return `
Costs()
${fc}
| where ChargePeriodStart >= ago(${numberOfDays}d)
| summarize DailyCost = sum(${cc}) by Day = startofday(ChargePeriodStart)
| order by Day asc
| project Day, DailyCost = round(DailyCost, 2)
`;
}

export function costSummaryKpiQuery(filters?: ParsedFilters): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";
  return `
let lastData = Costs()
${fc}
| where ChargePeriodStart >= ago(30d);
let prevData = Costs()
${fc}
| where ChargePeriodStart >= ago(60d) and ChargePeriodStart < ago(30d);
let totalLast = toscalar(lastData | summarize round(sum(${cc}), 2));
let totalPrev = toscalar(prevData | summarize round(sum(${cc}), 2));
let subCount = toscalar(lastData | summarize dcount(SubAccountName));
let resCount = toscalar(lastData | summarize dcount(ResourceId));
print TotalCost30d = totalLast,
      SubscriptionCount = subCount,
      ResourceCount = resCount,
      MomChangePercent = round(iif(totalPrev > 0, (totalLast - totalPrev) / totalPrev * 100.0, 0.0), 1),
      MomChangeDelta = round(totalLast - totalPrev, 2)
`;
}

export function miniKpiQuery(filters?: ParsedFilters): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";
  return `
let data = Costs()
${fc}
| where ChargePeriodStart >= ago(30d)
| where column_ifexists('ChargeCategory', column_ifexists('ChargeType', 'Usage')) == 'Usage';
let total = toscalar(data | summarize sum(${cc}));
let committed = toscalar(data | where column_ifexists('PricingCategory', column_ifexists('PricingModel', 'Other')) == 'Commitment' or column_ifexists('PricingCategory', column_ifexists('PricingModel', 'Other')) == 'Committed' | summarize sum(${cc}));
let tagged = toscalar(data | where isnotempty(column_ifexists('Tags', '')) and column_ifexists('Tags', '') != '{}' | summarize sum(${cc}));
print CommitmentCoverage = round(iif(total > 0, todouble(committed) / todouble(total) * 100.0, 0.0), 1),
      TagCoverage = round(iif(total > 0, todouble(tagged) / todouble(total) * 100.0, 0.0), 1)
`;
}

export function pricingModelQuery(filters?: ParsedFilters): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";
  return `
Costs()
${fc}
| where ChargePeriodStart >= ago(30d)
| where column_ifexists('ChargeCategory', column_ifexists('ChargeType', 'Usage')) == 'Usage'
| extend model = coalesce(column_ifexists('PricingCategory', ''), column_ifexists('PricingModel', ''), 'Other')
| summarize cost = round(sum(${cc}), 2) by model
| where cost > 0
| order by cost desc
`;
}

export function dailyByCategoryQuery(
  numberOfDays: number,
  filters?: ParsedFilters,
): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";
  return `
Costs()
${fc}
| where ChargePeriodStart >= ago(${numberOfDays}d)
| extend Category = case(
    ServiceCategory == 'Compute', 'Compute',
    ServiceCategory == 'AI and Machine Learning', 'AI/ML',
    ServiceCategory == 'Databases', 'Database',
    ServiceCategory == 'Storage', 'Storage',
    ServiceCategory == 'Networking', 'Network',
    'Others'
  )
| summarize cost = round(sum(${cc}), 2) by Day = format_datetime(startofday(ChargePeriodStart), 'yyyy-MM-dd'), Category
| order by Day asc
`;
}

export function serviceTrendQuery(filters?: ParsedFilters): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";
  return `
let last30 = Costs()
${fc}
| where ChargePeriodStart >= ago(30d)
| summarize cost = sum(${cc}) by ServiceName;
let prev30 = Costs()
${fc}
| where ChargePeriodStart >= ago(60d) and ChargePeriodStart < ago(30d)
| summarize prevCost = sum(${cc}) by ServiceName;
last30
| join kind=leftouter prev30 on ServiceName
| extend mom = iif(prevCost > 0, (cost - prevCost) / prevCost * 100.0, 0.0)
| top 10 by cost desc
| project service = ServiceName, cost = round(cost, 2), momPercent = round(mom, 1)
`;
}
