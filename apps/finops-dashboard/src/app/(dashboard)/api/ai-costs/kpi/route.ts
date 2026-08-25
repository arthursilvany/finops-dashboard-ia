export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import {
  aiCostKpi,
  aiCostKpiPrevious,
  aiCostByModel,
} from "@/lib/queries/ai-costs";
import { mockAiCostKpi } from "@/lib/mock-data/ai-costs";
import { filterSchema } from "@/lib/filter-schema";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateAiCostKpi } from "@/lib/customer-aggregations/ai-costs";
import type { ApiResponse, AiCostKpi } from "@/lib/types";

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();
  const filters = filterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  if (isMockMode()) {
    const customer = customerDataResponse(request, filters, aggregateAiCostKpi);
    if (customer) return customer;

    return NextResponse.json(mockAiCostKpi satisfies ApiResponse<AiCostKpi>);
  }

  const [currentResult, previousResult, topModelResult] = await Promise.all([
    executeQuery(aiCostKpi(filters)),
    executeQuery(aiCostKpiPrevious(filters)),
    executeQuery(aiCostByModel(filters)),
  ]);

  const current = currentResult.rows[0] ?? {};
  const previous = previousResult.rows[0] ?? {};
  const topModel = topModelResult.rows[0] ?? {};

  const totalCost30d = Number(current.TotalCost ?? 0);
  const costPrevious30d = Number(previous.TotalCost ?? 0);
  const momChangePercent =
    costPrevious30d > 0
      ? Math.round(
          ((totalCost30d - costPrevious30d) / costPrevious30d) * 10000,
        ) / 100
      : 0;

  const data: AiCostKpi = {
    totalCost30d,
    costPrevious30d,
    momChangePercent,
    resourceCount: Number(current.ResourceCount ?? 0),
    avgCostPerResource: Number(current.AvgCostPerResource ?? 0),
    topModel: String(topModel.ResourceName ?? "N/A"),
    topModelCost: Number(topModel.Cost ?? 0),
  };

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<AiCostKpi>);
}
