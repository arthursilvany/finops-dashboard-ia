export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode } from "@/lib/adx-client";
import { mockServiceTrend } from "@/lib/mock-data/cost-summary";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateServiceTrend } from "@/lib/customer-aggregations/cost-summary";
import type { ApiResponse, ServiceTrendItem } from "@/lib/types";
import { executeQuery } from "@/lib/adx-client";
import { serviceTrendQuery } from "@/lib/queries/cost-summary";
import { filterSchema } from "@/lib/filter-schema";

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();

  const filters = filterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  if (isMockMode()) {
    const customer = customerDataResponse(request, filters, aggregateServiceTrend);
    if (customer) return customer;

    const response: ApiResponse<ServiceTrendItem[]> = {
      data: mockServiceTrend,
      metadata: { queriedAt: now, isMock: true },
    };
    return NextResponse.json(response);
  }

  const result = await executeQuery(serviceTrendQuery(filters));
  const data: ServiceTrendItem[] = result.rows.map((r) => ({
    service: String(r.service ?? "Unknown"),
    cost: Number(r.cost ?? 0),
    momPercent: Number(r.momPercent ?? 0),
  }));

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<ServiceTrendItem[]>);
}
