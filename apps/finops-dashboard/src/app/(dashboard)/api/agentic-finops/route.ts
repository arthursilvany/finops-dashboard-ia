export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { isMockMode } from "@/lib/adx-client";
import { getCustomerDataset } from "@/lib/customer-dataset";
import { aggregateCustomerAgentic } from "@/lib/customer-operational-aggregations";
import { customerSlugFromCookieHeader } from "@/lib/customer-data/workspace";
import { queryAdvisorCostAgentic } from "@/lib/resource-graph-client";
import type {
  AgenticRecommendation,
  AgenticSummary,
  AgenticStage,
  ApiResponse,
} from "@/lib/types";

const SUBSCRIPTION_ID =
  process.env.AZURE_SUBSCRIPTION_ID ?? "<SUBSCRIPTION_ID>";

function buildSummary(recs: AgenticRecommendation[]): AgenticSummary {
  const byRisk = { low: 0, medium: 0, high: 0 };
  const byCategory: Record<string, number> = {};
  const byStage: Record<AgenticStage, number> = {
    detect: 0,
    analyze: 0,
    decide: 0,
    ready: 0,
    "pending-approval": 0,
  };
  let totalSavings = 0;
  let readyForAction = 0;
  let pendingApproval = 0;

  for (const r of recs) {
    byRisk[r.riskLevel]++;
    byCategory[r.recommendationCategory] =
      (byCategory[r.recommendationCategory] ?? 0) + 1;
    byStage[r.agenticStage]++;
    totalSavings += r.potentialSavings;
    if (r.agenticStage === "ready") readyForAction++;
    if (r.requiresApproval) pendingApproval++;
  }

  return {
    totalRecommendations: recs.length,
    totalPotentialSavings: totalSavings,
    readyForAction,
    pendingApproval,
    byRisk,
    byCategory,
    byStage,
  };
}

function getMockData(): AgenticRecommendation[] {
  return [
    {
      id: "mock-1",
      resourceId:
        "/subscriptions/xxx/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-web-01",
      resourceName: "vm-web-01",
      resourceType: "Microsoft.Compute/virtualMachines",
      resourceGroup: "rg-prod",
      subscriptionName: "Production",
      impact: "high",
      title: "Right-size underutilized virtual machine",
      description:
        "CPU utilization averaging 5% over 14 days. Consider downsizing to a smaller SKU.",
      solution: "Resize from Standard_D4s_v3 to Standard_D2s_v3",
      potentialSavings: 4800,
      agenticStage: "ready",
      riskLevel: "low",
      confidenceScore: 0.92,
      requiresApproval: false,
      actionType: "RIGHTSIZE_VM",
      recommendationCategory: "Rightsizing",
    },
    {
      id: "mock-2",
      resourceId:
        "/subscriptions/xxx/resourceGroups/rg-dev/providers/Microsoft.Compute/virtualMachines/vm-test-03",
      resourceName: "vm-test-03",
      resourceType: "Microsoft.Compute/virtualMachines",
      resourceGroup: "rg-dev",
      subscriptionName: "Development",
      impact: "medium",
      title: "Shut down idle virtual machine",
      description: "VM has been running with no connections for 21 days.",
      solution: "Deallocate or delete the virtual machine",
      potentialSavings: 2400,
      agenticStage: "ready",
      riskLevel: "low",
      confidenceScore: 0.95,
      requiresApproval: false,
      actionType: "STOP_VM",
      recommendationCategory: "Idle Resources",
    },
    {
      id: "mock-3",
      resourceId:
        "/subscriptions/xxx/resourceGroups/rg-prod/providers/Microsoft.Sql/servers/sql-main/databases/db-analytics",
      resourceName: "db-analytics",
      resourceType: "Microsoft.Sql/servers/databases",
      resourceGroup: "rg-prod",
      subscriptionName: "Production",
      impact: "high",
      title: "Change SQL Database SKU to optimize cost",
      description:
        "Database DTU utilization is consistently below 20%. Consider downgrading tier.",
      solution: "Change from S3 (100 DTU) to S1 (20 DTU)",
      potentialSavings: 8500,
      agenticStage: "pending-approval",
      riskLevel: "high",
      confidenceScore: 0.72,
      requiresApproval: true,
      actionType: "CHANGE_SKU",
      recommendationCategory: "SKU Optimization",
    },
    {
      id: "mock-4",
      resourceId:
        "/subscriptions/xxx/resourceGroups/rg-prod/providers/Microsoft.Compute/disks/disk-orphan-01",
      resourceName: "disk-orphan-01",
      resourceType: "Microsoft.Compute/disks",
      resourceGroup: "rg-prod",
      subscriptionName: "Production",
      impact: "low",
      title: "Delete unattached managed disk",
      description:
        "Disk has been unattached for 45 days with no associated VM.",
      solution: "Delete the orphaned disk or attach to an active VM",
      potentialSavings: 720,
      agenticStage: "ready",
      riskLevel: "low",
      confidenceScore: 0.88,
      requiresApproval: false,
      actionType: "DELETE_ORPHAN",
      recommendationCategory: "Orphaned Resources",
    },
    {
      id: "mock-5",
      resourceId:
        "/subscriptions/xxx/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines",
      resourceName: "Production VMs",
      resourceType: "Microsoft.Compute/virtualMachines",
      resourceGroup: "rg-prod",
      subscriptionName: "Production",
      impact: "high",
      title: "Purchase Reserved Instances for stable workloads",
      description:
        "12 VMs running 24/7 for 90+ days. Reserved Instance pricing would save significantly.",
      solution: "Buy 1-year RI for Standard_D4s_v3 (12 instances)",
      potentialSavings: 28000,
      agenticStage: "pending-approval",
      riskLevel: "high",
      confidenceScore: 0.68,
      requiresApproval: true,
      actionType: "BUY_RESERVATION",
      recommendationCategory: "Commitment Discount",
    },
    {
      id: "mock-6",
      resourceId:
        "/subscriptions/xxx/resourceGroups/rg-staging/providers/Microsoft.Compute/virtualMachines/vm-staging-api",
      resourceName: "vm-staging-api",
      resourceType: "Microsoft.Compute/virtualMachines",
      resourceGroup: "rg-staging",
      subscriptionName: "Staging",
      impact: "medium",
      title: "Right-size virtual machine based on usage",
      description: "CPU utilization averaging 12% over 30 days.",
      solution: "Resize from Standard_E4s_v3 to Standard_D2s_v3",
      potentialSavings: 3200,
      agenticStage: "analyze",
      riskLevel: "medium",
      confidenceScore: 0.78,
      requiresApproval: false,
      actionType: "RIGHTSIZE_VM",
      recommendationCategory: "Rightsizing",
    },
    {
      id: "mock-7",
      resourceId:
        "/subscriptions/xxx/resourceGroups/rg-dev/providers/Microsoft.Network/publicIPAddresses/pip-unused",
      resourceName: "pip-unused",
      resourceType: "Microsoft.Network/publicIPAddresses",
      resourceGroup: "rg-dev",
      subscriptionName: "Development",
      impact: "low",
      title: "Delete unused public IP address",
      description: "Public IP not associated to any resource for 60 days.",
      solution: "Delete the orphaned public IP address",
      potentialSavings: 180,
      agenticStage: "ready",
      riskLevel: "low",
      confidenceScore: 0.96,
      requiresApproval: false,
      actionType: "DELETE_ORPHAN",
      recommendationCategory: "Orphaned Resources",
    },
    {
      id: "mock-8",
      resourceId:
        "/subscriptions/xxx/resourceGroups/rg-prod/providers/Microsoft.Storage/storageAccounts/stprodlogs",
      resourceName: "stprodlogs",
      resourceType: "Microsoft.Storage/storageAccounts",
      resourceGroup: "rg-prod",
      subscriptionName: "Production",
      impact: "medium",
      title: "Optimize storage account access tier",
      description:
        "80% of blobs not accessed in 90 days. Move to Cool or Archive tier.",
      solution:
        "Enable lifecycle management policy to move to Cool tier after 30 days",
      potentialSavings: 1500,
      agenticStage: "decide",
      riskLevel: "medium",
      confidenceScore: 0.82,
      requiresApproval: true,
      actionType: "CHANGE_SKU",
      recommendationCategory: "SKU Optimization",
    },
  ];
}

export async function GET(request?: Request) {
  const queriedAt = new Date().toISOString();

  try {
    if (isMockMode()) {
      const customerSlug = customerSlugFromCookieHeader(
        request?.headers.get("cookie"),
      );
      const customerDataset = getCustomerDataset(customerSlug ?? undefined);
      const customer = aggregateCustomerAgentic(customerSlug);
      if (customerDataset && customer) {
        const body: ApiResponse<{
          recommendations: AgenticRecommendation[];
          summary: AgenticSummary;
        }> & { ok: boolean } = {
          ok: true,
          data: customer,
          metadata: {
            queriedAt,
            isMock: false,
            dataSource: "customer",
            customerName: customerDataset.manifest.customer,
          },
        };
        return NextResponse.json(
          body,
          { headers: { "Cache-Control": "private, max-age=3600" } },
        );
      }
    }

    let recommendations: AgenticRecommendation[];
    let isMock = false;

    if (isMockMode()) {
      recommendations = getMockData();
      isMock = true;
    } else {
      try {
        recommendations = await queryAdvisorCostAgentic([SUBSCRIPTION_ID]);
      } catch {
        console.warn(
          "[agentic-finops] Resource Graph unavailable, using mock data",
        );
        recommendations = getMockData();
        isMock = true;
      }

      if (recommendations.length === 0) {
        recommendations = getMockData();
        isMock = true;
      }
    }

    const summary = buildSummary(recommendations);
    const body: ApiResponse<{
      recommendations: AgenticRecommendation[];
      summary: AgenticSummary;
    }> & { ok: boolean } = {
      ok: true,
      data: { recommendations, summary },
      metadata: { queriedAt, isMock },
    };

    return NextResponse.json(
      body,
      { headers: { "Cache-Control": "private, max-age=3600" } },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[agentic-finops] Error:", message);
    return NextResponse.json(
      {
        ok: false,
        error: message,
        data: { recommendations: [], summary: null },
      },
      { status: 500 },
    );
  }
}
