// Rate Optimization KQL queries — FinOps Hub FOCUS schema

import type { ParsedFilters } from "../filter-schema";
import { buildFilterClauses, costColumn } from "./filter-builder";

export function commitmentGap(filters?: ParsedFilters): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";
  return `
Costs()
${fc}
| where ChargePeriodStart >= ago(30d)
| where ChargeCategory == "Usage"
| summarize
    OnDemandCost = sumif(${cc}, PricingCategory == "Standard"),
    CommittedCost = sumif(${cc}, PricingCategory == "Committed"),
    TotalUsageCost = sum(${cc})
    by ServiceName
| where OnDemandCost > 50
| extend CommitmentCoverage = round(CommittedCost / TotalUsageCost * 100, 1)
| extend PotentialSavings = round(OnDemandCost * 0.30, 2)
| order by OnDemandCost desc
| top 15 by OnDemandCost
| project ServiceName,
    OnDemandCost = round(OnDemandCost, 2),
    CommittedCost = round(CommittedCost, 2),
    CommitmentCoverage,
    PotentialSavings
`;
}

export function savingsOpportunitySummary(filters?: ParsedFilters): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";
  return `
let commitmentGap =
    Costs()
    ${fc}
    | where ChargePeriodStart >= ago(30d)
    | where ChargeCategory == "Usage"
    | summarize
        OnDemand = sumif(${cc}, PricingCategory == "Standard"),
        Total = sum(${cc})
    | extend PotentialSavings = round(OnDemand * 0.30, 2)
    | project PotentialSavings;
let idleWaste =
    Costs()
    ${fc}
    | where ChargePeriodStart >= ago(30d)
    | where ChargeCategory == "Usage"
    | summarize TotalCost = sum(${cc}), AvgDailyCost = avg(${cc})
        by ResourceId
    | where AvgDailyCost < 1.0 and TotalCost > 0
    | summarize IdleWaste = round(sum(TotalCost), 2);
commitmentGap
| extend placeholder = 1
| join kind=inner (idleWaste | extend placeholder = 1) on placeholder
| project
    CommitmentGapSavings = PotentialSavings,
    IdleResourceSavings = IdleWaste,
    TotalPotentialSavings = round(PotentialSavings + IdleWaste, 2)
`;
}

export function topOptimizationActions(filters?: ParsedFilters): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";
  return `
let commitmentActions =
    Costs()
    ${fc}
    | where ChargePeriodStart >= ago(30d)
    | where ChargeCategory == "Usage"
    | summarize OnDemandCost = sumif(${cc}, PricingCategory == "Standard")
        by ServiceName
    | where OnDemandCost > 100
    | extend PotentialSavings = round(OnDemandCost * 0.30, 2)
    | extend Action = strcat("Purchase commitment for ", ServiceName)
    | extend Category = "Commitment"
    | project Action, Category, PotentialSavings;
let idleActions =
    Costs()
    ${fc}
    | where ChargePeriodStart >= ago(30d)
    | where ChargeCategory == "Usage"
    | summarize TotalCost = sum(${cc}), AvgDailyCost = avg(${cc}),
        DaysActive = dcount(startofday(ChargePeriodStart))
        by ResourceName, ServiceName
    | where AvgDailyCost < 1.0 and DaysActive >= 25 and TotalCost > 0
    | extend PotentialSavings = round(TotalCost, 2)
    | extend Action = strcat("Deallocate idle: ", ResourceName, " (", ServiceName, ")")
    | extend Category = "Idle Resource"
    | project Action, Category, PotentialSavings;
union commitmentActions, idleActions
| order by PotentialSavings desc
| take 20
| project Action, Category, PotentialMonthlySavings = PotentialSavings
`;
}

export function idleResources(filters?: ParsedFilters): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";
  return `
Costs()
${fc}
| where ChargePeriodStart >= ago(30d)
| where ChargeCategory == "Usage"
| summarize
    TotalCost = sum(${cc}),
    DaysActive = dcount(startofday(ChargePeriodStart)),
    AvgDailyCost = avg(${cc})
    by ResourceId, ResourceName, ServiceName, SubAccountName
| where TotalCost > 0 and AvgDailyCost < 1.0 and DaysActive >= 25
| extend MonthlyCost = round(TotalCost, 2)
| top 20 by MonthlyCost desc
| project ResourceName, ServiceName, SubAccountName, MonthlyCost,
    AvgDailyCost = round(AvgDailyCost, 4), DaysActive
`;
}

export function effectiveSavingsRateSummary(filters?: ParsedFilters): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  return `
Costs()
${fc}
| extend x_AmortizationClass = case(
    ChargeCategory == "Purchase" and isnotempty(CommitmentDiscountCategory), "Principal",
    isnotempty(CommitmentDiscountCategory), "Amortized Charge",
    ""
)
| where x_AmortizationClass != "Principal"
| summarize
    ListCost = sum(ListCost),
    EffectiveCost = sum(EffectiveCost)
| extend TotalSavings = ListCost - EffectiveCost
| extend EffectiveSavingsRate = iff(ListCost == 0, real(0), TotalSavings / ListCost)
| project
    TotalSavings = round(TotalSavings, 2),
    ListCost = round(ListCost, 2),
    EffectiveCost = round(EffectiveCost, 2),
    EffectiveSavingsRate = round(EffectiveSavingsRate * 100.0, 2)
`;
}

export function effectiveSavingsRateBreakdown(filters?: ParsedFilters): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  return `
Costs()
${fc}
| extend x_AmortizationClass = case(
    ChargeCategory == "Purchase" and isnotempty(CommitmentDiscountCategory), "Principal",
    isnotempty(CommitmentDiscountCategory), "Amortized Charge",
    ""
)
| summarize
    ListCost = sumif(ListCost, x_AmortizationClass != "Principal"),
    EffectiveCost = sum(EffectiveCost)
    by Month = substring(startofmonth(ChargePeriodStart), 0, 7)
| extend Savings = ListCost - EffectiveCost
| extend ESR = iff(ListCost == 0, real(0), Savings / ListCost)
| order by Month desc
| project
    Month,
    ListCost = round(ListCost, 2),
    EffectiveCost = round(EffectiveCost, 2),
    Savings = round(Savings, 2),
    ESR = round(ESR * 100.0, 2)
`;
}
