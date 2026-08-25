export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { tagComplianceKql } from "@/lib/queries/governance";
import { mockTagCompliance } from "@/lib/mock-data/governance";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateTagCompliance } from "@/lib/customer-aggregations/governance";
import { filterSchema } from "@/lib/filter-schema";
import type { ApiResponse, TagComplianceBar } from "@/lib/types";

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();
  const filters = filterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  if (isMockMode()) {
    const customer = customerDataResponse(request, filters, aggregateTagCompliance);
    if (customer) return customer;

    return NextResponse.json(mockTagCompliance);
  }

  const result = await executeQuery(tagComplianceKql(filters));

  const data: TagComplianceBar[] = result.rows.map((r) => ({
    subscriptionName: String(r.SubAccountName ?? ""),
    compliancePct:    Number(r.CompliancePct ?? 0),
    total:            Math.round(Number(r.Total ?? 0)),
    tagCoverage: [
      { tag: "env",         pct: Number(r.EnvPct ?? 0),        costPct: Number(r.EnvCostPct ?? 0) },
      { tag: "owner",       pct: Number(r.OwnerPct ?? 0),      costPct: Number(r.OwnerCostPct ?? 0) },
      { tag: "cost-center", pct: Number(r.CostCenterPct ?? 0), costPct: Number(r.CostCenterCostPct ?? 0) },
    ],
  }));

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<TagComplianceBar[]>);
}
