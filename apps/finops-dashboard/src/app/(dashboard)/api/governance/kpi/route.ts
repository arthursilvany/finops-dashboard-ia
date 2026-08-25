export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { governanceKpiKql } from "@/lib/queries/governance";
import { mockGovernanceKpi } from "@/lib/mock-data/governance";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateGovernanceKpi } from "@/lib/customer-aggregations/governance";
import { filterSchema } from "@/lib/filter-schema";
import type { ApiResponse, GovernanceKpi } from "@/lib/types";

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();
  const filters = filterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  if (isMockMode()) {
    const customer = customerDataResponse(request, filters, aggregateGovernanceKpi);
    if (customer) return customer;

    return NextResponse.json(mockGovernanceKpi);
  }

  const result = await executeQuery(governanceKpiKql(filters));
  const row = result.rows[0] ?? {};

  const data: GovernanceKpi = {
    overallCompliance: Number(row.OverallCompliance ?? 0),
    taggedResources: Math.round(Number(row.TaggedResources ?? 0)),
    totalResources: Math.round(Number(row.TotalResources ?? 0)),
    policiesActive: 0,
    tagCoverage: [
      { tag: "env",         pct: Number(row.EnvPct ?? 0),        costPct: Number(row.EnvCostPct ?? 0) },
      { tag: "owner",       pct: Number(row.OwnerPct ?? 0),      costPct: Number(row.OwnerCostPct ?? 0) },
      { tag: "cost-center", pct: Number(row.CostCenterPct ?? 0), costPct: Number(row.CostCenterCostPct ?? 0) },
    ],
  };

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<GovernanceKpi>);
}
