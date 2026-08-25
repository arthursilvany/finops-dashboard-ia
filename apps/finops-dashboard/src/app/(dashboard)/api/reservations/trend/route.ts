export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { reservationTrend } from "@/lib/queries/reservations";
import { mockReservationTrend } from "@/lib/mock-data/reservations";
import { filterSchema } from "@/lib/filter-schema";
import type { ApiResponse, ReservationTrendPoint } from "@/lib/types";

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const filters = filterSchema.parse(params);
  const extraParams = {
    commitmentName: params.commitmentName || undefined,
    commitmentType: params.commitmentType || undefined,
  };

  if (isMockMode()) {
    const { azureOnlyDataResponse } = await import("@/lib/customer-aggregations");
    const { aggregateReservationTrend } = await import("@/lib/customer-aggregations/reservations");
    const customer = azureOnlyDataResponse(request, filters, (ctx) =>
      aggregateReservationTrend(ctx, extraParams),
    );
    if (customer) return customer;

    return NextResponse.json({
      data: mockReservationTrend,
      metadata: { queriedAt: now, isMock: true },
    } satisfies ApiResponse<ReservationTrendPoint[]>);
  }

  const result = await executeQuery(reservationTrend(filters, extraParams));
  const data: ReservationTrendPoint[] = result.rows.map((r) => ({
    month: String(r.Month ?? ""),
    used: Number(r.Used ?? 0),
    unused: Number(r.Unused ?? 0),
  }));

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<ReservationTrendPoint[]>);
}
