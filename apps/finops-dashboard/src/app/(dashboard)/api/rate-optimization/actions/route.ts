export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { topOptimizationActions } from "@/lib/queries/rate-optimization";
import { mockOptimizationActions } from "@/lib/mock-data/rate-optimization";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateOptimizationActions } from "@/lib/customer-aggregations/rate-optimization";
import { filterSchema } from "@/lib/filter-schema";
import type { ApiResponse, OptimizationAction } from "@/lib/types";

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();
  const filters = filterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  if (isMockMode()) {
    const customer = customerDataResponse(request,
      filters,
      aggregateOptimizationActions,
    );
    if (customer) return customer;

    return NextResponse.json({
      data: mockOptimizationActions,
      metadata: { queriedAt: now, isMock: true },
    } satisfies ApiResponse<OptimizationAction[]>);
  }

  const result = await executeQuery(topOptimizationActions(filters));
  const data: OptimizationAction[] = result.rows.map((r) => ({
    action: String(r.Action ?? ""),
    category: String(r.Category ?? ""),
    potentialMonthlySavings: Number(r.PotentialMonthlySavings ?? 0),
  }));

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<OptimizationAction[]>);
}
