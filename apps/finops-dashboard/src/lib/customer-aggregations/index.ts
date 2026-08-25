import { NextResponse } from "next/server";

import type { ApiResponse } from "../types";
import type { ParsedFilters } from "../filter-schema";
import type { AggregationContext } from "./context";
import { AZURE_ONLY_PROVIDER } from "../customer-data/contract";
import { customerSlugFromCookieHeader } from "../customer-data/workspace";
import { getAggregationContext } from "./context";

export { getAggregationContext } from "./context";
export type { AggregationContext } from "./context";

/**
 * Returns a response built from the customer's Cost Export, or null when no
 * dataset is loaded so the caller can fall back to the static demo data.
 *
 * This is the "customer POC" tier of the data-source precedence chain:
 * ADX (production) > customer dataset (pre-sales) > static mock (demo).
 * It is only reached from inside a route's `isMockMode()` branch, so enabling
 * ADX always wins and production behaviour is unchanged.
 */
export function customerDataResponse<T>(
  request: Pick<Request, "headers">,
  filters: ParsedFilters,
  aggregate: (ctx: AggregationContext) => T,
): NextResponse | null;
export function customerDataResponse<T>(
  filters: ParsedFilters,
  aggregate: (ctx: AggregationContext) => T,
): NextResponse | null;
export function customerDataResponse<T>(
  requestOrFilters: Pick<Request, "headers"> | ParsedFilters,
  filtersOrAggregate: ParsedFilters | ((ctx: AggregationContext) => T),
  maybeAggregate?: (ctx: AggregationContext) => T,
): NextResponse | null {
  const request =
    "headers" in requestOrFilters ? requestOrFilters : undefined;
  const filters = request
    ? (filtersOrAggregate as ParsedFilters)
    : (requestOrFilters as ParsedFilters);
  const aggregate = request
    ? maybeAggregate!
    : (filtersOrAggregate as (ctx: AggregationContext) => T);
  const ctx = getAggregationContext(
    filters,
    request
      ? customerSlugFromCookieHeader(request.headers.get("cookie"))
      : undefined,
  );
  if (!ctx) return null;

  const body: ApiResponse<T> = {
    data: aggregate(ctx),
    // Not a mock: these are the customer's real invoiced costs.
    metadata: {
      queriedAt: new Date().toISOString(),
      isMock: false,
      dataSource: "customer",
      customerName: ctx.manifest.customer,
    },
  };

  return NextResponse.json(body);
}

/**
 * Same as `customerDataResponse`, but restricted to the Azure rows.
 *
 * Pages listed in `AZURE_ONLY_PAGES` are built on Azure-specific concepts —
 * ARM resource ids, Advisor, Resource Graph, the Retail Prices sheet — and
 * `DataSourceBanner` tells the viewer, in writing, that they cover the Azure
 * rows only. That promise has to be kept by the data layer, not just the
 * copy: an AWS Savings Plan satisfies the generic FOCUS commitment predicate
 * (`ChargeCategory = Usage`, `PricingCategory = Committed`) exactly as an
 * Azure reservation does, so without this the reservation page silently sums
 * both clouds while captioning the total "Azure only" — the precise inversion
 * the banner exists to prevent.
 *
 * The restriction is applied by pinning the ordinary `providers` filter, so
 * there is one filtering implementation rather than a parallel one, and it
 * intentionally *overrides* any user-supplied provider selection: on these
 * pages no other provider can be represented honestly.
 */
export function azureOnlyDataResponse<T>(
  request: Pick<Request, "headers">,
  filters: ParsedFilters,
  aggregate: (ctx: AggregationContext) => T,
): NextResponse | null;
export function azureOnlyDataResponse<T>(
  filters: ParsedFilters,
  aggregate: (ctx: AggregationContext) => T,
): NextResponse | null;
export function azureOnlyDataResponse<T>(
  requestOrFilters: Pick<Request, "headers"> | ParsedFilters,
  filtersOrAggregate: ParsedFilters | ((ctx: AggregationContext) => T),
  maybeAggregate?: (ctx: AggregationContext) => T,
): NextResponse | null {
  const request =
    "headers" in requestOrFilters ? requestOrFilters : undefined;
  const filters = request
    ? (filtersOrAggregate as ParsedFilters)
    : (requestOrFilters as ParsedFilters);
  const aggregate = request
    ? maybeAggregate!
    : (filtersOrAggregate as (ctx: AggregationContext) => T);
  const azureFilters = { ...filters, providers: [AZURE_ONLY_PROVIDER] };
  return request
    ? customerDataResponse(request, azureFilters, aggregate)
    : customerDataResponse(
        azureFilters,
        aggregate,
      );
}
