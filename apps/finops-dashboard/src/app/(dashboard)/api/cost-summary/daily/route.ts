export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { dailyCostTrend } from "@/lib/queries/cost-summary";
import { mockDailyCosts } from "@/lib/mock-data/cost-summary";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateDailyCost } from "@/lib/customer-aggregations/cost-summary";
import { filterSchema } from "@/lib/filter-schema";
import type { ApiResponse, DailyCostPoint } from "@/lib/types";

const schema = z
  .object({
    days: z.coerce.number().int().min(1).max(90).default(28),
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
      aggregateDailyCost(ctx, params.data.days),
    );
    if (customer) return customer;

    return NextResponse.json({
      data: mockDailyCosts.slice(-params.data.days),
      metadata: { queriedAt: now, isMock: true },
    } satisfies ApiResponse<DailyCostPoint[]>);
  }

  const result = await executeQuery(
    dailyCostTrend(params.data.days, params.data),
  );
  const data: DailyCostPoint[] = result.rows.map((r) => ({
    day: String(r.Day ?? ""),
    cost: Number(r.DailyCost ?? 0),
  }));

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<DailyCostPoint[]>);
}
