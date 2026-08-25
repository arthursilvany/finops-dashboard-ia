export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { chargebackKpiKql } from "@/lib/queries/chargeback";
import { mockChargebackKpi } from "@/lib/mock-data/chargeback";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateChargebackKpi } from "@/lib/customer-aggregations/chargeback";
import { filterSchema } from "@/lib/filter-schema";
import type { ApiResponse, ChargebackKpi } from "@/lib/types";

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();
  const filters = filterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  if (isMockMode()) {
    const customer = customerDataResponse(request, filters, aggregateChargebackKpi);
    if (customer) return customer;

    return NextResponse.json(mockChargebackKpi);
  }

  const result = await executeQuery(chargebackKpiKql(filters));
  const row = result.rows[0] ?? {};

  const data: ChargebackKpi = {
    totalAllocated: Number(row.TotalAllocated ?? 0),
    untaggedCost:   Number(row.UntaggedCost ?? 0),
    businessUnits:  Math.round(Number(row.BusinessUnits ?? 0)),
    topBU: "",
  };

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<ChargebackKpi>);
}
