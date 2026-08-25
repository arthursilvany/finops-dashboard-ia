/**
 * Entry point for the multicloud comparison.
 *
 * Resolves the facts once, for every surface. The matrix, the Markdown export
 * and the AI narrative must be able to disagree about presentation but never
 * about the numbers, and the only reliable way to guarantee that is for them
 * to share one code path to the arithmetic rather than three that look alike.
 */

import { z } from "zod";

import { isMockMode, executeQuery } from "../adx-client";
import { getAggregationContext } from "../customer-aggregations/context";
import { aggregateMulticloudComparison } from "../customer-aggregations/multicloud";
import { normalizeProvider } from "../customer-data/contract";
import type { CloudProvider } from "../customer-data/contract";
import type { ParsedFilters } from "../filter-schema";
import { filterSchema } from "../filter-schema";
import { mockMulticloudProviders, mockMulticloudRows } from "../mock-data/multicloud";
import { multicloudObservations, providerSpans } from "../queries/multicloud";
import type { ApiResponse } from "../types";
import { buildMulticloudFacts, type ComparableRow } from "./facts";
import type { MulticloudFacts, ScoreWeights } from "./types";

export type MulticloudMetadata = ApiResponse<MulticloudFacts>["metadata"];

export interface MulticloudPayload {
  facts: MulticloudFacts;
  metadata: MulticloudMetadata;
}

/**
 * Score weights arrive from the UI sliders.
 *
 * Coerced and clamped rather than rejected: a weight is a preference, not a
 * command, and failing the whole comparison because a slider serialized oddly
 * would be a poor trade. `normalizeWeights` in `score.ts` rescales whatever
 * survives.
 */
const weightSchema = z
  .string()
  .optional()
  .transform((v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  });

export const multicloudRequestSchema = filterSchema.extend({
  wPrice: weightSchema,
  wPerformance: weightSchema,
  wSla: weightSchema,
  wEgress: weightSchema,
});

/** Pulls the weight overrides out of a parsed request, omitting absent ones. */
export function weightsFrom(
  parsed: z.infer<typeof multicloudRequestSchema>,
): Partial<ScoreWeights> {
  const weights: Partial<ScoreWeights> = {};
  if (parsed.wPrice !== undefined) weights.price = parsed.wPrice;
  if (parsed.wPerformance !== undefined) weights.performance = parsed.wPerformance;
  if (parsed.wSla !== undefined) weights.sla = parsed.wSla;
  if (parsed.wEgress !== undefined) weights.egress = parsed.wEgress;
  return weights;
}

/**
 * One aggregated ADX group becomes one comparable row.
 *
 * `ProviderName` is normalized here for the same reason the by-provider route
 * does it: a hub fed by several connectors carries more than one spelling of
 * the same cloud, and unnormalized they would compare against each other as if
 * they were rival vendors.
 */
export function toComparableRow(row: Record<string, unknown>): ComparableRow {
  const str = (key: string) => String(row[key] ?? "");
  const num = (key: string) => Number(row[key] ?? 0);

  const listTotal = num("ListTotal");
  const contractedTotal = num("ContractedTotal");

  return {
    providerName: normalizeProvider(str("ProviderName"), "Other"),
    serviceName: str("ServiceName"),
    serviceCategory: str("ServiceCategory"),
    skuMeterCategory: str("x_SkuMeterCategory"),
    skuMeterSubcategory: str("x_SkuMeterSubcategory"),
    resourceType: str("ResourceType"),
    chargePeriodStart: str("PeriodStart").slice(0, 10),
    chargePeriodEnd: str("PeriodEnd").slice(0, 10),
    chargeCategory: "Usage",
    pricingCategory: str("PricingCategory") || "Standard",
    pricingUnit: str("PricingUnit"),
    consumedQuantity: num("Quantity"),
    cost: num("Cost"),
    // Same cascade as `baselineCost()`: list price when populated, otherwise
    // the contracted price, which is where Azure puts the on-demand equivalent
    // on commitment-covered lines.
    baselineCost: listTotal > 0 ? listTotal : contractedTotal,
    skuTerm: str("x_SkuTerm"),
  };
}

/**
 * Builds the comparison from whichever data source is configured.
 *
 * The cascade is the repo's standard one — customer POC first, then mock, then
 * ADX — so this view behaves identically to every other page when a customer
 * dataset is mounted.
 */
export async function buildMulticloudComparisonPayload(
  filters: ParsedFilters,
  weights: Partial<ScoreWeights>,
  customerSlug?: string | null,
): Promise<MulticloudPayload> {
  const queriedAt = new Date().toISOString();

  if (isMockMode()) {
    const ctx = getAggregationContext(filters, customerSlug);
    if (ctx) {
      return {
        facts: aggregateMulticloudComparison(ctx, weights),
        metadata: {
          queriedAt,
          // Not a mock: these are the customer's real invoiced costs.
          isMock: false,
          dataSource: "customer",
          customerName: ctx.manifest.customer,
        },
      };
    }

    // The demo rows run through the real pipeline, so this path exercises
    // classification, unit normalization and scoring rather than replaying a
    // pre-baked answer.
    return {
      facts: buildMulticloudFacts({
        rows: mockMulticloudRows,
        currency: "USD",
        weights,
        providersPresent: mockMulticloudProviders,
      }),
      metadata: { queriedAt, isMock: true, dataSource: "mock" },
    };
  }

  const [observations, spans_] = await Promise.all([
    executeQuery(multicloudObservations(filters)),
    executeQuery(providerSpans(filters)),
  ]);

  const rows = observations.rows.map(toComparableRow);

  // Taken from the span query rather than from the classified rows: a provider
  // that bills only workloads outside the taxonomy is still present in the
  // estate, and reporting it as absent would misdescribe the dataset.
  const present: CloudProvider[] = [];
  const spans: Array<{ provider: CloudProvider; from: string; toExclusive: string }> = [];

  for (const row of spans_.rows) {
    const provider = normalizeProvider(String(row.ProviderName ?? ""), "Other");
    if (!present.includes(provider)) present.push(provider);

    const from = String(row.PeriodStart ?? "").slice(0, 10);
    const toExclusive = String(row.PeriodEnd ?? "").slice(0, 10);
    if (!from || !toExclusive || toExclusive <= from) continue;

    // One row per provider is expected, but a provider spelled two ways
    // collapses here rather than producing two rival spans.
    const existing = spans.find((s) => s.provider === provider);
    if (!existing) {
      spans.push({ provider, from, toExclusive });
      continue;
    }
    if (from < existing.from) existing.from = from;
    if (toExclusive > existing.toExclusive) existing.toExclusive = toExclusive;
  }

  return {
    facts: buildMulticloudFacts({
      rows,
      currency: filters.currency === "usd" ? "USD" : "Billing currency",
      weights,
      providersPresent: present,
      spans,
    }),
    metadata: { queriedAt, isMock: false, dataSource: "adx" },
  };
}
