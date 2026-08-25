export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { getCustomerDataset } from "@/lib/customer-dataset";
import { aggregateCustomerWorkload } from "@/lib/customer-operational-aggregations";
import { customerSlugFromCookieHeader } from "@/lib/customer-data/workspace";
import { workloadCpuScatterKql } from "@/lib/queries/workload";
import { mockCpuCostPoints } from "@/lib/mock-data/workload";
import { filterSchema } from "@/lib/filter-schema";
import type { ApiResponse, CpuCostPoint } from "@/lib/types";

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();
  filterSchema.parse(Object.fromEntries(request.nextUrl.searchParams));

  if (isMockMode()) {
    const customerSlug = customerSlugFromCookieHeader(
      request.headers.get("cookie"),
    );
    const customerDataset = getCustomerDataset(customerSlug ?? undefined);
    const customer = aggregateCustomerWorkload(customerSlug);
    if (customerDataset && customer) {
      return NextResponse.json({
        data: customer.scatter,
        metadata: {
          queriedAt: now,
          isMock: false,
          dataSource: "customer",
          customerName: customerDataset.manifest.customer,
        },
      } satisfies ApiResponse<CpuCostPoint[]>);
    }

    return NextResponse.json(mockCpuCostPoints);
  }

  const result = await executeQuery(workloadCpuScatterKql(), "Ingestion");

  const data: CpuCostPoint[] = result.rows.map((r) => ({
    name: String(r.Name ?? ""),
    cpuAvg: Number(r.CpuAvg ?? 0),
    monthlyCost: Number(r.MonthlyCost ?? 0),
    service: String(r.Service ?? ""),
  }));

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<CpuCostPoint[]>);
}
