export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { budgetVsActualKql } from "@/lib/queries/governance";
import { mockBudgetVsActual } from "@/lib/mock-data/governance";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateBudgetVsActual } from "@/lib/customer-aggregations/governance";
import { filterSchema } from "@/lib/filter-schema";
import type { ApiResponse, BudgetVsActualBar } from "@/lib/types";

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();
  const filters = filterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  if (isMockMode()) {
    const customer = customerDataResponse(request, filters, aggregateBudgetVsActual);
    if (customer) return customer;

    return NextResponse.json(mockBudgetVsActual);
  }

  const result = await executeQuery(budgetVsActualKql(filters));

  const data: BudgetVsActualBar[] = result.rows.map((r) => ({
    subscriptionName: String(r.SubAccountName ?? ""),
    budget:    0,
    actual:    Number(r.Actual ?? 0),
    variance:  0,
  }));

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<BudgetVsActualBar[]>);
}
