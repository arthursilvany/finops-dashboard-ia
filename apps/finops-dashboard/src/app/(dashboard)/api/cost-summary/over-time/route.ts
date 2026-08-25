export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { costOverTime } from "@/lib/queries/cost-summary";
import { mockCostOverTime } from "@/lib/mock-data/cost-summary";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateCostOverTime } from "@/lib/customer-aggregations/cost-summary";
import { filterSchema } from "@/lib/filter-schema";
import type { ApiResponse, CostOverTimePoint } from "@/lib/types";

const schema = z
  .object({
    months: z.coerce.number().int().min(1).max(24).default(6),
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
      aggregateCostOverTime(ctx, params.data.months),
    );
    if (customer) return customer;

    const data = mockCostOverTime.slice(-params.data.months);
    return NextResponse.json({
      data,
      metadata: { queriedAt: now, isMock: true },
    } satisfies ApiResponse<CostOverTimePoint[]>);
  }

  const result = await executeQuery(
    costOverTime(params.data.months, params.data),
  );
  const data: CostOverTimePoint[] = result.rows.map((r) => ({
    month: String(r.Month ?? ""),
    cost: Number(r.MonthlyCost ?? 0),
  }));

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<CostOverTimePoint[]>);
}
