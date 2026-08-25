export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { budgetBurnRate } from "@/lib/queries/budgets";
import { mockBudgetBurnRate } from "@/lib/mock-data/budgets";
import { filterSchema } from "@/lib/filter-schema";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateBurnRate } from "@/lib/customer-aggregations/budgets";
import type { ApiResponse, BudgetBurnRate } from "@/lib/types";

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

  const monthlyBudget = params.data.budget;

  if (isMockMode()) {
    const customer = customerDataResponse(request, params.data, (ctx) =>
      aggregateBurnRate(ctx, monthlyBudget),
    );
    if (customer) return customer;

    return NextResponse.json({
      data: mockBudgetBurnRate(monthlyBudget),
      metadata: { queriedAt: now, isMock: true },
    } satisfies ApiResponse<BudgetBurnRate>);
  }

  const result = await executeQuery(budgetBurnRate(monthlyBudget, params.data));
  const row = result.rows[0] ?? {};

  const data: BudgetBurnRate = {
    spentSoFar: Number(row.SpentSoFar ?? 0),
    dailyBurnRate: Number(row.DailyBurnRate ?? 0),
    projectedMonthEnd: Number(row.ProjectedMonthEnd ?? 0),
    budget: monthlyBudget,
    budgetVariance: Number(row.BudgetVariance ?? 0),
    budgetUsedPercent: Number(row.BudgetUsedPercent ?? 0),
    status: String(row.Status ?? "ON_TRACK") as BudgetBurnRate["status"],
  };

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<BudgetBurnRate>);
}
