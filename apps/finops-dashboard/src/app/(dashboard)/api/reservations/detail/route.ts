export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { reservationDetail } from "@/lib/queries/reservations";
import { mockReservationDetail } from "@/lib/mock-data/reservations";
import { filterSchema } from "@/lib/filter-schema";
import type { ApiResponse, ReservationRow } from "@/lib/types";

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const filters = filterSchema.parse(params);
  const extraParams = {
    commitmentName: params.commitmentName || undefined,
    resourceType: params.resourceType || undefined,
    commitmentType: params.commitmentType || undefined,
  };

  if (isMockMode()) {
    const { azureOnlyDataResponse } = await import("@/lib/customer-aggregations");
    const { aggregateReservationDetail } = await import("@/lib/customer-aggregations/reservations");
    const customer = azureOnlyDataResponse(request, filters, (ctx) =>
      aggregateReservationDetail(ctx, extraParams),
    );
    if (customer) return customer;

    let data = mockReservationDetail;
    if (extraParams.commitmentName) {
      data = data.filter((r) =>
        r.commitmentName
          .toLowerCase()
          .includes(extraParams.commitmentName!.toLowerCase()),
      );
    }
    if (extraParams.resourceType) {
      data = data.filter((r) => r.resourceType === extraParams.resourceType);
    }
    if (extraParams.commitmentType) {
      data = data.filter(
        (r) => r.commitmentType === extraParams.commitmentType,
      );
    }
    return NextResponse.json({
      data,
      metadata: { queriedAt: now, isMock: true },
    } satisfies ApiResponse<ReservationRow[]>);
  }

  const result = await executeQuery(reservationDetail(filters, extraParams));
  const data: ReservationRow[] = result.rows.map((r) => ({
    commitmentName: String(r.CommitmentDiscountName ?? ""),
    commitmentId: String(r.CommitmentDiscountId ?? ""),
    commitmentType: String(r.CommitmentDiscountType ?? ""),
    term: String(r.x_SkuTerm ?? ""),
    resourceType: String(r.x_ResourceType ?? ""),
    upfrontPaid: 0,
    consumed: 0,
    used: Number(r.Used ?? 0),
    unused: Number(r.Unused ?? 0),
    utilization: Number(r.Utilization ?? 0),
    days: Number(r.Days ?? 0),
  }));

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<ReservationRow[]>);
}
