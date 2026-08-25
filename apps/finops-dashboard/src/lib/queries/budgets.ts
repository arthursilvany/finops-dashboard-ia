// Budget tracking KQL queries — FinOps Hub FOCUS schema

import type { ParsedFilters } from "../filter-schema";
import { buildFilterClauses, costColumn } from "./filter-builder";

export function budgetBurnRate(
  monthlyBudget: number,
  filters?: ParsedFilters,
): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";
  return `
let monthlyBudget = ${monthlyBudget}.0;
let monthStart = startofmonth(now());
let today = startofday(now());
let daysElapsed = max_of(datetime_diff('day', today, monthStart) + 1, 1);
let daysInMonth = datetime_diff('day', startofmonth(datetime_add('month', 1, now())), monthStart);
Costs()
${fc}
| where ChargePeriodStart >= monthStart
| summarize SpentSoFar = sum(${cc})
| extend DailyBurnRate = round(SpentSoFar / daysElapsed, 2)
| extend ProjectedMonthEnd = round(DailyBurnRate * daysInMonth, 2)
| extend BudgetVariance = round(ProjectedMonthEnd - monthlyBudget, 2)
| extend BudgetUsedPercent = round(SpentSoFar / monthlyBudget * 100, 1)
| extend Status = case(
    BudgetUsedPercent > 100, "EXCEEDED",
    ProjectedMonthEnd > monthlyBudget, "AT_RISK",
    "ON_TRACK"
  )
| project
    SpentSoFar = round(SpentSoFar, 2),
    DailyBurnRate,
    ProjectedMonthEnd,
    Budget = monthlyBudget,
    BudgetVariance,
    BudgetUsedPercent,
    Status
`;
}

export function budgetVsActual(
  monthlyBudget: number,
  filters?: ParsedFilters,
): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";
  return `
let monthlyBudget = ${monthlyBudget}.0;
let monthStart = startofmonth(now());
let daysInMonth = datetime_diff('day', startofmonth(datetime_add('month', 1, now())), monthStart);
let dailyBudget = monthlyBudget / daysInMonth;
Costs()
${fc}
| where ChargePeriodStart >= monthStart
| summarize DailyCost = sum(${cc}) by Day = startofday(ChargePeriodStart)
| order by Day asc
| extend CumulativeActual = row_cumsum(DailyCost)
| extend DayOfMonth = datetime_diff('day', Day, monthStart) + 1
| extend CumulativeBudget = round(dailyBudget * DayOfMonth, 2)
| project Day,
    DailyCost = round(DailyCost, 2),
    CumulativeActual = round(CumulativeActual, 2),
    CumulativeBudget
`;
}

export function budgetBySubscription(
  monthlyBudget: number,
  filters?: ParsedFilters,
): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";
  return `
let monthlyBudget = ${monthlyBudget}.0;
Costs()
${fc}
| where ChargePeriodStart >= startofmonth(now())
| summarize SubscriptionCost = sum(${cc}) by SubAccountName
| extend PercentOfBudget = round(SubscriptionCost / monthlyBudget * 100, 1)
| order by SubscriptionCost desc
| project SubAccountName,
    Cost = round(SubscriptionCost, 2),
    PercentOfBudget
`;
}

export function forecastVsBudget(
  monthlyBudget: number,
  filters?: ParsedFilters,
): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";
  return `
let monthlyBudget = ${monthlyBudget}.0;
let historyStart = ago(60d);
let forecastDays = 30;
let daysInMonth = datetime_diff('day', startofmonth(datetime_add('month', 1, now())), startofmonth(now()));
let dailyBudget = monthlyBudget / daysInMonth;
Costs()
${fc}
| where ChargePeriodStart >= historyStart
| summarize DailyCost = sum(${cc}) by Day = startofday(ChargePeriodStart)
| order by Day asc
| make-series CostSeries = sum(DailyCost) on Day from historyStart to now() + forecastDays * 1d step 1d
| extend (forecast, lo, hi) = series_decompose_forecast(CostSeries, forecastDays)
| mv-expand Day to typeof(datetime),
    CostSeries to typeof(real),
    forecast to typeof(real)
| where Day >= startofmonth(now())
| project Day,
    DailyCost = iff(Day <= now(), round(CostSeries, 2), real(null)),
    DailyForecast = iff(Day > now(), round(forecast, 2), real(null)),
    DailyBudgetTarget = round(dailyBudget, 2)
`;
}

export function forecastWithConfidence(filters?: ParsedFilters): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";
  return `
let historyStart = ago(90d);
let forecastDays = 30;
Costs()
${fc}
| where ChargePeriodStart >= historyStart
| summarize DailyCost = sum(${cc}) by Day = startofday(ChargePeriodStart)
| order by Day asc
| make-series CostSeries = sum(DailyCost) on Day from historyStart to now() + forecastDays * 1d step 1d
| extend (forecast, lo, hi) = series_decompose_forecast(CostSeries, forecastDays)
| mv-expand Day to typeof(datetime),
    CostSeries to typeof(real),
    forecast to typeof(real),
    lo to typeof(real),
    hi to typeof(real)
| where Day >= ago(14d)
| project Day,
    Actual = iff(Day <= now(), round(CostSeries, 2), real(null)),
    Forecast = round(forecast, 2),
    LowerBound = round(lo, 2),
    UpperBound = round(hi, 2)
`;
}
