export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { mcpRiPricing } from "@/lib/azure-pricing-mcp-client";

export interface RiCompareRequest {
  service_name: string;
  sku_name?: string;
  region?: string;
  currency_code?: string;
}

export interface RiCompareRow {
  mode: string;
  monthly_cost: number | null;
  annual_cost: number | null;
  savings_pct: number | null;
  break_even_months: number | null;
  recommendation: "Strong" | "Moderate" | "Weak" | "—";
}

export interface RiCompareResult {
  rows: RiCompareRow[];
  currency: string;
  service_name: string;
  sku_name: string | null;
  region: string | null;
}

// Extract the first JSON block from MCP text response
function extractJson(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function recommendationLabel(
  savingsPct: number | null,
): RiCompareRow["recommendation"] {
  if (savingsPct === null) return "—";
  if (savingsPct >= 30) return "Strong";
  if (savingsPct >= 15) return "Moderate";
  return "Weak";
}

// Parse the verbose MCP ri_pricing result into a structured row
function parseRiRow(
  data: Record<string, unknown> | null,
  term: string,
  onDemandMonthly: number | null,
): RiCompareRow {
  if (!data) {
    return {
      mode: term,
      monthly_cost: null,
      annual_cost: null,
      savings_pct: null,
      break_even_months: null,
      recommendation: "—",
    };
  }

  // MCP may return top-level savings_analysis or nested items
  const sa = (data.savings_analysis ?? data) as Record<string, unknown>;
  const riMonthly =
    typeof sa.monthly_equivalent_cost === "number"
      ? (sa.monthly_equivalent_cost as number)
      : typeof sa.effective_monthly_cost === "number"
        ? (sa.effective_monthly_cost as number)
        : null;

  const savingsPct =
    typeof sa.savings_percentage === "number"
      ? (sa.savings_percentage as number)
      : onDemandMonthly && riMonthly
        ? ((onDemandMonthly - riMonthly) / onDemandMonthly) * 100
        : null;

  const breakEven =
    typeof sa.break_even_months === "number"
      ? (sa.break_even_months as number)
      : null;

  return {
    mode: term === "1 Year" ? "RI 1 Year" : "RI 3 Years",
    monthly_cost: riMonthly,
    annual_cost: riMonthly !== null ? riMonthly * 12 : null,
    savings_pct: savingsPct !== null ? Math.round(savingsPct * 10) / 10 : null,
    break_even_months: breakEven,
    recommendation: recommendationLabel(savingsPct),
  };
}

export async function POST(req: NextRequest) {
  let body: RiCompareRequest;
  try {
    body = (await req.json()) as RiCompareRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { service_name, sku_name, region, currency_code = "USD" } = body;

  if (!service_name?.trim()) {
    return NextResponse.json(
      { error: "service_name is required" },
      { status: 400 },
    );
  }

  const baseArgs = {
    service_name: service_name.trim(),
    sku_name: sku_name?.trim() || undefined,
    region: region?.trim() || undefined,
    currency_code,
    compare_on_demand: true,
    limit: 1,
    output_format: "verbose" as const,
  };

  // Fetch 1Y and 3Y in parallel
  const [text1Y, text3Y] = await Promise.all([
    mcpRiPricing({ ...baseArgs, reservation_term: "1 Year" }).catch(() => ""),
    mcpRiPricing({ ...baseArgs, reservation_term: "3 Years" }).catch(() => ""),
  ]);

  const data1Y = extractJson(text1Y);
  const data3Y = extractJson(text3Y);

  // Extract on-demand (PAYG) monthly cost from the first response
  const sa1 = data1Y
    ? ((data1Y.savings_analysis ?? data1Y) as Record<string, unknown>)
    : null;
  const onDemandMonthly =
    sa1 && typeof sa1.on_demand_monthly_cost === "number"
      ? (sa1.on_demand_monthly_cost as number)
      : null;

  const payg: RiCompareRow = {
    mode: "PAYG (On-demand)",
    monthly_cost: onDemandMonthly,
    annual_cost: onDemandMonthly !== null ? onDemandMonthly * 12 : null,
    savings_pct: 0,
    break_even_months: null,
    recommendation: "—",
  };

  const row1Y = parseRiRow(data1Y, "1 Year", onDemandMonthly);
  const row3Y = parseRiRow(data3Y, "3 Years", onDemandMonthly);

  const result: RiCompareResult = {
    rows: [payg, row1Y, row3Y],
    currency: currency_code,
    service_name: service_name.trim(),
    sku_name: sku_name?.trim() ?? null,
    region: region?.trim() ?? null,
  };

  return NextResponse.json(result);
}
