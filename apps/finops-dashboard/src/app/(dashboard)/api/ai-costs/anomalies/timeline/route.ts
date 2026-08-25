export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { aiAnomalyTimeline } from "@/lib/queries/ai-costs";
import { mockAiAnomalyTimeline } from "@/lib/mock-data/ai-costs";
import { filterSchema } from "@/lib/filter-schema";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateAiAnomalyTimeline } from "@/lib/customer-aggregations/ai-costs";
import type { ApiResponse, AiAnomalyTimelinePoint } from "@/lib/types";

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();
  const filters = filterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  if (isMockMode()) {
    const customer = customerDataResponse(request, filters, aggregateAiAnomalyTimeline);
    if (customer) return customer;

    return NextResponse.json(
      mockAiAnomalyTimeline satisfies ApiResponse<AiAnomalyTimelinePoint[]>,
    );
  }

  const result = await executeQuery(aiAnomalyTimeline(filters));
  const data: AiAnomalyTimelinePoint[] = result.rows.map((r) => ({
    day: String(r.Day ?? ""),
    actualCost: Number(r.ActualCost ?? 0),
    baseline: Number(r.Baseline ?? 0),
    anomalyFlag: Number(r.AnomalyFlag ?? 0),
  }));

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<AiAnomalyTimelinePoint[]>);
}
