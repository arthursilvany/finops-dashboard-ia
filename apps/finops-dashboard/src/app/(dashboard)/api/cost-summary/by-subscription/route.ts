export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { costBySubscription } from "@/lib/queries/cost-summary";
import { mockSubscriptionCosts } from "@/lib/mock-data/cost-summary";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateCostBySubscription } from "@/lib/customer-aggregations/cost-summary";
import { filterSchema } from "@/lib/filter-schema";
import type { ApiResponse, SubscriptionCost } from "@/lib/types";

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();
  const filters = filterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  if (isMockMode()) {
    const customer = customerDataResponse(request, filters, aggregateCostBySubscription);
    if (customer) return customer;

    return NextResponse.json({
      data: mockSubscriptionCosts,
      metadata: { queriedAt: now, isMock: true },
    } satisfies ApiResponse<SubscriptionCost[]>);
  }

  const result = await executeQuery(costBySubscription(filters));
  const data: SubscriptionCost[] = result.rows.map((r) => ({
    subscriptionName: String(r.SubAccountName ?? "Unknown"),
    cost: Number(r.SubscriptionCost ?? 0),
    percentage: Number(r.Percentage ?? 0),
  }));

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<SubscriptionCost[]>);
}
