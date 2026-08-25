export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { anomalyTopResources } from "@/lib/queries/anomalies";
import { mockAnomalyTopResources } from "@/lib/mock-data/anomalies";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateAnomalyTopResources } from "@/lib/customer-aggregations/anomalies";
import { filterSchema } from "@/lib/filter-schema";
import type { ApiResponse, AnomalyResource } from "@/lib/types";

const schema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
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
      aggregateAnomalyTopResources(ctx, params.data.date),
    );
    if (customer) return customer;

    return NextResponse.json({
      data: mockAnomalyTopResources,
      metadata: { queriedAt: now, isMock: true },
    } satisfies ApiResponse<AnomalyResource[]>);
  }

  let anomalyDate = params.data.date;
  if (!anomalyDate) {
    const rangeResult = await executeQuery(
      `Costs() | summarize max(ChargePeriodStart) | project d = format_datetime(max_ChargePeriodStart, "yyyy-MM-dd")`,
    );
    anomalyDate =
      rangeResult.rows.length > 0
        ? String(rangeResult.rows[0].d)
        : new Date().toISOString().split("T")[0];
  }
  const result = await executeQuery(
    anomalyTopResources(anomalyDate, params.data),
  );
  const data: AnomalyResource[] = result.rows.map((r) => ({
    consumedService: String(r.ServiceName ?? ""),
    resourceName: String(r.ResourceName ?? ""),
    dayCost: Number(r.DayCost ?? 0),
  }));

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<AnomalyResource[]>);
}
