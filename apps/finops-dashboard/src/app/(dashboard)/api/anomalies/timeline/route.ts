export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { anomalyTimeline } from "@/lib/queries/anomalies";
import { mockAnomalyTimeline } from "@/lib/mock-data/anomalies";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateAnomalyTimeline } from "@/lib/customer-aggregations/anomalies";
import { filterSchema } from "@/lib/filter-schema";
import type { ApiResponse, AnomalyPoint } from "@/lib/types";

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();
  const filters = filterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  if (isMockMode()) {
    const customer = customerDataResponse(request, filters, aggregateAnomalyTimeline);
    if (customer) return customer;

    return NextResponse.json({
      data: mockAnomalyTimeline,
      metadata: { queriedAt: now, isMock: true },
    } satisfies ApiResponse<AnomalyPoint[]>);
  }

  const result = await executeQuery(anomalyTimeline(filters));
  const data: AnomalyPoint[] = result.rows.map((r) => ({
    day: String(r.Day ?? ""),
    actualCost: Number(r.ActualCost ?? 0),
    baseline: Number(r.Baseline ?? 0),
    anomalyFlag: Number(r.AnomalyFlag ?? 0),
    anomalyScore: Number(r.AnomalyScore ?? 0),
  }));

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<AnomalyPoint[]>);
}
