export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { executeQuery, isMockMode } from "@/lib/adx-client";
import {
  mockAiInsightsCost,
  mockAiRadar,
  mockFinOpsRadar,
} from "@/lib/mock-data/ai-insights";
import {
  queryAdvisorRecommendations,
  queryAdvisorDetails,
} from "@/lib/resource-graph-client";
import {
  computeRadarFromAdvisor,
  computeInsightsFromAdvisor,
} from "@/lib/queries/advisor";
import { costForecastKql } from "@/lib/queries/ai-insights";
import { computeFinOpsRadar } from "@/lib/queries/finops-radar";
import { filterSchema } from "@/lib/filter-schema";
import { azureOnlyDataResponse } from "@/lib/customer-aggregations";
import { aggregateCustomerAiInsights } from "@/lib/customer-aggregations/ai-insights";
import {
  getCustomerWafRadar,
  unavailableCustomerWafRadar,
} from "@/lib/customer-waf-radar";
import type {
  ApiResponse,
  AiInsight,
  AiInsightsCost,
  AiRadarDataset,
} from "@/lib/types";

interface AiInsightsBundle {
  insights: AiInsight[];
  costForecast: AiInsightsCost;
  radar: AiRadarDataset;
  finopsRadar: AiRadarDataset;
}

function formatMonth(d: Date): string {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;
}

export async function GET(request: Request) {
  const now = new Date().toISOString();

  // Parse filters — must happen before isMockMode() check so the customer
  // tier can apply the same filter state the UI sent (mirrors phase-1 routes).
  const { searchParams } = new URL(request.url);
  const filters = filterSchema.parse(Object.fromEntries(searchParams.entries()));

  const subId = process.env.AZURE_SUBSCRIPTION_ID;
  const subs = subId ? [subId] : [];

  // Insights are always fetched from live Azure Advisor — never from mock data
  const insightsPromise: Promise<AiInsight[]> =
    subs.length > 0
      ? queryAdvisorDetails(subs)
          .then(computeInsightsFromAdvisor)
          .catch((): AiInsight[] => [])
      : Promise.resolve([]);

  if (isMockMode()) {
    // Customer POC tier: real data from a loaded Cost Export, no ADX needed.
    const customerResponse = azureOnlyDataResponse(request, filters, (ctx) => {
      const result = aggregateCustomerAiInsights(ctx);
      const bundle: AiInsightsBundle = {
        insights: result.insights,
        costForecast: result.costForecast,
        radar:
          getCustomerWafRadar(ctx.manifest.generatedAtUtc, ctx.customerSlug) ??
          unavailableCustomerWafRadar,
        finopsRadar: result.finopsRadar,
      };
      return bundle;
    });
    if (customerResponse) return customerResponse;

    // Static demo fallback when no dataset is loaded.
    const insights = await insightsPromise;
    const data: AiInsightsBundle = {
      insights,
      costForecast: mockAiInsightsCost.data,
      radar: mockAiRadar.data,
      finopsRadar: mockFinOpsRadar.data,
    };
    return NextResponse.json({
      data,
      metadata: { queriedAt: now, isMock: true },
    } satisfies ApiResponse<AiInsightsBundle>);
  }

  // Live mode: fetch radar, insights, forecast, and FinOps radar in parallel
  const [radarResult, insightsResult, forecastResult, finopsRadarResult] =
    await Promise.allSettled([
      subs.length > 0
        ? queryAdvisorRecommendations(subs).then(computeRadarFromAdvisor)
        : Promise.resolve(mockAiRadar.data),
      insightsPromise,
      executeQuery(costForecastKql()).then((result) => {
        const rows = result.rows;
        const categories: string[] = [];
        const actual: (number | null)[] = [];
        const forecast: number[] = [];
        const lowerBound: number[] = [];
        const upperBound: number[] = [];
        for (const row of rows) {
          const a = row.Actual != null ? Number(row.Actual) : null;
          const f = Math.max(0, Number(row.Forecast ?? 0));
          const lo = Math.max(0, Number(row.LowerBound ?? 0));
          const hi = Math.max(0, Number(row.UpperBound ?? 0));
          // Skip months with no actual spend and zero forecast
          if (a === null && f === 0 && lo === 0 && hi === 0) continue;
          const month = new Date(String(row.Month));
          categories.push(formatMonth(month));
          actual.push(a);
          forecast.push(f);
          lowerBound.push(lo);
          upperBound.push(hi);
        }
        return {
          categories,
          actual,
          forecast,
          lowerBound,
          upperBound,
        } as AiInsightsCost;
      }),
      computeFinOpsRadar().catch(() => mockFinOpsRadar.data),
    ]);

  const radarData =
    radarResult.status === "fulfilled" ? radarResult.value : mockAiRadar.data;
  const insightsData =
    insightsResult.status === "fulfilled" ? insightsResult.value : [];
  const forecastData =
    forecastResult.status === "fulfilled"
      ? forecastResult.value
      : mockAiInsightsCost.data;
  const finopsRadarData =
    finopsRadarResult.status === "fulfilled"
      ? finopsRadarResult.value
      : mockFinOpsRadar.data;

  return NextResponse.json({
    data: {
      insights: insightsData,
      costForecast: forecastData,
      radar: radarData,
      finopsRadar: finopsRadarData,
    },
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<AiInsightsBundle>);
}
