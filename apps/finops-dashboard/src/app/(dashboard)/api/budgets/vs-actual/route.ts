export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { budgetVsActual } from "@/lib/queries/budgets";
import { mockBudgetVsActual } from "@/lib/mock-data/budgets";
import { filterSchema } from "@/lib/filter-schema";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateBudgetVsActual } from "@/lib/customer-aggregations/budgets";
import type { ApiResponse, BudgetVsActualPoint } from "@/lib/types";

const schema = z
  .object({
    budget: z.coerce.number().positive().default(10000),
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
      aggregateBudgetVsActual(ctx, params.data.budget),
    );
    if (customer) return customer;

    return NextResponse.json({
      data: mockBudgetVsActual(params.data.budget),
      metadata: { queriedAt: now, isMock: true },
    } satisfies ApiResponse<BudgetVsActualPoint[]>);
  }

  const result = await executeQuery(
    budgetVsActual(params.data.budget, params.data),
  );
  const data: BudgetVsActualPoint[] = result.rows.map((r) => ({
    day: String(r.Day ?? ""),
    dailyCost: Number(r.DailyCost ?? 0),
    cumulativeActual: Number(r.CumulativeActual ?? 0),
    cumulativeBudget: Number(r.CumulativeBudget ?? 0),
  }));

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<BudgetVsActualPoint[]>);
}
