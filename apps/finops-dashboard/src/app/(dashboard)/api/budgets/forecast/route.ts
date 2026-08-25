export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import {
  forecastVsBudget,
  forecastWithConfidence,
} from "@/lib/queries/budgets";
import {
  mockForecastVsBudget,
  mockForecastConfidence,
} from "@/lib/mock-data/budgets";
import { filterSchema } from "@/lib/filter-schema";
import { customerDataResponse } from "@/lib/customer-aggregations";
import {
  aggregateForecast,
  aggregateForecastConfidence,
} from "@/lib/customer-aggregations/budgets";
import type {
  ApiResponse,
  ForecastPoint,
  ForecastConfidencePoint,
} from "@/lib/types";

const schema = z
  .object({
    budget: z.coerce.number().positive().default(10000),
    mode: z.enum(["budget", "confidence"]).default("budget"),
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

  if (params.data.mode === "confidence") {
    if (isMockMode()) {
      const customer = customerDataResponse(request,
        params.data,
        aggregateForecastConfidence,
      );
      if (customer) return customer;

      return NextResponse.json({
        data: mockForecastConfidence(),
        metadata: { queriedAt: now, isMock: true },
      } satisfies ApiResponse<ForecastConfidencePoint[]>);
    }

    try {
      const result = await executeQuery(forecastWithConfidence(params.data));
      const data: ForecastConfidencePoint[] = result.rows.map((r) => ({
        day: String(r.Day ?? ""),
        actual: r.Actual != null ? Number(r.Actual) : null,
        forecast: Number(r.Forecast ?? 0),
        lowerBound: Number(r.LowerBound ?? 0),
        upperBound: Number(r.UpperBound ?? 0),
      }));

      return NextResponse.json({
        data,
        metadata: { queriedAt: now, isMock: false },
      } satisfies ApiResponse<ForecastConfidencePoint[]>);
    } catch (err) {
      return NextResponse.json(
        {
          error: err instanceof Error ? err.message : "Query failed",
          data: [],
        },
        { status: 500 },
      );
    }
  }

  // Default: budget mode
  if (isMockMode()) {
    const customer = customerDataResponse(request, params.data, (ctx) =>
      aggregateForecast(ctx, params.data.budget),
    );
    if (customer) return customer;

    return NextResponse.json({
      data: mockForecastVsBudget(params.data.budget),
      metadata: { queriedAt: now, isMock: true },
    } satisfies ApiResponse<ForecastPoint[]>);
  }

  const result = await executeQuery(
    forecastVsBudget(params.data.budget, params.data),
  );
  const data: ForecastPoint[] = result.rows.map((r) => ({
    day: String(r.Day ?? ""),
    dailyCost: r.DailyCost != null ? Number(r.DailyCost) : null,
    dailyForecast: r.DailyForecast != null ? Number(r.DailyForecast) : null,
    dailyBudgetTarget: Number(r.DailyBudgetTarget ?? 0),
  }));

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<ForecastPoint[]>);
}
