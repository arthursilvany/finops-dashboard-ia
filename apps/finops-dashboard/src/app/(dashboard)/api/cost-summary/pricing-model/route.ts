export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode } from "@/lib/adx-client";
import { mockPricingModel } from "@/lib/mock-data/cost-summary";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregatePricingModel } from "@/lib/customer-aggregations/cost-summary";
import type { ApiResponse, PricingModelBreakdown } from "@/lib/types";
import { executeQuery } from "@/lib/adx-client";
import { pricingModelQuery } from "@/lib/queries/cost-summary";
import { filterSchema } from "@/lib/filter-schema";

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();

  const filters = filterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  if (isMockMode()) {
    const customer = customerDataResponse(request, filters, aggregatePricingModel);
    if (customer) return customer;

    const response: ApiResponse<PricingModelBreakdown[]> = {
      data: mockPricingModel,
      metadata: { queriedAt: now, isMock: true },
    };
    return NextResponse.json(response);
  }

  try {
    const result = await executeQuery(pricingModelQuery(filters));
    const data: PricingModelBreakdown[] = result.rows.map((r) => ({
      model: String(r.model ?? "Other"),
      cost: Number(r.cost ?? 0),
    }));

    return NextResponse.json({
      data,
      metadata: { queriedAt: now, isMock: false },
    } satisfies ApiResponse<PricingModelBreakdown[]>);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Query failed", data: [] },
      { status: 500 },
    );
  }
}
