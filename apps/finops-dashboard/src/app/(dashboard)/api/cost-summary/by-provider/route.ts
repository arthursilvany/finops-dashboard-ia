export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { costByProvider } from "@/lib/queries/cost-summary";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateCostByProvider } from "@/lib/customer-aggregations/cost-summary";
import { normalizeProvider } from "@/lib/customer-data/contract";
import { filterSchema } from "@/lib/filter-schema";
import type { ApiResponse, ProviderCost } from "@/lib/types";

/**
 * Mock mode has no multicloud story to tell — the sample dataset is Azure-only,
 * so a single provider is the honest answer rather than an invented split.
 */
const mockProviderCosts: ProviderCost[] = [
  { providerName: "Azure", cost: 0, percentage: 100 },
];

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();
  const filters = filterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );

  if (isMockMode()) {
    const customer = customerDataResponse(request, filters, aggregateCostByProvider);
    if (customer) return customer;

    return NextResponse.json({
      data: mockProviderCosts,
      metadata: { queriedAt: now, isMock: true },
    } satisfies ApiResponse<ProviderCost[]>);
  }

  const result = await executeQuery(costByProvider(filters));

  // FOCUS emits the vendor's own spelling ("Microsoft"), and a hub fed by more
  // than one connector can carry several spellings of the same cloud. Normalize
  // first, then re-aggregate so those do not appear as separate providers.
  const totals = new Map<string, { cost: number; percentage: number }>();
  for (const row of result.rows) {
    const provider = normalizeProvider(String(row.ProviderName ?? ""), "Other");
    const current = totals.get(provider) ?? { cost: 0, percentage: 0 };
    current.cost += Number(row.ProviderCost ?? 0);
    current.percentage += Number(row.Percentage ?? 0);
    totals.set(provider, current);
  }

  const data: ProviderCost[] = Array.from(totals.entries())
    .map(([providerName, { cost, percentage }]) => ({
      providerName,
      cost: Math.round(cost * 100) / 100,
      percentage: Math.round(percentage * 10) / 10,
    }))
    .sort((a, b) => b.cost - a.cost);

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<ProviderCost[]>);
}
