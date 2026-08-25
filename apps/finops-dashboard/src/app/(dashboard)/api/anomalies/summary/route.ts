export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { anomalySummary } from "@/lib/queries/anomalies";
import { mockAnomalySummary } from "@/lib/mock-data/anomalies";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateAnomalySummary } from "@/lib/customer-aggregations/anomalies";
import { filterSchema } from "@/lib/filter-schema";
import type { ApiResponse, AnomalySummary } from "@/lib/types";

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();
  const filters = filterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  if (isMockMode()) {
    const customer = customerDataResponse(request, filters, aggregateAnomalySummary);
    if (customer) return customer;

    return NextResponse.json({
      data: mockAnomalySummary,
      metadata: { queriedAt: now, isMock: true },
    } satisfies ApiResponse<AnomalySummary>);
  }

  const result = await executeQuery(anomalySummary(filters));
  const row = result.rows[0] ?? {};

  const data: AnomalySummary = {
    anomalies7d: Number(row.Anomalies7d ?? 0),
    anomalies30d: Number(row.Anomalies30d ?? 0),
    largestDeviation: Number(row.LargestDeviation ?? 0),
    lastAnomalyDate: String(row.LastAnomalyDate ?? ""),
  };

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<AnomalySummary>);
}
