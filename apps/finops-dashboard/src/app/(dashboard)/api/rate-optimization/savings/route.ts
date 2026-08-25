export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { savingsOpportunitySummary } from "@/lib/queries/rate-optimization";
import { mockSavingsSummary } from "@/lib/mock-data/rate-optimization";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateSavingsSummary } from "@/lib/customer-aggregations/rate-optimization";
import { filterSchema } from "@/lib/filter-schema";
import type { ApiResponse, SavingsSummary } from "@/lib/types";

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();
  const filters = filterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  if (isMockMode()) {
    const customer = customerDataResponse(request, filters, aggregateSavingsSummary);
    if (customer) return customer;

    return NextResponse.json({
      data: mockSavingsSummary,
      metadata: { queriedAt: now, isMock: true },
    } satisfies ApiResponse<SavingsSummary>);
  }

  const result = await executeQuery(savingsOpportunitySummary(filters));
  const row = result.rows[0] ?? {};

  const data: SavingsSummary = {
    commitmentGapSavings: Number(row.CommitmentGapSavings ?? 0),
    idleResourceSavings: Number(row.IdleResourceSavings ?? 0),
    totalPotentialSavings: Number(row.TotalPotentialSavings ?? 0),
  };

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<SavingsSummary>);
}
