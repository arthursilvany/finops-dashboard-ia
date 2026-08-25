export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { aiCostDaily } from "@/lib/queries/ai-costs";
import { mockAiCostDaily } from "@/lib/mock-data/ai-costs";
import { filterSchema } from "@/lib/filter-schema";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateAiCostDaily } from "@/lib/customer-aggregations/ai-costs";
import type { ApiResponse, AiCostDailyPoint } from "@/lib/types";

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();
  const filters = filterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  if (isMockMode()) {
    const customer = customerDataResponse(request, filters, aggregateAiCostDaily);
    if (customer) return customer;

    return NextResponse.json(
      mockAiCostDaily satisfies ApiResponse<AiCostDailyPoint[]>,
    );
  }

  const result = await executeQuery(aiCostDaily(filters));
  const data: AiCostDailyPoint[] = result.rows.map((r) => ({
    day: String(r.Day ?? ""),
    cost: Number(r.Cost ?? 0),
  }));

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<AiCostDailyPoint[]>);
}
