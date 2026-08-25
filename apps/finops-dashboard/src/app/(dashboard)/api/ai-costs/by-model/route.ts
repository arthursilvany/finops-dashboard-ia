export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { aiCostByModel } from "@/lib/queries/ai-costs";
import { mockAiCostByModel } from "@/lib/mock-data/ai-costs";
import { filterSchema } from "@/lib/filter-schema";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateAiCostByModel } from "@/lib/customer-aggregations/ai-costs";
import type { ApiResponse, AiCostByModel } from "@/lib/types";

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();
  const filters = filterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  if (isMockMode()) {
    const customer = customerDataResponse(request, filters, aggregateAiCostByModel);
    if (customer) return customer;

    return NextResponse.json(
      mockAiCostByModel satisfies ApiResponse<AiCostByModel[]>,
    );
  }

  const result = await executeQuery(aiCostByModel(filters));
  const totalCost = result.rows.reduce(
    (sum, r) => sum + Number(r.Cost ?? 0),
    0,
  );

  const data: AiCostByModel[] = result.rows.map((r) => ({
    resourceName: String(r.ResourceName ?? ""),
    cost: Number(r.Cost ?? 0),
    percentage:
      totalCost > 0
        ? Math.round((Number(r.Cost ?? 0) / totalCost) * 1000) / 10
        : 0,
  }));

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<AiCostByModel[]>);
}
