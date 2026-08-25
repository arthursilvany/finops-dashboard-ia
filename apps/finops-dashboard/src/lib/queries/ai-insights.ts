// AI Insights cost forecast KQL — daily series_decompose_forecast aggregated to monthly

export function costForecastKql(): string {
  return `
let historyStart = startofmonth(datetime_add('month', -6, now()));
let forecastDays = 60;
Costs()
| where ChargePeriodStart >= historyStart
| summarize DailyCost = sum(EffectiveCost) by Day = startofday(ChargePeriodStart)
| make-series CostSeries = sum(DailyCost) on Day from historyStart to datetime_add('day', forecastDays, now()) step 1d
| extend (forecast, lo, hi) = series_decompose_forecast(CostSeries, forecastDays)
| mv-expand Day to typeof(datetime),
    CostSeries to typeof(real),
    forecast to typeof(real),
    lo to typeof(real),
    hi to typeof(real)
| extend Month = startofmonth(Day),
    IsActual = Day <= now()
| summarize
    Actual    = iff(max_of(sumif(CostSeries, IsActual), 0) > 0, round(sumif(CostSeries, IsActual), 0), real(null)),
    Forecast  = round(sum(forecast), 0),
    LowerBound = round(sum(lo), 0),
    UpperBound = round(sum(hi), 0)
    by Month
| order by Month asc
`;
}
