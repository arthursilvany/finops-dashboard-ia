export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { effectiveSavingsRateSummary } from "@/lib/queries/rate-optimization";
import { mockEffectiveSavingsRateSummary } from "@/lib/mock-data/rate-optimization";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateEsrSummary } from "@/lib/customer-aggregations/rate-optimization";
import { filterSchema } from "@/lib/filter-schema";
import type { ApiResponse, EffectiveSavingsRateSummary } from "@/lib/types";

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();
  const filters = filterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  if (isMockMode()) {
    const customer = customerDataResponse(request, filters, aggregateEsrSummary);
    if (customer) return customer;

    return NextResponse.json({
      data: mockEffectiveSavingsRateSummary,
      metadata: { queriedAt: now, isMock: true },
    } satisfies ApiResponse<EffectiveSavingsRateSummary>);
  }

  const result = await executeQuery(effectiveSavingsRateSummary(filters));
  const row = result.rows[0] ?? {};

  const data: EffectiveSavingsRateSummary = {
    totalSavings: Number(row.TotalSavings ?? 0),
    listCost: Number(row.ListCost ?? 0),
    effectiveCost: Number(row.EffectiveCost ?? 0),
    effectiveSavingsRate: Number(row.EffectiveSavingsRate ?? 0),
    // The ADX query does not break out unused commitment spend, so report it
    // as unknown rather than as zero waste.
    unusedCommitmentCost: null,
  };

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<EffectiveSavingsRateSummary>);
}
