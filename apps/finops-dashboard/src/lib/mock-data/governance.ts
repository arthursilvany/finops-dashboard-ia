import type {
  GovernanceKpi,
  TagComplianceBar,
  BudgetVsActualBar,
} from "@/lib/types";
import type { ApiResponse } from "@/lib/types";

export const mockGovernanceKpi: ApiResponse<GovernanceKpi> = {
  data: {
    overallCompliance: 71,
    taggedResources: 3124,
    totalResources: 4400,
    policiesActive: 18,
    tagCoverage: [
      { tag: "env", pct: 92, costPct: 94 },
      { tag: "owner", pct: 78, costPct: 81 },
      { tag: "cost-center", pct: 85, costPct: 89 },
    ],
  },
  metadata: { queriedAt: new Date().toISOString(), isMock: true },
};

export const mockTagCompliance: ApiResponse<TagComplianceBar[]> = {
  data: [
    {
      subscriptionName: "Production",
      compliancePct: 88,
      total: 1800,
      tagCoverage: [
        { tag: "env", pct: 97, costPct: 98 },
        { tag: "owner", pct: 91, costPct: 93 },
        { tag: "cost-center", pct: 94, costPct: 96 },
      ],
    },
    {
      subscriptionName: "Staging",
      compliancePct: 74,
      total: 950,
      tagCoverage: [
        { tag: "env", pct: 93, costPct: 94 },
        { tag: "owner", pct: 79, costPct: 82 },
        { tag: "cost-center", pct: 86, costPct: 88 },
      ],
    },
    {
      subscriptionName: "Development",
      compliancePct: 52,
      total: 1100,
      tagCoverage: [
        { tag: "env", pct: 84, costPct: 86 },
        { tag: "owner", pct: 58, costPct: 61 },
        { tag: "cost-center", pct: 71, costPct: 74 },
      ],
    },
    {
      subscriptionName: "Shared Svcs",
      compliancePct: 61,
      total: 550,
      tagCoverage: [
        { tag: "env", pct: 88, costPct: 90 },
        { tag: "owner", pct: 66, costPct: 69 },
        { tag: "cost-center", pct: 77, costPct: 80 },
      ],
    },
  ],
  metadata: { queriedAt: new Date().toISOString(), isMock: true },
};

export const mockBudgetVsActual: ApiResponse<BudgetVsActualBar[]> = {
  data: [
    { subscriptionName: "Production",  budget: 280000, actual: 242000, variance: -38000 },
    { subscriptionName: "Staging",     budget: 80000,  actual: 91200,  variance: 11200  },
    { subscriptionName: "Development", budget: 60000,  actual: 44800,  variance: -15200 },
    { subscriptionName: "Shared Svcs", budget: 40000,  actual: 38600,  variance: -1400  },
  ],
  metadata: { queriedAt: new Date().toISOString(), isMock: true },
};
