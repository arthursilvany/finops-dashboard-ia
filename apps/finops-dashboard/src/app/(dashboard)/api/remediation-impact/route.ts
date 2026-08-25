export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { isMockMode } from "@/lib/adx-client";
import { getCustomerAssessment } from "@/lib/customer-assessment";
import { getCustomerDataset } from "@/lib/customer-dataset";
import { customerSlugFromCookieHeader } from "@/lib/customer-data/workspace";
import { computeRemediationCards } from "@/lib/queries/remediation-impact";
import { parseResourceId } from "@/lib/resource-graph-client";
import type {
  ApiResponse,
  RemediationCard,
} from "@/lib/types";

const SUBSCRIPTION_ID =
  process.env.AZURE_SUBSCRIPTION_ID ?? "<SUBSCRIPTION_ID>";

const RESOURCE_TYPE_LABELS: Record<string, string> = {
  "microsoft.compute/virtualmachines": "Virtual Machine",
  "microsoft.network/loadbalancers": "Load Balancer",
  "microsoft.network/applicationgateways": "Application Gateway",
  "microsoft.sql/servers/databases": "SQL Database",
  "microsoft.storage/storageaccounts": "Storage Account",
  "microsoft.web/sites": "App Service",
  "microsoft.keyvault/vaults": "Key Vault",
  "microsoft.network/virtualnetworkgateways": "VPN Gateway",
  "microsoft.network/publicipaddresses": "Public IP",
  "microsoft.containerservice/managedclusters": "AKS Cluster",
};

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

function friendlyResourceType(raw: string): string {
  const key = normalized(raw);
  return RESOURCE_TYPE_LABELS[key] ?? raw.split("/").pop() ?? raw;
}

function toImpact(value: string): RemediationCard["impact"] {
  const normalizedImpact = normalized(value);
  if (normalizedImpact === "high") return "high";
  if (normalizedImpact === "low") return "low";
  return "medium";
}

function buildTags(category: RemediationCard["category"], impact: string): string[] {
  const tags = [category === "Security" ? "SECURITY" : "RELIABILITY"];
  if (category === "Reliability") tags.push("HIGH AVAILABILITY");
  if (normalized(impact) === "high") tags.unshift("CRITICAL");
  return tags;
}

function buildFactTags(properties: Record<string, string>): string[] {
  const factTags: string[] = [];
  const environment = properties.Environment ?? properties.environment ?? "";
  const sku = properties.sku ?? properties.Sku ?? "";
  if (environment) factTags.push(`tag Environment=${environment}`);
  if (sku) factTags.push(`SKU ${sku}`);
  return factTags;
}

function buildCustomerCards(customerSlug?: string | null): {
  cards: RemediationCard[];
  customerName: string;
} | null {
  const dataset = getCustomerDataset(customerSlug ?? undefined);
  const assessment = getCustomerAssessment(customerSlug);
  if (!dataset || !assessment) return null;

  const resources = new Map(
    assessment.resources.map((resource) => [normalized(resource.id), resource]),
  );
  const relevant = assessment.advisor
    .filter((row) => {
      const category = normalized(row.category);
      return category === "highavailability" || category === "security";
    })
    .sort((a, b) => {
      const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
      return (order[normalized(a.impact)] ?? 3) - (order[normalized(b.impact)] ?? 3);
    });

  const cards = relevant.slice(0, 5).map((row) => {
    const resource = resources.get(normalized(row.resourceId));
    const parsed = parseResourceId(row.resourceId);
    const category: RemediationCard["category"] =
      normalized(row.category) === "security" ? "Security" : "Reliability";
    return {
      id: row.id,
      resourceType: friendlyResourceType(row.resourceType || resource?.type || ""),
      resourceName: resource?.name ?? parsed.resourceName,
      resourceGroup: resource?.resourceGroup ?? parsed.resourceGroup,
      region:
        resource?.location ??
        row.extendedProperties.region ??
        row.extendedProperties.location ??
        "—",
      recommendation: row.title,
      description: row.description,
      category,
      impact: toImpact(row.impact),
      tags: buildTags(category, row.impact),
      factTags: buildFactTags(row.extendedProperties),
      aiInsight: null,
      remediationCostMonthly: 0,
      remediationCostAnnual: 0,
      advisorOffsetMonthly: 0,
      advisorOffsetAnnual: 0,
      netMonthly: 0,
      costSource: "estimate",
    } satisfies RemediationCard;
  });

  return {
    cards,
    customerName: dataset.manifest.customer,
  };
}

export async function GET(request?: Request) {
  const queriedAt = new Date().toISOString();
  const customer = isMockMode()
    ? buildCustomerCards(
        customerSlugFromCookieHeader(request?.headers.get("cookie")),
      )
    : null;

  if (customer) {
    const body: ApiResponse<RemediationCard[]> & { ok: boolean } = {
      ok: true,
      data: customer.cards,
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
    const cards: RemediationCard[] = await computeRemediationCards([
      SUBSCRIPTION_ID,
    ]);

    const body: ApiResponse<RemediationCard[]> & { ok: boolean } = {
      ok: true,
      data: cards,
      metadata: { queriedAt, isMock: false },
    };
    return NextResponse.json(body, {
      headers: { "Cache-Control": "private, max-age=3600" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[remediation-impact] Error:", message);
    return NextResponse.json(
      { ok: false, error: message, data: [] },
      { status: 500 },
    );
  }
}
