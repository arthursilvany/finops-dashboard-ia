export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { getCustomerDataset } from "@/lib/customer-dataset";
import { aggregateCustomerWorkload } from "@/lib/customer-operational-aggregations";
import { customerSlugFromCookieHeader } from "@/lib/customer-data/workspace";
import { workloadKpiKql } from "@/lib/queries/workload";
import { mockWorkloadKpi } from "@/lib/mock-data/workload";
import { filterSchema } from "@/lib/filter-schema";
import type { ApiResponse, WorkloadKpi } from "@/lib/types";

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();
  const filters = filterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  if (isMockMode()) {
    const customerSlug = customerSlugFromCookieHeader(
      request.headers.get("cookie"),
    );
    const customerDataset = getCustomerDataset(customerSlug ?? undefined);
    const customer = aggregateCustomerWorkload(customerSlug);
    if (customerDataset && customer) {
      return NextResponse.json({
        data: customer.kpi,
        metadata: {
          queriedAt: now,
          isMock: false,
          dataSource: "customer",
          customerName: customerDataset.manifest.customer,
        },
      } satisfies ApiResponse<WorkloadKpi>);
    }

    return NextResponse.json(mockWorkloadKpi);
  }

  const result = await executeQuery(workloadKpiKql(), "Ingestion");
  const row = (result.rows[0] ?? {}) as Record<string, number | null>;

  const data: WorkloadKpi = {
    totalVMs: Math.round(Number(row.totalVMs ?? 0)),
    rightsizingCandidates: Math.round(Number(row.rightsizingCandidates ?? 0)),
    potentialMonthlySavings: Number(row.potentialMonthlySavings ?? 0),
    avgCpuUtilization: Math.round(Number(row.avgCpuUtilization ?? 0)),
  };

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<WorkloadKpi>);
}
