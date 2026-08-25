"use client";

import {
  useCommitmentGap,
  useSavingsSummary,
  useOptimizationActions,
  useIdleResources,
  useEffectiveSavingsRateSummary,
  useEffectiveSavingsRateBreakdown,
} from "@/hooks/useRateOptimization";
import { KpiCard } from "@/components/KpiCard";
import { ChartCard } from "@/components/ChartCard";
import { GaugeChart } from "@/components/GaugeChart";
import { ColumnChart } from "@/components/ColumnChart";
import { DataTable } from "@/components/DataTable";
import { ImpactBar } from "@/components/ImpactBar";
import { LoadingSkeleton, ErrorCard } from "@/components/StatusCards";
import { FilterBar } from "@/components/FilterBar";
import type {
  OptimizationAction,
  IdleResource,
  EffectiveSavingsRateBreakdownItem,
} from "@/lib/types";

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export default function RateOptimizationPage() {
  const gap = useCommitmentGap();
  const savings = useSavingsSummary();
  const actions = useOptimizationActions();
  const idle = useIdleResources();
  const esrSummary = useEffectiveSavingsRateSummary();
  const esrBreakdown = useEffectiveSavingsRateBreakdown();

  const avgCoverage =
    gap.data && gap.data.length > 0
      ? gap.data.reduce((s, g) => s + g.commitmentCoverage, 0) / gap.data.length
      : 0;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-white">Rate Optimization</h1>
      <FilterBar />

      {/* KPI Row */}
      {savings.error ? (
        <ErrorCard
          message="Failed to load savings"
          onRetry={() => savings.mutate()}
        />
      ) : !savings.data ? (
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <LoadingSkeleton key={i} rows={1} height={80} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          <KpiCard
            title="Idle Resource Savings"
            value={fmt(savings.data.idleResourceSavings)}
            subtitle="measured from usage"
          />
          <KpiCard
            title="Commitment Gap (modeled)"
            value={fmt(savings.data.commitmentGapSavings)}
            subtitle="assumes a 30% discount — needs a price sheet to confirm"
          />
          <KpiCard
            title="Total (incl. modeled)"
            value={fmt(savings.data.totalPotentialSavings)}
            subtitle="per month · not a quoted figure"
          />
        </div>
      )}

      {/* Commitment Gap Coverage Gauge + Breakdown Bar Chart */}
      <div className="grid grid-cols-3 gap-4">
        <ChartCard title="Commitment Coverage" subtitle="Avg. across services">
          {gap.error ? (
            <ErrorCard message="Failed to load" onRetry={() => gap.mutate()} />
          ) : !gap.data ? (
            <LoadingSkeleton height={200} />
          ) : (
            <GaugeChart
              value={avgCoverage}
              title="Coverage"
              color={
                avgCoverage > 60
                  ? "#34d399"
                  : avgCoverage > 30
                    ? "#fbbf24"
                    : "#f87171"
              }
            />
          )}
        </ChartCard>

        <div className="col-span-2">
          <ChartCard
            title="Commitment Gap by Service"
            subtitle="On-Demand vs Committed"
          >
            {gap.error ? (
              <ErrorCard
                message="Failed to load"
                onRetry={() => gap.mutate()}
              />
            ) : !gap.data ? (
              <LoadingSkeleton height={300} />
            ) : (
              <ColumnChart
                categories={gap.data.map((g) => g.service)}
                series={[
                  {
                    name: "On-Demand",
                    data: gap.data.map((g) => g.onDemandCost),
                    color: "#f87171",
                  },
                  {
                    name: "Committed",
                    data: gap.data.map((g) => g.committedCost),
                    color: "#34d399",
                  },
                ]}
              />
            )}
          </ChartCard>
        </div>
      </div>

      {/* Top Optimization Actions */}
      <ChartCard
        title="Top Optimization Actions"
        subtitle="Ranked by monthly savings"
      >
        {actions.error ? (
          <ErrorCard
            message="Failed to load"
            onRetry={() => actions.mutate()}
          />
        ) : !actions.data ? (
          <LoadingSkeleton rows={5} height={40} />
        ) : (
          <div className="space-y-3">
            {actions.data.slice(0, 8).map((a, i) => (
              <ImpactBar
                key={i}
                label={
                  a.action.length > 40 ? a.action.slice(0, 40) + "…" : a.action
                }
                value={a.potentialMonthlySavings}
                max={actions.data![0].potentialMonthlySavings}
                color={a.category === "Commitment" ? "#818cf8" : "#fbbf24"}
              />
            ))}
          </div>
        )}
      </ChartCard>

      {/* Idle Resources Table */}
      <ChartCard title="Idle Resources" subtitle="Resources with minimal usage">
        {idle.error ? (
          <ErrorCard message="Failed to load" onRetry={() => idle.mutate()} />
        ) : !idle.data ? (
          <LoadingSkeleton rows={4} height={40} />
        ) : (
          <DataTable<IdleResource & Record<string, unknown>>
            columns={[
              { key: "resourceName", header: "Resource" },
              { key: "consumedService", header: "Service" },
              { key: "subscriptionName", header: "Subscription" },
              {
                key: "monthlyCost",
                header: "Monthly Cost",
                align: "right",
                format: (v) => fmt(v as number),
              },
              { key: "daysActive", header: "Days", align: "right" },
            ]}
            data={idle.data as (IdleResource & Record<string, unknown>)[]}
          />
        )}
      </ChartCard>

      {/* Effective Savings Rate (ESR) */}
      <ChartCard
        title="Effective Savings Rate (ESR)"
        subtitle="Savings ÷ cost without discounts · rows with no baseline (unused commitments, credits) are excluded from both sides"
      >
        {esrSummary.error || esrBreakdown.error ? (
          <ErrorCard
            message="Failed to load ESR"
            onRetry={() => {
              esrSummary.mutate();
              esrBreakdown.mutate();
            }}
          />
        ) : !esrSummary.data || !esrBreakdown.data ? (
          <LoadingSkeleton rows={5} height={46} />
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-5 gap-4">
              <KpiCard
                title="Total Savings"
                value={fmt(esrSummary.data.totalSavings)}
              />
              <KpiCard
                title="Cost Without Discounts"
                value={fmt(esrSummary.data.listCost)}
              />
              <KpiCard
                title="Effective Cost"
                value={fmt(esrSummary.data.effectiveCost)}
              />
              <KpiCard
                title="Effective Savings Rate"
                value={`${esrSummary.data.effectiveSavingsRate.toFixed(2)}%`}
                accentColor="#fbbf24"
              />
              <KpiCard
                title="Unused Commitment"
                value={
                  esrSummary.data.unusedCommitmentCost === null
                    ? "n/a"
                    : fmt(esrSummary.data.unusedCommitmentCost)
                }
                subtitle={
                  esrSummary.data.unusedCommitmentCost === null
                    ? "not reported by this data source"
                    : "waste — excluded from the rate"
                }
                accentColor="#f87171"
              />
            </div>

            <div className="rounded-xl border border-white/10 bg-navy-900/30 p-4 text-slate-300">
              <p className="text-sm text-slate-400">ESR equation</p>
              <p className="mt-1 text-base font-medium text-white">
                {fmt(esrSummary.data.totalSavings)} ÷{" "}
                {fmt(esrSummary.data.listCost)} ={" "}
                <span className="text-amber-300">
                  {esrSummary.data.effectiveSavingsRate.toFixed(2)}%
                </span>
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <ChartCard
                title="ESR Monthly Breakdown"
                subtitle="Savings breakdown by month"
              >
                <DataTable<
                  EffectiveSavingsRateBreakdownItem & Record<string, unknown>
                >
                  columns={[
                    { key: "month", header: "Month" },
                    {
                      key: "listCost",
                      header: "List cost",
                      align: "right",
                      format: (v) => fmt(v as number),
                    },
                    {
                      key: "effectiveCost",
                      header: "Effective cost",
                      align: "right",
                      format: (v) => fmt(v as number),
                    },
                    {
                      key: "savings",
                      header: "Savings",
                      align: "right",
                      format: (v) => fmt(v as number),
                    },
                    {
                      key: "esr",
                      header: "ESR",
                      align: "right",
                      format: (v) => `${(v as number).toFixed(2)}%`,
                    },
                    {
                      key: "unusedCommitmentCost",
                      header: "Unused",
                      align: "right",
                      format: (v) => (v === null ? "n/a" : fmt(v as number)),
                    },
                  ]}
                  data={
                    esrBreakdown.data as (EffectiveSavingsRateBreakdownItem &
                      Record<string, unknown>)[]
                  }
                />
              </ChartCard>

              <ChartCard
                title="ESR Interpretation"
                subtitle="Maturity benchmark"
              >
                <DataTable<Record<string, string>>
                  columns={[
                    { key: "level", header: "Level" },
                    { key: "esr", header: "ESR", align: "center" },
                    { key: "meaning", header: "Interpretation" },
                  ]}
                  data={[
                    {
                      level: "Basic",
                      esr: "< 8%",
                      meaning: "Underutilization or low adoption",
                    },
                    {
                      level: "Good",
                      esr: "8% - 15%",
                      meaning: "Healthy and stable strategy",
                    },
                    {
                      level: "Very good",
                      esr: "15% - 30%",
                      meaning: "Good FinOps maturity",
                    },
                    {
                      level: "Excelente",
                      esr: "> 30%",
                      meaning: "Advanced optimization",
                    },
                  ]}
                />
              </ChartCard>
            </div>
          </div>
        )}
      </ChartCard>
    </div>
  );
}
