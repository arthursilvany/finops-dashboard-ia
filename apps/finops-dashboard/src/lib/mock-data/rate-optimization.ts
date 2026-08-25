import type {
  CommitmentGapItem,
  SavingsSummary,
  OptimizationAction,
  IdleResource,
  EffectiveSavingsRateSummary,
  EffectiveSavingsRateBreakdownItem,
} from "../types";

export const mockCommitmentGap: CommitmentGapItem[] = [
  {
    service: "Virtual Machines",
    onDemandCost: 52140.0,
    committedCost: 46280.0,
    commitmentCoverage: 47.0,
    potentialSavings: 15642.0,
  },
  {
    service: "SQL Database",
    onDemandCost: 28950.0,
    committedCost: 22874.5,
    commitmentCoverage: 44.1,
    potentialSavings: 8685.0,
  },
  {
    service: "Cosmos DB",
    onDemandCost: 14230.0,
    committedCost: 2000.8,
    commitmentCoverage: 12.3,
    potentialSavings: 4269.0,
  },
  {
    service: "App Service",
    onDemandCost: 12800.0,
    committedCost: 15105.5,
    commitmentCoverage: 54.1,
    potentialSavings: 3840.0,
  },
  {
    service: "Redis Cache",
    onDemandCost: 8920.0,
    committedCost: 1900.5,
    commitmentCoverage: 17.6,
    potentialSavings: 2676.0,
  },
  {
    service: "Storage",
    onDemandCost: 6540.0,
    committedCost: 27914.8,
    commitmentCoverage: 81.0,
    potentialSavings: 1962.0,
  },
  {
    service: "Kubernetes Service",
    onDemandCost: 5200.0,
    committedCost: 18719.0,
    commitmentCoverage: 78.3,
    potentialSavings: 1560.0,
  },
];

export const mockSavingsSummary: SavingsSummary = {
  commitmentGapSavings: 38634.0,
  idleResourceSavings: 4820.5,
  totalPotentialSavings: 43454.5,
};

export const mockOptimizationActions: OptimizationAction[] = [
  {
    action: "Purchase commitment for Virtual Machines",
    category: "Commitment",
    potentialMonthlySavings: 15642.0,
  },
  {
    action: "Purchase commitment for SQL Database",
    category: "Commitment",
    potentialMonthlySavings: 8685.0,
  },
  {
    action: "Purchase commitment for Cosmos DB",
    category: "Commitment",
    potentialMonthlySavings: 4269.0,
  },
  {
    action: "Purchase commitment for App Service",
    category: "Commitment",
    potentialMonthlySavings: 3840.0,
  },
  {
    action: "Purchase commitment for Redis Cache",
    category: "Commitment",
    potentialMonthlySavings: 2676.0,
  },
  {
    action: "Deallocate idle: vm-legacy-api (Virtual Machines)",
    category: "Idle Resource",
    potentialMonthlySavings: 1240.5,
  },
  {
    action: "Purchase commitment for Storage",
    category: "Commitment",
    potentialMonthlySavings: 1962.0,
  },
  {
    action: "Deallocate idle: sql-reporting-old (SQL Database)",
    category: "Idle Resource",
    potentialMonthlySavings: 980.0,
  },
  {
    action: "Deallocate idle: redis-staging-cache (Redis Cache)",
    category: "Idle Resource",
    potentialMonthlySavings: 850.0,
  },
  {
    action: "Deallocate idle: cosmos-test-db (Cosmos DB)",
    category: "Idle Resource",
    potentialMonthlySavings: 720.0,
  },
];

export const mockIdleResources: IdleResource[] = [
  {
    resourceName: "vm-legacy-api",
    consumedService: "Virtual Machines",
    subscriptionName: "Production-Core",
    monthlyCost: 1240.5,
    avgDailyCost: 0.82,
    daysActive: 30,
  },
  {
    resourceName: "sql-reporting-old",
    consumedService: "SQL Database",
    subscriptionName: "Production-Data",
    monthlyCost: 980.0,
    avgDailyCost: 0.65,
    daysActive: 30,
  },
  {
    resourceName: "redis-staging-cache",
    consumedService: "Redis Cache",
    subscriptionName: "Staging",
    monthlyCost: 850.0,
    avgDailyCost: 0.56,
    daysActive: 28,
  },
  {
    resourceName: "cosmos-test-db",
    consumedService: "Cosmos DB",
    subscriptionName: "Development",
    monthlyCost: 720.0,
    avgDailyCost: 0.48,
    daysActive: 30,
  },
  {
    resourceName: "app-demo-site",
    consumedService: "App Service",
    subscriptionName: "Sandbox",
    monthlyCost: 450.0,
    avgDailyCost: 0.3,
    daysActive: 30,
  },
  {
    resourceName: "storage-temp-backup",
    consumedService: "Storage",
    subscriptionName: "Development",
    monthlyCost: 320.0,
    avgDailyCost: 0.21,
    daysActive: 27,
  },
  {
    resourceName: "func-old-processor",
    consumedService: "Azure Functions",
    subscriptionName: "Staging",
    monthlyCost: 260.0,
    avgDailyCost: 0.17,
    daysActive: 25,
  },
];

export const mockEffectiveSavingsRateSummary: EffectiveSavingsRateSummary = {
  totalSavings: 48320.45,
  listCost: 201564.9,
  effectiveCost: 153244.45,
  effectiveSavingsRate: 23.97,
  unusedCommitmentCost: 1240.5,
};

export const mockEffectiveSavingsRateBreakdown: EffectiveSavingsRateBreakdownItem[] =
  [
    {
      month: "2026-04",
      listCost: 201564.9,
      effectiveCost: 153244.45,
      savings: 48320.45,
      esr: 23.97,
      unusedCommitmentCost: 402.1,
    },
    {
      month: "2026-03",
      listCost: 196322.14,
      effectiveCost: 151801.09,
      savings: 44521.05,
      esr: 22.68,
      unusedCommitmentCost: 318.4,
    },
    {
      month: "2026-02",
      listCost: 189120.36,
      effectiveCost: 148994.48,
      savings: 40125.88,
      esr: 21.22,
      unusedCommitmentCost: 289.9,
    },
    {
      month: "2026-01",
      listCost: 182904.82,
      effectiveCost: 147890.14,
      savings: 35014.68,
      esr: 19.14,
      unusedCommitmentCost: 230.1,
    },
  ];
