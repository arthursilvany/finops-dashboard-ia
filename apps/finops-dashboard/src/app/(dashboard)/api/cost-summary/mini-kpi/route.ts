export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode } from "@/lib/adx-client";
import { mockMiniKpis } from "@/lib/mock-data/cost-summary";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateMiniKpis } from "@/lib/customer-aggregations/cost-summary";
import type { ApiResponse, MiniKpiGauge } from "@/lib/types";
import { executeQuery } from "@/lib/adx-client";
import { miniKpiQuery } from "@/lib/queries/cost-summary";
import { filterSchema } from "@/lib/filter-schema";

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();

  const filters = filterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  if (isMockMode()) {
    const customer = customerDataResponse(request, filters, aggregateMiniKpis);
    if (customer) return customer;

    const response: ApiResponse<MiniKpiGauge[]> = {
      data: mockMiniKpis,
      metadata: { queriedAt: now, isMock: true },
    };
    return NextResponse.json(response);
  }

  try {
    const result = await executeQuery(miniKpiQuery(filters));
    const row = result.rows[0] ?? {};

    const commitmentCoverage = Number(row.CommitmentCoverage ?? 0);
    const tagCoverage = Number(row.TagCoverage ?? 0);

    const data: MiniKpiGauge[] = [
      {
        label: "Commitment Coverage",
        value: commitmentCoverage,
        target: 80,
        targetLabel: "Meta: 80%",
        status:
          commitmentCoverage >= 80
            ? "good"
            : commitmentCoverage >= 50
              ? "warning"
              : "danger",
      },
      {
        label: "Tag Compliance",
        value: tagCoverage,
        target: 95,
        targetLabel: "Meta: 95%",
        status:
          tagCoverage >= 95 ? "good" : tagCoverage >= 70 ? "warning" : "danger",
      },
    ];

    return NextResponse.json({
      data,
      metadata: { queriedAt: now, isMock: false },
    } satisfies ApiResponse<MiniKpiGauge[]>);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Query failed", data: [] },
      { status: 500 },
    );
  }
}
