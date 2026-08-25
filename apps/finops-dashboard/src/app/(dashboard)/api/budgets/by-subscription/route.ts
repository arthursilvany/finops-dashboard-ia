export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { budgetBySubscription } from "@/lib/queries/budgets";
import { mockBudgetBySubscription } from "@/lib/mock-data/budgets";
import { filterSchema } from "@/lib/filter-schema";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateBudgetBySubscription } from "@/lib/customer-aggregations/budgets";
import type { ApiResponse, BudgetBySubscription } from "@/lib/types";

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
    const customer = customerDataResponse(request,
      params.data,
      (ctx) => aggregateBudgetBySubscription(ctx, params.data.budget),
    );
    if (customer) return customer;

    return NextResponse.json({
      data: mockBudgetBySubscription,
      metadata: { queriedAt: now, isMock: true },
    } satisfies ApiResponse<BudgetBySubscription[]>);
  }

  const result = await executeQuery(
    budgetBySubscription(params.data.budget, params.data),
  );
  const data: BudgetBySubscription[] = result.rows.map((r) => ({
    subscriptionName: String(r.SubAccountName ?? "Unknown"),
    cost: Number(r.Cost ?? 0),
    percentOfBudget: Number(r.PercentOfBudget ?? 0),
  }));

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<BudgetBySubscription[]>);
}
