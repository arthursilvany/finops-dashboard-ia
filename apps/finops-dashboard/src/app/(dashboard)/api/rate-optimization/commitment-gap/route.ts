export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { commitmentGap } from "@/lib/queries/rate-optimization";
import { mockCommitmentGap } from "@/lib/mock-data/rate-optimization";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateCommitmentGap } from "@/lib/customer-aggregations/rate-optimization";
import { filterSchema } from "@/lib/filter-schema";
import type { ApiResponse, CommitmentGapItem } from "@/lib/types";

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();
  const filters = filterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  if (isMockMode()) {
    const customer = customerDataResponse(request, filters, aggregateCommitmentGap);
    if (customer) return customer;

    return NextResponse.json({
      data: mockCommitmentGap,
      metadata: { queriedAt: now, isMock: true },
    } satisfies ApiResponse<CommitmentGapItem[]>);
  }

  const result = await executeQuery(commitmentGap(filters));
  const data: CommitmentGapItem[] = result.rows.map((r) => ({
    service: String(r.ServiceName ?? "Unknown"),
    onDemandCost: Number(r.OnDemandCost ?? 0),
    committedCost: Number(r.CommittedCost ?? 0),
    commitmentCoverage: Number(r.CommitmentCoverage ?? 0),
    potentialSavings: Number(r.PotentialSavings ?? 0),
  }));

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<CommitmentGapItem[]>);
}
