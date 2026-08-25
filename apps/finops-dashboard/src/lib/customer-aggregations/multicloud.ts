/**
 * Customer POC path for the multicloud comparison.
 *
 * Reads the ingested Cost Export rows and hands them to the same
 * `buildMulticloudFacts` the ADX path uses. Only the row-shaping differs; not
 * one line of comparison logic is duplicated here, so the pre-sales POC and
 * the production Hub cannot disagree about what a rate is.
 */

import { baselineCost } from "../customer-data/contract";
import type { CloudProvider, CustomerCostRow } from "../customer-data/contract";
import { buildMulticloudFacts } from "../multicloud/facts";
import type { ComparableRow } from "../multicloud/facts";
import type { MulticloudFacts, ScoreWeights } from "../multicloud/types";
import type { AggregationContext } from "./context";

function toComparableRow(
  row: CustomerCostRow,
  cost: (r: CustomerCostRow) => number,
): ComparableRow {
  return {
    providerName: row.providerName,
    serviceName: row.serviceName,
    serviceCategory: row.serviceCategory,
    skuMeterCategory: row.skuMeterCategory,
    skuMeterSubcategory: row.skuMeterSubcategory,
    resourceType: row.resourceType,
    chargePeriodStart: row.chargePeriodStart,
    chargePeriodEnd: row.chargePeriodEnd,
    chargeCategory: row.chargeCategory,
    pricingCategory: row.pricingCategory,
    pricingUnit: row.pricingUnit,
    consumedQuantity: row.consumedQuantity,
    cost: cost(row),
    baselineCost: row.hasBaseline ? baselineCost(row) : 0,
    skuTerm: row.skuTerm,
  };
}

/**
 * Builds the comparison from the customer's own export.
 *
 * `providersPresent` is taken from the filtered rows, so a provider the user
 * has filtered out is reported as absent rather than silently compared on a
 * partial slice.
 */
export function aggregateMulticloudComparison(
  ctx: AggregationContext,
  weights?: Partial<ScoreWeights>,
): MulticloudFacts {
  const rows = ctx.rows.map((row) => toComparableRow(row, ctx.cost));

  const present = new Set<CloudProvider>();
  for (const row of ctx.rows) present.add(row.providerName);

  const currency =
    ctx.filters.currency === "usd"
      ? "USD"
      : ctx.rows[0]?.billingCurrency || "USD";

  return buildMulticloudFacts({
    rows,
    currency,
    weights,
    providersPresent: Array.from(present),
  });
}
