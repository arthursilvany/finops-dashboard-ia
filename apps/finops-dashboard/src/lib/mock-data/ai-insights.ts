import type { AiInsight, AiInsightsCost, AiRadarDataset } from "@/lib/types";
import type { ApiResponse } from "@/lib/types";

export const mockAiInsights: ApiResponse<AiInsight[]> = {
  data: [
    {
      id: "ins-001",
      title: "Persistent Rightsizing Opportunity",
      summary:
        "23 virtual machines have maintained CPU utilisation below 20% for the past 30 days. Downgrading to the recommended SKU would save an estimated R$18,400/month with no workload impact.",
      impact: "high",
      category: "Rightsizing",
      savingsEstimate: 18400,
    },
    {
      id: "ins-002",
      title: "Storage Account Public Access Enabled",
      summary:
        "4 storage accounts have public blob access enabled. This violates governance policy P-SEC-004 and should be remediated immediately to prevent data exposure.",
      impact: "high",
      category: "Governance",
    },
    {
      id: "ins-003",
      title: "Reservation Coverage Below Target",
      summary:
        "Reservation coverage is at 73%, below the 80% target. Purchasing 1-year reservations for consistent SQL and VM workloads could yield an additional R$6,200/month in savings.",
      impact: "medium",
      category: "Commitments",
      savingsEstimate: 6200,
    },
    {
      id: "ins-004",
      title: "Staging Environment Cost Spike",
      summary:
        "Staging subscription spent 14% above budget in December. Analysis shows 3 long-running load-test clusters were not decommissioned. Automated shutdown policies are recommended.",
      impact: "medium",
      category: "Anomaly",
    },
    {
      id: "ins-005",
      title: "Tag Compliance Improving",
      summary:
        "Overall tag compliance increased from 63% to 71% over the last 60 days after applying the Azure Policy initiative. Development subscription still below threshold at 52%.",
      impact: "low",
      category: "Governance",
    },
  ],
  metadata: { queriedAt: new Date().toISOString(), isMock: true },
};

export const mockAiInsightsCost: ApiResponse<AiInsightsCost> = {
  data: {
    categories: [
      "Aug/24",
      "Sep/24",
      "Oct/24",
      "Nov/24",
      "Dec/24",
      "Jan/25",
      "Feb/25",
      "Mar/25",
    ],
    actual: [180000, 192000, 208000, 224000, 236000, 242000, null, null],
    forecast: [180000, 192000, 208000, 224000, 236000, 242000, 251000, 258000],
    lowerBound: [
      175000, 186000, 201000, 217000, 228000, 234000, 240000, 244000,
    ],
    upperBound: [
      185000, 198000, 215000, 231000, 244000, 250000, 262000, 272000,
    ],
  },
  metadata: { queriedAt: new Date().toISOString(), isMock: true },
};

export const mockAiRadar: ApiResponse<AiRadarDataset> = {
  data: {
    indicators: [
      { name: "Cost Optimization", max: 100 },
      { name: "Reliability", max: 100 },
      { name: "Security", max: 100 },
      { name: "Operational Excellence", max: 100 },
      { name: "Performance Efficiency", max: 100 },
    ],
    series: [
      {
        name: "Current",
        values: [62, 78, 71, 80, 60],
        color: "#38bdf8",
      },
      {
        name: "Target",
        values: [80, 85, 90, 85, 80],
        color: "#818cf8",
      },
    ],
  },
  metadata: { queriedAt: new Date().toISOString(), isMock: true },
};

export const mockFinOpsRadar: ApiResponse<AiRadarDataset> = {
  data: {
    indicators: [
      { name: "Visibility", max: 100 },
      { name: "Allocation", max: 100 },
      { name: "Rate Optim.", max: 100 },
      { name: "Workload Optim.", max: 100 },
      { name: "Governance", max: 100 },
      { name: "Forecast", max: 100 },
    ],
    series: [
      {
        name: "Current",
        values: [72, 65, 40, 58, 75, 68],
        color: "#38bdf8",
      },
      {
        name: "Benchmark",
        values: [85, 80, 75, 70, 80, 72],
        color: "#a78bfa",
      },
    ],
  },
  metadata: { queriedAt: new Date().toISOString(), isMock: true },
};
