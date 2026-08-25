export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { getCustomerDataset } from "@/lib/customer-dataset";
import { aggregateCustomerWorkload } from "@/lib/customer-operational-aggregations";
import { customerSlugFromCookieHeader } from "@/lib/customer-data/workspace";
import { workloadRightsizingKql } from "@/lib/queries/workload";
import { mockRightsizingRows } from "@/lib/mock-data/workload";
import { filterSchema } from "@/lib/filter-schema";
import type { ApiResponse, RightsizingRow } from "@/lib/types";

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
        data: customer.rightsizing,
        metadata: {
          queriedAt: now,
          isMock: false,
          dataSource: "customer",
          customerName: customerDataset.manifest.customer,
        },
      } satisfies ApiResponse<RightsizingRow[]>);
    }

    return NextResponse.json(mockRightsizingRows);
  }

  const result = await executeQuery(workloadRightsizingKql(), "Ingestion");

  const data: RightsizingRow[] = result.rows.map((r) => ({
    resourceName: String(r.ResourceName ?? ""),
    resourceGroup: String(r.ResourceGroup ?? ""),
    subscriptionName: String(r.SubscriptionName ?? ""),
    currentSku: String(r.CurrentSku ?? ""),
    recommendedSku: String(r.RecommendedSku ?? ""),
    cpuAvg: Number(r.CpuAvg ?? 0),
    currentCost: Number(r.CurrentCost ?? 0),
    projectedCost: Number(r.ProjectedCost ?? 0),
    monthlySavings: Number(r.MonthlySavings ?? 0),
  }));

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<RightsizingRow[]>);
}
