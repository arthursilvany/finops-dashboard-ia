export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { chargebackTrendKql } from "@/lib/queries/chargeback";
import { mockChargebackTrend } from "@/lib/mock-data/chargeback";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateChargebackTrend } from "@/lib/customer-aggregations/chargeback";
import { filterSchema } from "@/lib/filter-schema";
import type { ApiResponse, ChargebackTrendPoint } from "@/lib/types";

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();
  const filters = filterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  if (isMockMode()) {
    const customer = customerDataResponse(request, filters, aggregateChargebackTrend);
    if (customer) return customer;

    return NextResponse.json(mockChargebackTrend);
  }

  const result = await executeQuery(chargebackTrendKql(filters));

  const monthMap: Record<string, ChargebackTrendPoint> = {};
  for (const r of result.rows) {
    const month = String(r.Month ?? "");
    const bu    = String(r.BusinessUnit ?? "");
    const cost  = Number(r.Cost ?? 0);
    if (!monthMap[month]) monthMap[month] = { month };
    monthMap[month][bu] = cost;
  }

  const data: ChargebackTrendPoint[] = Object.values(monthMap);

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<ChargebackTrendPoint[]>);
}
