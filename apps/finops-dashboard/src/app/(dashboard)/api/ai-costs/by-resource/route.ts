export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { aiCostByResource } from "@/lib/queries/ai-costs";
import { mockAiCostByResource } from "@/lib/mock-data/ai-costs";
import { filterSchema } from "@/lib/filter-schema";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateAiCostByResource } from "@/lib/customer-aggregations/ai-costs";
import type { ApiResponse, AiCostByResource } from "@/lib/types";

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();
  const filters = filterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  if (isMockMode()) {
    const customer = customerDataResponse(request, filters, aggregateAiCostByResource);
    if (customer) return customer;

    return NextResponse.json(
      mockAiCostByResource satisfies ApiResponse<AiCostByResource[]>,
    );
  }

  const result = await executeQuery(aiCostByResource(filters));
  const data: AiCostByResource[] = result.rows.map((r) => ({
    resourceName: String(r.ResourceName ?? ""),
    resourceGroup: String(r.x_ResourceGroupName ?? ""),
    subscriptionName: String(r.SubAccountName ?? ""),
    cost: Number(r.Cost ?? 0),
    dailyAvg: Number(r.DailyAvg ?? 0),
    model: String(r.ResourceName ?? "").split("-")[0] ?? "",
  }));

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<AiCostByResource[]>);
}
