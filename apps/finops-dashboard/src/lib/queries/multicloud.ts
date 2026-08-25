// Multicloud comparison KQL — FinOps Hub FOCUS schema

import type { ParsedFilters } from "../filter-schema";
import { buildFilterClauses, costColumn } from "./filter-builder";

/**
 * Aggregates the estate down to the smallest grain the comparison needs, and
 * stops there.
 *
 * The archetype classification deliberately does *not* happen in KQL. It is
 * the most contestable logic in the feature, and expressing it here as well as
 * in `taxonomy.ts` would create two implementations free to drift apart — the
 * ADX path and the customer POC path would then quietly answer the same
 * question differently. So this query emits the raw FOCUS dimensions and
 * `classifyRow` does the judgement once, in TypeScript, for both paths.
 *
 * Grouping by the dimensions rather than returning raw rows keeps the payload
 * bounded: an estate of millions of rows collapses to a few thousand groups.
 *
 * `ConsumedQuantity` is summed alongside cost because a rate is cost ÷
 * quantity; without the denominator no cross-provider comparison is possible.
 */
export function multicloudObservations(filters?: ParsedFilters): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";

  // The baseline must be denominated the same way as the cost it is compared
  // against, or "% off list" becomes an FX ratio — and because the result is
  // clamped to 0-1 it would render as a plausible discount rather than as an
  // obvious error.
  const usd = cc.endsWith("InUsd");
  const listCol = usd ? "x_ListCostInUsd" : "ListCost";
  const contractedCol = usd ? "x_ContractedCostInUsd" : "ContractedCost";

  // Optional in some FinOps Hub deployments. `summarize by` a column that does
  // not exist is a semantic error, so the whole comparison would 500 rather
  // than degrade — the same defence `cost-summary.ts` already applies.
  const serviceCategory = "column_ifexists('ServiceCategory', '')";
  const meterSub = "column_ifexists('x_SkuMeterSubcategory', '')";
  const resourceType = "column_ifexists('x_ResourceType', column_ifexists('ResourceType', ''))";

  return `
Costs()
${fc}
| where ChargeCategory == 'Usage'
| extend _Month = startofmonth(ChargePeriodStart)
| summarize
    Cost = sum(${cc}),
    Quantity = sum(ConsumedQuantity),
    ListTotal = sum(column_ifexists('${listCol}', real(0))),
    ContractedTotal = sum(column_ifexists('${contractedCol}', real(0))),
    RowCount = count(),
    PeriodStart = min(ChargePeriodStart),
    PeriodEnd = max(ChargePeriodEnd)
  by
    _Month,
    ProviderName,
    ServiceName,
    ServiceCategory = ${serviceCategory},
    x_SkuMeterCategory,
    x_SkuMeterSubcategory = ${meterSub},
    ResourceType = ${resourceType},
    PricingCategory,
    PricingUnit,
    x_SkuTerm
| where Cost > 0
| project-away _Month
`;
}

/**
 * Observed period per provider, before any clipping.
 *
 * Read separately from the observation query because the comparison window is
 * decided by when each provider has *any* data, not only data that survived
 * archetype classification. Deriving the span from the classified rows alone
 * would let a provider look like it started reporting later than it did.
 */
export function providerSpans(filters?: ParsedFilters): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  return `
Costs()
${fc}
| summarize
    PeriodStart = min(ChargePeriodStart),
    PeriodEnd = max(ChargePeriodEnd),
    RowCount = count()
  by ProviderName
| order by RowCount desc
`;
}

/** Distinct billing currencies present, so the report can label its numbers. */
export function billingCurrencies(filters?: ParsedFilters): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  return `
Costs()
${fc}
| summarize Total = count() by BillingCurrency
| order by Total desc
| project BillingCurrency
`;
}
