export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { executeQuery, isMockMode } from "@/lib/adx-client";
import {
  generateSimulatorEstimate,
  mockServiceOptions,
  enrichSimulatorEstimate,
} from "@/lib/mock-data/simulator";
import { simulatorEstimateQuery } from "@/lib/queries/simulator";
import type {
  ApiResponse,
  SimulatorEstimate,
  SimulatorInput,
  PriceSource,
} from "@/lib/types";

const simulatorInputSchema = z.object({
  service: z.enum(["VM", "Storage", "DB", "AKS"]),
  qty: z.number().int().positive().max(1000),
  region: z.string().min(2).max(60),
  sku: z.string().min(2).max(120),
  priceSource: z.enum(["retail", "contract"]).default("retail"),
  commitment: z.enum(["ondemand", "1yr", "3yr"]).optional(),
});

function validateInputAgainstCatalog(input: SimulatorInput): string | null {
  const service = mockServiceOptions.find(
    (option) => option.value === input.service,
  );
  if (!service) {
    return "Unsupported service";
  }

  if (!service.supportedRegions.includes(input.region)) {
    return `Region '${input.region}' is not supported for service '${input.service}'`;
  }

  const sku = service.skus.find((option) => option.sku === input.sku);
  if (!sku) {
    return `SKU '${input.sku}' is not supported for service '${input.service}'`;
  }

  return null;
}

export async function POST(request: NextRequest) {
  const now = new Date().toISOString();

  const parseEstimateRow = (row: Record<string, unknown>) => {
    const monthlyOnDemand = Number(row.MonthlyOnDemand ?? 0);
    const monthly1yr = Number(row.Monthly1yr ?? 0);
    const monthly3yr = Number(row.Monthly3yr ?? 0);
    const monthlySavings1yr = Number(row.MonthlySavings1yr ?? 0);
    const monthlySavings3yr = Number(row.MonthlySavings3yr ?? 0);

    const hasInvalidBaseline =
      !Number.isFinite(monthlyOnDemand) ||
      monthlyOnDemand <= 0 ||
      !Number.isFinite(monthly1yr) ||
      !Number.isFinite(monthly3yr);

    return {
      monthlyOnDemand,
      monthly1yr,
      monthly3yr,
      monthlySavings1yr,
      monthlySavings3yr,
      hasInvalidBaseline,
    };
  };

  const toEstimate = (values: {
    monthlyOnDemand: number;
    monthly1yr: number;
    monthly3yr: number;
    monthlySavings1yr: number;
    monthlySavings3yr: number;
  }): SimulatorEstimate => {
    const enriched = enrichSimulatorEstimate(
      values.monthlyOnDemand,
      values.monthly1yr,
      values.monthly3yr,
    );

    return {
      monthlyOnDemand: values.monthlyOnDemand,
      monthly1yr: values.monthly1yr,
      monthly3yr: values.monthly3yr,
      monthlySavings1yr: values.monthlySavings1yr,
      monthlySavings3yr: values.monthlySavings3yr,
      ...enriched,
    };
  };

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = simulatorInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid simulator input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const input = parsed.data satisfies SimulatorInput;
  const catalogError = validateInputAgainstCatalog(input);
  if (catalogError) {
    return NextResponse.json({ error: catalogError }, { status: 400 });
  }

  if (isMockMode()) {
    return NextResponse.json({
      data: generateSimulatorEstimate(input),
      metadata: {
        queriedAt: now,
        isMock: true,
        priceSourceRequested: input.priceSource,
        priceSourceApplied: input.priceSource,
        pricingFallback: "none",
      },
    } satisfies ApiResponse<SimulatorEstimate>);
  }

  const requestedPriceSource: PriceSource = input.priceSource ?? "retail";

  const result = await executeQuery(simulatorEstimateQuery(input));
  const estimateParsed = parseEstimateRow(
    (result.rows[0] ?? {}) as Record<string, unknown>,
  );

  let data: SimulatorEstimate | null = null;
  let priceSourceApplied: PriceSource = requestedPriceSource;
  let pricingFallback: "none" | "contract_to_retail" = "none";
  let pricingNote: string | undefined;

  if (!estimateParsed.hasInvalidBaseline) {
    data = toEstimate(estimateParsed);
  } else if (requestedPriceSource === "contract") {
    const retailInput: SimulatorInput = { ...input, priceSource: "retail" };
    const retailResult = await executeQuery(
      simulatorEstimateQuery(retailInput),
    );
    const retailParsed = parseEstimateRow(
      (retailResult.rows[0] ?? {}) as Record<string, unknown>,
    );

    if (!retailParsed.hasInvalidBaseline) {
      data = toEstimate(retailParsed);
      priceSourceApplied = "retail";
      pricingFallback = "contract_to_retail";
      pricingNote =
        "Contract price was not found in the price sheet for this SKU/region. Retail pricing was used as fallback.";
    }
  }

  if (!data) {
    // No valid ADX pricing for the requested SKU/region combination.
    return NextResponse.json({
      data: generateSimulatorEstimate(input),
      metadata: {
        queriedAt: now,
        isMock: true,
        priceSourceRequested: requestedPriceSource,
        priceSourceApplied,
        pricingFallback,
        pricingNote,
      },
    } satisfies ApiResponse<SimulatorEstimate>);
  }

  return NextResponse.json({
    data,
    metadata: {
      queriedAt: now,
      isMock: false,
      priceSourceRequested: requestedPriceSource,
      priceSourceApplied,
      pricingFallback,
      pricingNote,
    },
  } satisfies ApiResponse<SimulatorEstimate>);
}
