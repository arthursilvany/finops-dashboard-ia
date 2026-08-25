import type {
  KpiSummary,
  CostOverTimePoint,
  ServiceBreakdown,
  SubscriptionCost,
  DailyCostPoint,
  CostSummaryKpi,
  MiniKpiGauge,
  PricingModelBreakdown,
  DailyCostByCategory,
  ServiceTrendItem,
} from "../types";

export const mockKpiSummary: KpiSummary = {
  costLastMonth: 284750.32,
  costPreviousMonth: 271200.15,
  changePercent: 4.99,
  dailyAverage: 9491.68,
  topService: "Virtual Machines",
  topServiceCost: 98420.0,
  reservationCoverage: 73,
};

export const mockCostOverTime: CostOverTimePoint[] = [
  { month: "2025-11-01", cost: 245100.5 },
  { month: "2025-12-01", cost: 258340.2 },
  { month: "2026-01-01", cost: 262800.75 },
  { month: "2026-02-01", cost: 271200.15 },
  { month: "2026-03-01", cost: 284750.32 },
  { month: "2026-04-01", cost: 42150.6 },
];

export const mockServiceBreakdown: ServiceBreakdown[] = [
  { service: "Virtual Machines", percentage: 34.6, cost: 98420.0 },
  { service: "SQL Database", percentage: 18.2, cost: 51824.5 },
  { service: "Storage", percentage: 12.1, cost: 34454.8 },
  { service: "App Service", percentage: 9.8, cost: 27905.5 },
  { service: "Kubernetes Service", percentage: 8.4, cost: 23919.0 },
  { service: "Cosmos DB", percentage: 5.7, cost: 16230.8 },
  { service: "Azure Functions", percentage: 4.2, cost: 11959.5 },
  { service: "Redis Cache", percentage: 3.8, cost: 10820.5 },
  { service: "Others", percentage: 3.2, cost: 10215.72 },
];

export const mockSubscriptionCosts: SubscriptionCost[] = [
  { subscriptionName: "Production-Core", cost: 142375.16, percentage: 50.0 },
  { subscriptionName: "Production-Data", cost: 71187.58, percentage: 25.0 },
  { subscriptionName: "Staging", cost: 42712.55, percentage: 15.0 },
  { subscriptionName: "Development", cost: 22780.03, percentage: 8.0 },
  { subscriptionName: "Sandbox", cost: 5695.0, percentage: 2.0 },
];

function generateDailyCosts(days: number): DailyCostPoint[] {
  const result: DailyCostPoint[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const base = 8500 + Math.random() * 3000;
    const weekday = d.getDay();
    const factor = weekday === 0 || weekday === 6 ? 0.7 : 1.0;
    result.push({
      day: d.toISOString().split("T")[0],
      cost: Math.round(base * factor * 100) / 100,
    });
  }
  return result;
}

export const mockDailyCosts: DailyCostPoint[] = generateDailyCosts(28);

// --- Cost Summary v2 mock data ---

export const mockCostSummaryKpi: CostSummaryKpi = {
  totalCost30d: 4217340,
  subscriptionCount: 12,
  resourceCount: 1847,
  momChangePercent: 6.3,
  momChangeDelta: 249800,
  savingsIdentified: 847500,
  savingsRecommendations: 23,
  savingsRealized: 312400,
  savingsActions: 8,
};

export const mockMiniKpis: MiniKpiGauge[] = [
  {
    label: "Commitment Coverage",
    value: 68.2,
    target: 80,
    targetLabel: "Meta: 80%",
    status: "warning",
  },
  {
    label: "Waste Ratio",
    value: 11.4,
    target: 5,
    targetLabel: "Meta: <5%",
    status: "danger",
  },
  {
    label: "Tag Compliance",
    value: 87.3,
    target: 95,
    targetLabel: "Meta: 95%",
    status: "warning",
  },
  {
    label: "Savings Execution Rate",
    value: 44.8,
    target: 75,
    targetLabel: "Meta: 75%",
    status: "danger",
  },
];

export const mockPricingModel: PricingModelBreakdown[] = [
  { model: "On-Demand", cost: 1340000 },
  { model: "Reserved Instances", cost: 1898000 },
  { model: "Savings Plans", cost: 624000 },
  { model: "Spot", cost: 198000 },
  { model: "Marketplace", cost: 157340 },
];

const categoryNames = [
  "Compute",
  "AI/ML",
  "Database",
  "Storage",
  "Network",
  "Others",
];

function generateDailyCostByCategory(days: number): DailyCostByCategory[] {
  const result: DailyCostByCategory[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const weekday = d.getDay();
    const factor = weekday === 0 || weekday === 6 ? 0.72 : 1.0;
    const categories: Record<string, number> = {
      Compute: Math.round((55000 + Math.random() * 12000) * factor),
      "AI/ML": Math.round((28000 + Math.random() * 8000) * factor),
      Database: Math.round((22000 + Math.random() * 5000) * factor),
      Storage: Math.round((12000 + Math.random() * 3000) * factor),
      Network: Math.round((8000 + Math.random() * 2000) * factor),
      Others: Math.round((5000 + Math.random() * 2000) * factor),
    };
    result.push({ day: d.toISOString().split("T")[0], categories });
  }
  return result;
}

export const mockDailyCostByCategory: DailyCostByCategory[] =
  generateDailyCostByCategory(30);

export const mockServiceTrend: ServiceTrendItem[] = [
  { service: "Virtual Machines", cost: 1420000, momPercent: 3.1 },
  { service: "Azure OpenAI", cost: 890000, momPercent: 18.4 },
  { service: "SQL Database", cost: 524000, momPercent: -2.1 },
  { service: "Storage Accounts", cost: 345000, momPercent: 1.8 },
  { service: "Kubernetes Service", cost: 312000, momPercent: 5.2 },
  { service: "Cosmos DB", cost: 287000, momPercent: -0.9 },
  { service: "App Service", cost: 234000, momPercent: 0.4 },
  { service: "Azure Functions", cost: 156000, momPercent: 12.7 },
];
