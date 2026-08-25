export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { kpiSummaryQuery } from "@/lib/queries/cost-summary";
import { mockKpiSummary } from "@/lib/mock-data/cost-summary";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateKpiSummary } from "@/lib/customer-aggregations/cost-summary";
import { filterSchema } from "@/lib/filter-schema";
import type { ApiResponse, KpiSummary } from "@/lib/types";

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();
  const filters = filterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  if (isMockMode()) {
    const customer = customerDataResponse(request, filters, aggregateKpiSummary);
    if (customer) return customer;

    const response: ApiResponse<KpiSummary> = {
      data: mockKpiSummary,
      metadata: { queriedAt: now, isMock: true },
    };
    return NextResponse.json(response);
  }

  const result = await executeQuery(kpiSummaryQuery(filters));
  const row = result.rows[0] ?? {};

  const costLast = Number(row.CostLastMonth ?? 0);
  const costPrev = Number(row.CostPreviousMonth ?? 0);

  const data: KpiSummary = {
    costLastMonth: costLast,
    costPreviousMonth: costPrev,
    changePercent: costPrev > 0 ? ((costLast - costPrev) / costPrev) * 100 : 0,
    dailyAverage: Number(row.DailyAverage ?? 0),
    topService: String(row.TopService ?? "N/A"),
    topServiceCost: Number(row.TopServiceCost ?? 0),
  };

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<KpiSummary>);
}
