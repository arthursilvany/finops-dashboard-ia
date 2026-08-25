"use client";

import {
  useBudgetBurnRate,
  useBudgetVsActual,
  useBudgetBySubscription,
  useForecastConfidence,
} from "@/hooks/useBudgets";
import { KpiCard } from "@/components/KpiCard";
import { ChartCard } from "@/components/ChartCard";
import { GaugeChart } from "@/components/GaugeChart";
import { AreaChart } from "@/components/AreaChart";
import { BandChart } from "@/components/BandChart";
import { DataTable } from "@/components/DataTable";
import { LoadingSkeleton, ErrorCard } from "@/components/StatusCards";
import { FilterBar } from "@/components/FilterBar";
import type { BudgetBySubscription } from "@/lib/types";

const MONTHLY_BUDGET = 300_000;

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export default function BudgetsPage() {
  const burn = useBudgetBurnRate(MONTHLY_BUDGET);
  const vsActual = useBudgetVsActual(MONTHLY_BUDGET);
  const bySub = useBudgetBySubscription(MONTHLY_BUDGET);
  const forecast = useForecastConfidence();

  // True when the response comes from the customer POC tier (no budget in export).
  const noBudget = burn.data?.status === "NO_BUDGET";

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-white">Budget Tracking</h1>
      <FilterBar />

      {/* KPI Row */}
      {burn.error ? (
        <ErrorCard
          message="Failed to load burn rate"
          onRetry={() => burn.mutate()}
        />
      ) : !burn.data ? (
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <LoadingSkeleton key={i} rows={1} height={80} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-4">
          <KpiCard
            title="Spent So Far"
            value={fmt(burn.data.spentSoFar)}
            subtitle={
              noBudget
                ? "No budget defined"
                : `${burn.data.budgetUsedPercent.toFixed(1)}% of budget`
            }
          />
          <KpiCard
            title="Daily Burn Rate"
            value={fmt(burn.data.dailyBurnRate)}
          />
          <KpiCard
            title="Projected Month-End"
            value={fmt(burn.data.projectedMonthEnd)}
            subtitle={
              noBudget
                ? "Run-rate projection"
                : burn.data.status === "AT_RISK"
                  ? "⚠️ Over budget"
                  : "✅ On track"
            }
          />
          <KpiCard
            title="Budget Variance"
            value={noBudget ? "—" : fmt(Math.abs(burn.data.budgetVariance))}
            subtitle={
              noBudget
                ? "No budget defined"
                : burn.data.budgetVariance > 0
                  ? "over budget"
                  : "under budget"
            }
          />
        </div>
      )}

      {/* Budget Gauge + Budget vs Actual Line */}
      <div className="grid grid-cols-3 gap-4">
        <ChartCard title="Budget Utilization">
          {burn.error ? (
            <ErrorCard message="Failed to load" onRetry={() => burn.mutate()} />
          ) : !burn.data ? (
            <LoadingSkeleton height={200} />
          ) : noBudget ? (
            <div className="flex h-[200px] flex-col items-center justify-center gap-2 text-slate-400">
              <span className="text-4xl">—</span>
              <span className="text-sm">No budget defined</span>
            </div>
          ) : (
            <GaugeChart
              value={burn.data.budgetUsedPercent}
              title="Used"
              color={
                burn.data.budgetUsedPercent > 90
                  ? "#f87171"
                  : burn.data.budgetUsedPercent > 70
                    ? "#fbbf24"
                    : "#34d399"
              }
            />
          )}
        </ChartCard>

        <div className="col-span-2">
          <ChartCard
            title="Budget vs Actual (MTD)"
            subtitle="Cumulative daily spend"
          >
            {vsActual.error ? (
              <ErrorCard
                message="Failed to load"
                onRetry={() => vsActual.mutate()}
              />
            ) : !vsActual.data ? (
              <LoadingSkeleton height={300} />
            ) : (
              <AreaChart
                categories={vsActual.data.map((d) =>
                  new Date(d.day).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  }),
                )}
                series={[
                  {
                    name: "Actual",
                    data: vsActual.data.map((d) => d.cumulativeActual),
                    color: "#38bdf8",
                  },
                  // Omit the Budget series when every value is 0 — a flat zero
                  // line at the bottom of a real-cost chart looks like a bug
                  // and prompts customers to ask "why is my budget zero?".
                  ...(vsActual.data.every((d) => d.cumulativeBudget === 0)
                    ? []
                    : [
                        {
                          name: "Budget",
                          data: vsActual.data.map((d) => d.cumulativeBudget),
                          color: "#fbbf24",
                          lineStyle: "dashed" as const,
                          areaOpacity: 0,
                        },
                      ]),
                ]}
                height={300}
              />
            )}
          </ChartCard>
        </div>
      </div>

      {/* Forecast with Confidence Bands */}
      <ChartCard
        title="Cost Forecast"
        subtitle="14-day lookback + 30-day projection with confidence bands"
      >
        {forecast.error ? (
          <ErrorCard
            message="Failed to load"
            onRetry={() => forecast.mutate()}
          />
        ) : !forecast.data ? (
          <LoadingSkeleton height={350} />
        ) : (
          <BandChart
            categories={forecast.data.map((d) =>
              new Date(d.day).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              }),
            )}
            actual={forecast.data.map((d) => d.actual)}
            forecast={forecast.data.map((d) => d.forecast)}
            lowerBound={forecast.data.map((d) => d.lowerBound)}
            upperBound={forecast.data.map((d) => d.upperBound)}
            height={350}
          />
        )}
      </ChartCard>

      {/* Budget by Subscription */}
      <ChartCard title="Budget Allocation by Subscription">
        {bySub.error ? (
          <ErrorCard message="Failed to load" onRetry={() => bySub.mutate()} />
        ) : !bySub.data ? (
          <LoadingSkeleton rows={4} height={40} />
        ) : (
          <DataTable<BudgetBySubscription & Record<string, unknown>>
            columns={[
              { key: "subscriptionName", header: "Subscription" },
              {
                key: "cost",
                header: "Cost MTD",
                align: "right",
                format: (v) => fmt(v as number),
              },
              {
                key: "percentOfBudget",
                header: "% of Budget",
                align: "right",
                format: (v) => `${(v as number).toFixed(1)}%`,
              },
            ]}
            data={
              bySub.data as (BudgetBySubscription & Record<string, unknown>)[]
            }
          />
        )}
      </ChartCard>
    </div>
  );
}
