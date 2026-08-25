export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { reservationFilterOptions } from "@/lib/queries/reservations";
import { mockReservationFilterOptions } from "@/lib/mock-data/reservations";
import { filterSchema } from "@/lib/filter-schema";
import type { ApiResponse, ReservationFilterOptions } from "@/lib/types";

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();
  const filters = filterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  if (isMockMode()) {
    const { azureOnlyDataResponse } = await import("@/lib/customer-aggregations");
    const { aggregateReservationOptions } = await import("@/lib/customer-aggregations/reservations");
    const customer = azureOnlyDataResponse(request, filters, aggregateReservationOptions);
    if (customer) return customer;

    return NextResponse.json({
      data: mockReservationFilterOptions,
      metadata: { queriedAt: now, isMock: true },
    } satisfies ApiResponse<ReservationFilterOptions>);
  }

  const result = await executeQuery(reservationFilterOptions(filters));
  const row = result.rows[0] ?? {};
  const toArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(String).filter(Boolean).sort() : [];

  const data: ReservationFilterOptions = {
    commitmentNames: toArr(row.Names),
    resourceTypes: toArr(row.ResourceTypes),
    commitmentTypes: toArr(row.CommitmentTypes),
  };

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<ReservationFilterOptions>);
}
