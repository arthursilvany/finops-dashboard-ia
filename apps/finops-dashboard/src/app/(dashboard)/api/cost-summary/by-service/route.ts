export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { costByService } from "@/lib/queries/cost-summary";
import { mockServiceBreakdown } from "@/lib/mock-data/cost-summary";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateCostByService } from "@/lib/customer-aggregations/cost-summary";
import { filterSchema } from "@/lib/filter-schema";
import type { ApiResponse, ServiceBreakdown } from "@/lib/types";

const schema = z
  .object({
    top: z.coerce.number().int().min(1).max(50).default(8),
  })
  .merge(filterSchema);

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();
  const params = schema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!params.success) {
    return NextResponse.json(
      { error: params.error.flatten() },
      { status: 400 },
    );
  }

  if (isMockMode()) {
    const customer = customerDataResponse(request, params.data, (ctx) =>
      aggregateCostByService(ctx, params.data.top),
    );
    if (customer) return customer;

    return NextResponse.json({
      data: mockServiceBreakdown.slice(0, params.data.top),
      metadata: { queriedAt: now, isMock: true },
    } satisfies ApiResponse<ServiceBreakdown[]>);
  }

  const result = await executeQuery(
    costByService(params.data.top, params.data),
  );
  const data: ServiceBreakdown[] = result.rows.map((r) => ({
    service: String(r.ServiceName ?? "Unknown"),
    cost: Number(r.ServiceCost ?? 0),
    percentage: Number(r.Percentage ?? 0),
  }));

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<ServiceBreakdown[]>);
}
