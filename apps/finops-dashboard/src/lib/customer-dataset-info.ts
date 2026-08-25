import { NextResponse } from "next/server";

import { getCustomerDataset } from "./customer-dataset";
import { customerSlugFromCookieHeader } from "./customer-data/workspace";

/**
 * Routes that are backed by the customer's Cost Export. Anything not listed
 * here still renders sample data when a customer dataset is loaded, and the UI
 * must say so — presenting demo numbers as the customer's own in a commercial
 * meeting is not acceptable.
 */
export const CUSTOMER_COVERED_PAGES = [
  "/cost-summary",
  "/rate-optimization",
  "/governance",
  "/chargeback",
  "/anomalies",
] as const;

/**
 * Pages whose costs come from the customer's export, but where some individual
 * fields cannot be derived from a Cost Export and are shown as zero/blank.
 *
 * These are deliberately NOT listed as fully covered: every figure on them is
 * real, yet a viewer would reasonably assume the missing fields were measured
 * too. The caveat is surfaced verbatim in the UI so nobody has to guess which
 * half of the page is trustworthy.
 */
export const CUSTOMER_PARTIAL_PAGES: Record<string, string> = {
  "/ai-insights":
    "The insights, the cost chart and the FinOps radar are computed from the customer's " +
    "real spend. The Well-Architected radar and AI Action Narrative require the separately " +
    "provided Advisor and Resource Graph exports and remain snapshot-based assessments.",
  "/budgets":
    "Costs, burn rate and the run-rate projection are the customer's real spend. " +
    "Budget targets are not part of a Cost Export — they live in Azure Cost Management — " +
    "so no budget line, variance or percent-consumed is shown.",
  "/reservation-detail":
    "Commitment usage, unused cost, utilization and term are the customer's real figures. " +
    "Upfront payment is absent from an amortized export, and the filter list is not a " +
    "purchase recommendation — those require Azure Advisor.",
  "/ai-costs":
    "AI service costs are the customer's real spend. The model breakdown is inferred from " +
    "meter names, since a Cost Export has no model column, and token counts are not billed data.",
  "/daily-insights":
    "The report is written by the model from the customer's real spend, and is dated by the " +
    "export period rather than today. Budget tracking is omitted — a Cost Export carries no " +
    "budget — and the Well-Architected tips are general guidance, not findings from this tenant.",
};
/**
 * Pages that a Cost Export cannot feed, because they need Azure Advisor
 * recommendations, the price sheet, or platform telemetry.
 */
export const CUSTOMER_SAMPLE_ONLY_PAGES = [
  "/workload",
  "/cost-simulator",
  "/azure-pricing",
  "/agentic-finops",
  // The SKU Advisor view is fed by the advisor's own export or its live
  // service, never by a Cost Export. Its provenance badge names the source it
  // actually used.
  "/sku-advisor",
] as const;

/**
 * Pages built on Azure-only concepts. They render real customer data, but only
 * the Azure share of it: Azure Retail Prices, ARM resource ids, Advisor and
 * Resource Graph have no AWS counterpart in the dataset.
 *
 * On a multicloud dataset these pages therefore describe a *subset* of the
 * spend. Left unsaid, a viewer reads the page total as the whole bill and the
 * AWS spend simply disappears — the page looks complete and is quietly wrong.
 *
 * Listing a page here is a claim the data layer has to honour: the routes
 * behind these pages serve the customer tier through `azureOnlyDataResponse`,
 * which pins the provider filter to Azure. Adding a page to this list without
 * that wiring produces the worst possible outcome — a mixed-cloud total
 * captioned "Azure only".
 *
 * Sample-only pages (`/azure-pricing`) are deliberately absent: they show no
 * customer rows at all, so "excludes AWS (N rows)" would imply a real total had
 * been filtered. Their existing "sample data" banner is the stronger statement.
 */
export const AZURE_ONLY_PAGES = [
  "/reservation-detail",
  "/ai-insights",
] as const;

export interface CustomerDatasetInfo {
  customer: string;
  format: string;
  rowCount: number;
  periodStart: string | null;
  periodEnd: string | null;
  currencies: string[];
  /** Cloud providers present in the dataset ("Azure", "AWS", ...). */
  providers: string[];
  /** Row count per provider, used to size the Azure-only caveat. */
  rowCountByProvider: Record<string, number>;
  warnings: string[];
  coveredPages: string[];
  partialPages: Array<{ page: string; caveat: string }>;
  sampleOnlyPages: string[];
  azureOnlyPages: string[];
}

/** Describes the loaded customer dataset for the UI, or null when there is none. */
export function getCustomerDatasetInfo(
  customerSlug?: string | null,
): CustomerDatasetInfo | null {
  const dataset = getCustomerDataset(customerSlug ?? undefined);
  if (!dataset) return null;

  const { manifest } = dataset;
  const partialPages = { ...CUSTOMER_PARTIAL_PAGES };
  if (
    manifest.assessmentEvidence?.resourceGraph.status === "available" &&
    manifest.assessmentEvidence.advisor.status === "available"
  ) {
    partialPages["/ai-insights"] =
      "The spend insights and FinOps radar use the customer's Cost Export. The " +
      "Well-Architected radar uses the Advisor export, and the AI Action Narrative uses " +
      "sanitized aggregates from Cost, Resource Graph and Advisor snapshots. Runtime " +
      "telemetry and a complete architectural review remain outside this assessment.";
  }
  return {
    customer: manifest.customer,
    format: manifest.format,
    rowCount: manifest.rowCount,
    periodStart: manifest.periodStart,
    periodEnd: manifest.periodEnd,
    currencies: manifest.currencies,
    providers: manifest.providers ?? [],
    rowCountByProvider: (manifest.rowCountByProvider ?? {}) as Record<string, number>,
    warnings: manifest.warnings,
    coveredPages: [...CUSTOMER_COVERED_PAGES],
    partialPages: Object.keys(partialPages).map((page) => ({
      page,
      caveat: partialPages[page],
    })),
    sampleOnlyPages: [...CUSTOMER_SAMPLE_ONLY_PAGES],
    azureOnlyPages: [...AZURE_ONLY_PAGES],
  };
}

export function getCustomerDatasetInfoForRequest(
  request: Pick<Request, "headers">,
): CustomerDatasetInfo | null {
  return getCustomerDatasetInfo(
    customerSlugFromCookieHeader(request.headers.get("cookie")),
  );
}

/** Convenience wrapper so route handlers can stay one-liners. */
export function customerDatasetInfoResponse(): NextResponse {
  return NextResponse.json(getCustomerDatasetInfo());
}
