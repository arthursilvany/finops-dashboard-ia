import type { ParsedFilters } from "@/lib/filter-schema";
import { buildFilterClauses, costColumn } from "@/lib/queries/filter-builder";

// Chargeback KPI — total allocated, untagged, business unit count
export function chargebackKpiKql(filters: ParsedFilters): string {
  const where = buildFilterClauses(filters);
  const cost = costColumn(filters.currency);
  return `
Costs()
| ${where ? `where ${where}` : "where true"}
| extend bu = tostring(todynamic(Tags)['cost-center'])
| summarize
    TotalAllocated = sum(iff(isnotempty(bu), todouble(${cost}), 0.0)),
    UntaggedCost   = sum(iff(isempty(bu),   todouble(${cost}), 0.0)),
    BusinessUnits  = dcount(bu)
`.trim();
}

// Cost by business unit (cost-center tag)
export function chargebackByBuKql(filters: ParsedFilters): string {
  const where = buildFilterClauses(filters);
  const cost = costColumn(filters.currency);
  return `
Costs()
| ${where ? `where ${where}` : "where true"}
| extend bu = tostring(todynamic(Tags)['cost-center'])
| where isnotempty(bu)
| summarize Cost = sum(todouble(${cost})) by BusinessUnit = bu
| extend TotalCost = toscalar(Costs() | summarize sum(todouble(${cost})))
| extend Percentage = round(100.0 * Cost / TotalCost, 1)
| order by Cost desc
`.trim();
}

// Monthly chargeback trend by BU (last 4 months)
export function chargebackTrendKql(filters: ParsedFilters): string {
  const where = buildFilterClauses(filters);
  const cost = costColumn(filters.currency);
  return `
Costs()
| ${where ? `where ${where}` : "where true"}
| extend bu = tostring(todynamic(Tags)['cost-center'])
| where isnotempty(bu)
| extend Month = format_datetime(ChargePeriodStart, 'MMM/yy')
| summarize Cost = sum(todouble(${cost})) by Month, BusinessUnit = bu
| order by Month asc, Cost desc
`.trim();
}

export { buildFilterClauses, costColumn };
