import { NextResponse, type NextRequest } from "next/server";

import type { ApiResponse } from "./types";
import type { SkuAdvisorParams } from "./sku-advisor-client";
import type { SkuAdvisorPayload } from "./sku-advisor-contract";
import { resolveSkuAdvisorPayload } from "./sku-advisor-source";
import { customerSlugFromCookieHeader } from "./customer-data/workspace";

/**
 * Shared plumbing for the `/api/sku-advisor/*` routes.
 *
 * Every route resolves the same payload and differs only in which selector it
 * applies, so source resolution, provenance metadata and the request-parameter
 * allowlist live in one place.
 */

/** Query parameters the browser may pass through to the advisor. */
const ALLOWED_QUERY_PARAMS = [
  "region",
  "currency",
  "threshold",
  "subscription",
  "cross_arch",
  "cross_family",
  "hybrid_benefit",
  "os_type",
] as const;

export function readAdvisorParams(request: NextRequest): SkuAdvisorParams {
  const params: SkuAdvisorParams = {};
  for (const key of ALLOWED_QUERY_PARAMS) {
    const values = request.nextUrl.searchParams.getAll(key);
    if (values.length > 0) params[key] = values;
  }
  return params;
}

export async function skuAdvisorResponse<T>(
  request: NextRequest,
  select: (payload: SkuAdvisorPayload) => T,
): Promise<NextResponse> {
  const resolution = await resolveSkuAdvisorPayload(
    readAdvisorParams(request),
    customerSlugFromCookieHeader(request.headers.get("cookie")),
  );

  const body: ApiResponse<T> = {
    data: select(resolution.payload),
    metadata: {
      queriedAt: new Date().toISOString(),
      isMock: resolution.source === "mock",
      dataSource: resolution.source === "customer" ? "customer" : undefined,
      customerName: resolution.customerName,
      skuAdvisorSource: resolution.source,
      skuAdvisorInventory: resolution.inventory,
      skuAdvisorTelemetry: resolution.telemetry,
      generatedAt: resolution.generatedAt,
    },
  };

  return NextResponse.json(body);
}
