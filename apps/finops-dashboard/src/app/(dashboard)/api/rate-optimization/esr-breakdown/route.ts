export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { effectiveSavingsRateBreakdown } from "@/lib/queries/rate-optimization";
import { mockEffectiveSavingsRateBreakdown } from "@/lib/mock-data/rate-optimization";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateEsrBreakdown } from "@/lib/customer-aggregations/rate-optimization";
import { filterSchema } from "@/lib/filter-schema";
import type {
  ApiResponse,
  EffectiveSavingsRateBreakdownItem,
} from "@/lib/types";

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();
  const filters = filterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  if (isMockMode()) {
    const customer = customerDataResponse(request, filters, aggregateEsrBreakdown);
    if (customer) return customer;

    return NextResponse.json({
      data: mockEffectiveSavingsRateBreakdown,
      metadata: { queriedAt: now, isMock: true },
    } satisfies ApiResponse<EffectiveSavingsRateBreakdownItem[]>);
  }

  const result = await executeQuery(effectiveSavingsRateBreakdown(filters));
  const data: EffectiveSavingsRateBreakdownItem[] = result.rows.map((r) => ({
    month: String(r.Month ?? ""),
    listCost: Number(r.ListCost ?? 0),
    effectiveCost: Number(r.EffectiveCost ?? 0),
    savings: Number(r.Savings ?? 0),
    esr: Number(r.ESR ?? 0),
    // Not broken out by the ADX query — unknown, not zero.
    unusedCommitmentCost: null,
  }));

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<EffectiveSavingsRateBreakdownItem[]>);
}
