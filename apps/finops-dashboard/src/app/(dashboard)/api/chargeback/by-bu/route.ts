export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { chargebackByBuKql } from "@/lib/queries/chargeback";
import { mockChargebackByBU } from "@/lib/mock-data/chargeback";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateChargebackByBu } from "@/lib/customer-aggregations/chargeback";
import { filterSchema } from "@/lib/filter-schema";
import type { ApiResponse, ChargebackByBU } from "@/lib/types";

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();
  const filters = filterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  if (isMockMode()) {
    const customer = customerDataResponse(request, filters, aggregateChargebackByBu);
    if (customer) return customer;

    return NextResponse.json(mockChargebackByBU);
  }

  const result = await executeQuery(chargebackByBuKql(filters));

  const data: ChargebackByBU[] = result.rows.map((r) => ({
    businessUnit: String(r.BusinessUnit ?? ""),
    cost: Number(r.Cost ?? 0),
    percentage: Number(r.Percentage ?? 0),
  }));

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<ChargebackByBU[]>);
}
