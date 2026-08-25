import { executeQuery } from "@/lib/adx-client";
import { governanceKpiKql } from "@/lib/queries/governance";
import { chargebackKpiKql } from "@/lib/queries/chargeback";
import { commitmentGap } from "@/lib/queries/rate-optimization";
import { budgetBurnRate } from "@/lib/queries/budgets";
import { workloadKpiKql } from "@/lib/queries/workload";
import type { AiRadarDataset } from "@/lib/types";
import type { ParsedFilters } from "@/lib/filter-schema";

const FINOPS_DOMAINS = [
  "Visibility",
  "Allocation",
  "Rate Optim.",
  "Workload Optim.",
  "Governance",
  "Forecast",
] as const;

const BENCHMARK = [85, 80, 75, 70, 80, 72];

const DEFAULT_BUDGET = Number(process.env.NEXT_PUBLIC_DEFAULT_BUDGET) || 10000;

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}

const emptyFilters: ParsedFilters = {
  dateFrom: "",
  dateTo: "",
  providers: [],
  subscriptions: [],
  regions: [],
  services: [],
  resourceGroups: [],
  tags: [],
  currency: "billing",
};

export async function computeFinOpsRadar(): Promise<AiRadarDataset> {
  const [govResult, chargeResult, rateResult, budgetResult, workloadResult] =
    await Promise.allSettled([
      executeQuery(governanceKpiKql(emptyFilters)),
      executeQuery(chargebackKpiKql(emptyFilters)),
      executeQuery(commitmentGap()),
      executeQuery(budgetBurnRate(DEFAULT_BUDGET)),
      executeQuery(workloadKpiKql(), "Ingestion"),
    ]);

  // 1. Visibility — tag compliance (OverallCompliance %)
  let visibility = 0;
  if (govResult.status === "fulfilled" && govResult.value.rows.length > 0) {
    visibility = clamp(
      Number(govResult.value.rows[0].OverallCompliance) || 0,
    );
  }

  // 2. Allocation — allocated / (allocated + untagged) * 100
  let allocation = 0;
  if (
    chargeResult.status === "fulfilled" &&
    chargeResult.value.rows.length > 0
  ) {
    const row = chargeResult.value.rows[0];
    const total = Number(row.TotalAllocated) + Number(row.UntaggedCost);
    allocation =
      total > 0
        ? clamp(Math.round((Number(row.TotalAllocated) / total) * 100))
        : 0;
  }

  // 3. Rate Optim. — average commitment coverage across services
  let rateOptim = 0;
  if (rateResult.status === "fulfilled" && rateResult.value.rows.length > 0) {
    const rows = rateResult.value.rows;
    const avg =
      rows.reduce((s, r) => s + (Number(r.CommitmentCoverage) || 0), 0) /
      rows.length;
    rateOptim = clamp(Math.round(avg));
  }

  // 4. Workload Optim. — 100 - (potential savings / total cost * 100)
  let workloadOptim = 0;
  if (
    workloadResult.status === "fulfilled" &&
    workloadResult.value.rows.length > 0
  ) {
    const row = workloadResult.value.rows[0];
    const savings = Number(row.potentialMonthlySavings) || 0;
    // Use total cost from chargeback as reference
    let totalCost = 0;
    if (
      chargeResult.status === "fulfilled" &&
      chargeResult.value.rows.length > 0
    ) {
      const cr = chargeResult.value.rows[0];
      totalCost = Number(cr.TotalAllocated) + Number(cr.UntaggedCost);
    }
    workloadOptim =
      totalCost > 0 ? clamp(Math.round(100 - (savings / totalCost) * 100)) : 50;
  }

  // 5. Governance — budget status score
  let governance = 0;
  if (
    budgetResult.status === "fulfilled" &&
    budgetResult.value.rows.length > 0
  ) {
    const status = budgetResult.value.rows[0].Status as string;
    const pct = Number(budgetResult.value.rows[0].BudgetUsedPercent) || 0;
    if (status === "ON_TRACK")
      governance = clamp(Math.round(90 - Math.max(0, pct - 70)));
    else if (status === "AT_RISK")
      governance = clamp(Math.round(60 - Math.max(0, pct - 90)));
    else governance = clamp(Math.round(30 - Math.max(0, pct - 110)));
  }

  // 6. Forecast — accuracy: 100 - abs(budgetVariance / budget * 100)
  let forecast = 0;
  if (
    budgetResult.status === "fulfilled" &&
    budgetResult.value.rows.length > 0
  ) {
    const row = budgetResult.value.rows[0];
    const variance = Number(row.BudgetVariance) || 0;
    const budget = Number(row.Budget) || DEFAULT_BUDGET;
    forecast = clamp(Math.round(100 - Math.abs(variance / budget) * 100));
  }

  const values = [
    visibility,
    allocation,
    rateOptim,
    workloadOptim,
    governance,
    forecast,
  ];

  return {
    indicators: FINOPS_DOMAINS.map((name) => ({ name, max: 100 })),
    series: [
      { name: "Current", values, color: "#38bdf8" },
      { name: "Benchmark", values: BENCHMARK, color: "#a78bfa" },
    ],
  };
}
