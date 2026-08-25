export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { aiAnomalyTopResources } from "@/lib/queries/ai-costs";
import { mockAiAnomalyTopResources } from "@/lib/mock-data/ai-costs";
import { filterSchema } from "@/lib/filter-schema";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateAiAnomalyTopResources } from "@/lib/customer-aggregations/ai-costs";
import type { ApiResponse, AiAnomalyResource } from "@/lib/types";

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();
  const filters = filterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  if (isMockMode()) {
    const customer = customerDataResponse(request,
      filters,
      aggregateAiAnomalyTopResources,
    );
    if (customer) return customer;

    return NextResponse.json(
      mockAiAnomalyTopResources satisfies ApiResponse<AiAnomalyResource[]>,
    );
  }

  const result = await executeQuery(aiAnomalyTopResources(filters));
  const data: AiAnomalyResource[] = result.rows.map((r) => ({
    resourceName: String(r.ResourceName ?? ""),
    consumedService: String(r.ServiceName ?? ""),
    dayCost: Number(r.DayCost ?? 0),
    baselineCost: Number(r.BaselineCost ?? 0),
    deviationPercent: Number(r.DeviationPercent ?? 0),
  }));

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<AiAnomalyResource[]>);
}
