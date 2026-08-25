export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { isMockMode } from "@/lib/adx-client";
import { getCustomerAssessment } from "@/lib/customer-assessment";
import { getCustomerDataset } from "@/lib/customer-dataset";
import { customerSlugFromCookieHeader } from "@/lib/customer-data/workspace";
import { computeRemediationSummary } from "@/lib/queries/remediation-impact";
import type { ApiResponse, RemediationSummary } from "@/lib/types";

const SUBSCRIPTION_ID =
  process.env.AZURE_SUBSCRIPTION_ID ?? "<SUBSCRIPTION_ID>";

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

function buildCustomerSummary(customerSlug?: string | null): {
  summary: RemediationSummary;
  customerName: string;
} | null {
  const dataset = getCustomerDataset(customerSlug ?? undefined);
  const assessment = getCustomerAssessment(customerSlug);
  if (!dataset || !assessment) return null;

  const recommendationCount = assessment.advisor.filter((row) => {
    const category = normalized(row.category);
    return category === "highavailability" || category === "security";
  }).length;

  return {
    summary: {
      totalSavingsMonthly: 0,
      totalSavingsAnnual: 0,
      reliabilityCostMonthly: 0,
      reliabilityCostAnnual: 0,
      reliabilitySources: [],
      securityCostMonthly: 0,
      securityCostAnnual: 0,
      securitySources: [],
      totalRemediationMonthly: 0,
      totalRemediationAnnual: 0,
      netImpactMonthly: 0,
      netImpactAnnual: 0,
      zeroCostCount: recommendationCount,
      currency: dataset.manifest.currencies[0] ?? "USD",
    },
    customerName: dataset.manifest.customer,
  };
}

export async function GET(request?: Request) {
  const queriedAt = new Date().toISOString();
  const customer = isMockMode()
    ? buildCustomerSummary(
        customerSlugFromCookieHeader(request?.headers.get("cookie")),
      )
    : null;

  if (customer) {
    const body: ApiResponse<RemediationSummary> & { ok: boolean } = {
      ok: true,
      data: customer.summary,
      metadata: {
        queriedAt,
        isMock: false,
        dataSource: "customer",
        customerName: customer.customerName,
      },
    };
    return NextResponse.json(body, {
      headers: { "Cache-Control": "private, max-age=3600" },
    });
  }

  try {
    const summary: RemediationSummary = await computeRemediationSummary([
      SUBSCRIPTION_ID,
    ]);

    const body: ApiResponse<RemediationSummary> & { ok: boolean } = {
      ok: true,
      data: summary,
      metadata: { queriedAt, isMock: false },
    };
    return NextResponse.json(body, {
      headers: { "Cache-Control": "private, max-age=3600" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[remediation-summary] Error:", message);
    return NextResponse.json(
      { ok: false, error: message, data: null },
      { status: 500 },
    );
  }
}
