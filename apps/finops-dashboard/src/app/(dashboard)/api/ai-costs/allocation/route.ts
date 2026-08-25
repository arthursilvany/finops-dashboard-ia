export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { aiCostAllocation } from "@/lib/queries/ai-costs";
import { mockAiCostAllocation } from "@/lib/mock-data/ai-costs";
import { filterSchema } from "@/lib/filter-schema";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateAiCostAllocation } from "@/lib/customer-aggregations/ai-costs";
import type { ApiResponse, AiCostAllocation } from "@/lib/types";

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();
  const filters = filterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  if (isMockMode()) {
    const customer = customerDataResponse(request, filters, aggregateAiCostAllocation);
    if (customer) return customer;

    return NextResponse.json(
      mockAiCostAllocation satisfies ApiResponse<AiCostAllocation[]>,
    );
  }

  const result = await executeQuery(aiCostAllocation(filters));
  const totalCost = result.rows.reduce(
    (sum, r) => sum + Number(r.Cost ?? 0),
    0,
  );

  const data: AiCostAllocation[] = result.rows.map((r) => ({
    businessUnit: String(r.BU ?? "Untagged"),
    aiApp: String(r.AIApp ?? "Unknown"),
    aiModel: String(r.AIModel ?? "Unknown"),
    cost: Number(r.Cost ?? 0),
    percentage:
      totalCost > 0
        ? Math.round((Number(r.Cost ?? 0) / totalCost) * 1000) / 10
        : 0,
  }));

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<AiCostAllocation[]>);
}
