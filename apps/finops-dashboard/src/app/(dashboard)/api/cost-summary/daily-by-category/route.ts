export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode } from "@/lib/adx-client";
import { mockDailyCostByCategory } from "@/lib/mock-data/cost-summary";
import { customerDataResponse } from "@/lib/customer-aggregations";
import { aggregateDailyByCategory } from "@/lib/customer-aggregations/cost-summary";
import type { ApiResponse, DailyCostByCategory } from "@/lib/types";
import { z } from "zod";
import { executeQuery } from "@/lib/adx-client";
import { dailyByCategoryQuery } from "@/lib/queries/cost-summary";
import { filterSchema } from "@/lib/filter-schema";

const schema = z
  .object({ days: z.coerce.number().int().min(1).max(90).default(30) })
  .merge(filterSchema);

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();

  const params = schema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!params.success) {
    return NextResponse.json({ error: params.error.flatten() }, { status: 400 });
  }

  if (isMockMode()) {
    const customer = customerDataResponse(request, params.data, (ctx) =>
      aggregateDailyByCategory(ctx, params.data.days),
    );
    if (customer) return customer;

    const response: ApiResponse<DailyCostByCategory[]> = {
      data: mockDailyCostByCategory,
      metadata: { queriedAt: now, isMock: true },
    };
    return NextResponse.json(response);
  }

  const result = await executeQuery(
    dailyByCategoryQuery(params.data.days, params.data),
  );

  // Pivot flat rows [{Day, Category, cost}] → [{day, categories: {Cat: cost}}]
  const byDay = new Map<string, Record<string, number>>();
  for (const r of result.rows) {
    const day = String(r.Day ?? "");
    const cat = String(r.Category ?? "Others");
    const cost = Number(r.cost ?? 0);
    if (!byDay.has(day)) byDay.set(day, {});
    byDay.get(day)![cat] = cost;
  }

  const data: DailyCostByCategory[] = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, categories]) => ({ day, categories }));

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<DailyCostByCategory[]>);
}
