export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode } from "@/lib/adx-client";
import { mockCostSummaryKpi } from "@/lib/mock-data/cost-summary";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateCostSummaryKpi } from "@/lib/customer-aggregations/cost-summary";
import type { ApiResponse, CostSummaryKpi } from "@/lib/types";
import { executeQuery } from "@/lib/adx-client";
import { costSummaryKpiQuery } from "@/lib/queries/cost-summary";
import { filterSchema } from "@/lib/filter-schema";

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();

  const filters = filterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  if (isMockMode()) {
    const customer = customerDataResponse(request, filters, aggregateCostSummaryKpi);
    if (customer) return customer;

    const response: ApiResponse<CostSummaryKpi> = {
      data: mockCostSummaryKpi,
      metadata: { queriedAt: now, isMock: true },
    };
    return NextResponse.json(response);
  }

  const result = await executeQuery(costSummaryKpiQuery(filters));
  const row = result.rows[0] ?? {};

  const data: CostSummaryKpi = {
    totalCost30d: Number(row.TotalCost30d ?? 0),
    subscriptionCount: Number(row.SubscriptionCount ?? 0),
    resourceCount: Number(row.ResourceCount ?? 0),
    momChangePercent: Number(row.MomChangePercent ?? 0),
    momChangeDelta: Number(row.MomChangeDelta ?? 0),
    savingsIdentified: 0,
    savingsRecommendations: 0,
    savingsRealized: 0,
    savingsActions: 0,
  };

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<CostSummaryKpi>);
}
