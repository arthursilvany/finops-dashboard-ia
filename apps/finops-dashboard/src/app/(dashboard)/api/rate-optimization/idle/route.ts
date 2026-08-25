export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { idleResources } from "@/lib/queries/rate-optimization";
import { mockIdleResources } from "@/lib/mock-data/rate-optimization";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateIdleResources } from "@/lib/customer-aggregations/rate-optimization";
import { filterSchema } from "@/lib/filter-schema";
import type { ApiResponse, IdleResource } from "@/lib/types";

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();
  const filters = filterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  if (isMockMode()) {
    const customer = customerDataResponse(request, filters, aggregateIdleResources);
    if (customer) return customer;

    return NextResponse.json({
      data: mockIdleResources,
      metadata: { queriedAt: now, isMock: true },
    } satisfies ApiResponse<IdleResource[]>);
  }

  const result = await executeQuery(idleResources(filters));
  const data: IdleResource[] = result.rows.map((r) => ({
    resourceName: String(r.ResourceName ?? ""),
    consumedService: String(r.ServiceName ?? ""),
    subscriptionName: String(r.SubAccountName ?? ""),
    monthlyCost: Number(r.MonthlyCost ?? 0),
    avgDailyCost: Number(r.AvgDailyCost ?? 0),
    daysActive: Number(r.DaysActive ?? 0),
  }));

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<IdleResource[]>);
}
