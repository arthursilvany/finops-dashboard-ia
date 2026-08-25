"use client";

import { useState } from "react";
import { useAgenticFinOps } from "@/hooks/useAgenticFinOps";
import { useExecutions, useExecutionSavings } from "@/hooks/useExecutions";
import { AgenticRecommendationCard } from "@/components/AgenticRecommendationCard";
import { AgenticLifecycleBanner } from "@/components/AgenticLifecycleBanner";
import { AgenticSummaryCards } from "@/components/AgenticSummaryCards";
import { ChartCard } from "@/components/ChartCard";
import { PieChart } from "@/components/PieChart";
import { ColumnChart } from "@/components/ColumnChart";
import { LoadingSkeleton, ErrorCard } from "@/components/StatusCards";
import type { AgenticRecommendation } from "@/lib/types";

type FilterKey = "all" | "ready" | "pending-approval" | "analyze" | "decide";

const FILTER_OPTIONS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "ready", label: "Ready" },
  { key: "pending-approval", label: "Pending" },
  { key: "analyze", label: "Analyzing" },
  { key: "decide", label: "Decision" },
];

function fmtBRL(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(n);
}

function buildCategoryChartData(recs: AgenticRecommendation[]) {
  const map = new Map<string, number>();
  for (const r of recs) {
    const cat = r.recommendationCategory;
    map.set(cat, (map.get(cat) ?? 0) + r.potentialSavings);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }));
}

function buildRiskChartData(recs: AgenticRecommendation[]) {
  const map = { low: 0, medium: 0, high: 0 };
  for (const r of recs) map[r.riskLevel]++;
  return {
    categories: ["Low", "Medium", "High"],
    series: [
      { name: "Low Risk", data: [map.low, 0, 0], color: "#10b981" },
      { name: "Medium Risk", data: [0, map.medium, 0], color: "#f59e0b" },
      { name: "High Risk", data: [0, 0, map.high], color: "#ef4444" },
    ],
  };
}

export default function AgenticFinOpsPage() {
  const { recommendations, summary, error, isLoading, mutate } =
    useAgenticFinOps();
  const { executions, isLoading: execLoading } = useExecutions();
  const {
    kpi,
    rows: savingsRows,
    isLoading: savingsLoading,
  } = useExecutionSavings();
  const [filter, setFilter] = useState<FilterKey>("all");

  const filtered =
    filter === "all"
      ? recommendations
      : recommendations.filter((r) => r.agenticStage === filter);

  const categoryData = buildCategoryChartData(recommendations);
  const riskData = buildRiskChartData(recommendations);

  return (
    <div className="space-y-6">
      {/* Hero gradient panel */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-900/60 via-sky-900/60 to-indigo-900/60 p-6 border border-white/10">
        <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/10 via-transparent to-indigo-500/10 pointer-events-none" />
        <div className="relative flex items-center gap-3">
          <span className="text-3xl">🤖</span>
          <div>
            <h1 className="text-xl font-bold text-white">Agentic FinOps</h1>
            <p className="text-sm text-slate-400 mt-0.5">
              Agent-driven cost recommendations — Detect, Analyze, Decide, and
              prepare for autonomous action
            </p>
          </div>
        </div>
      </div>

      {error && (
        <ErrorCard
          message="Failed to load Agentic FinOps data"
          onRetry={() => mutate()}
        />
      )}

      {/* Lifecycle Banner */}
      {isLoading || !summary ? (
        <LoadingSkeleton rows={2} height={120} />
      ) : (
        <AgenticLifecycleBanner byStage={summary.byStage} />
      )}

      {/* KPI Summary Cards */}
      {isLoading || !summary ? (
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <LoadingSkeleton key={i} rows={3} height={100} />
          ))}
        </div>
      ) : (
        <AgenticSummaryCards summary={summary} />
      )}

      {/* Charts: Category breakdown + Risk distribution */}
      <div className="grid grid-cols-2 gap-4">
        <ChartCard
          title="Savings by Category"
          subtitle="Annual savings potential by recommendation type"
        >
          {isLoading ? (
            <LoadingSkeleton rows={5} height={280} />
          ) : (
            <PieChart
              data={categoryData.map((d) => ({
                name: d.name,
                value: d.value,
              }))}
              height={280}
            />
          )}
        </ChartCard>

        <ChartCard
          title="Distribution by Risk"
          subtitle="Recommendation count by risk level"
        >
          {isLoading ? (
            <LoadingSkeleton rows={5} height={280} />
          ) : (
            <ColumnChart
              categories={riskData.categories}
              series={riskData.series}
              height={280}
              stacked
            />
          )}
        </ChartCard>
      </div>

      {/* Recommendation list with filters */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">📋</span>
            <div>
              <h2 className="text-base font-bold text-white">
                Agentic Recommendations
              </h2>
              <p className="text-xs text-slate-400">
                {filtered.length} of {recommendations.length} recommendations
              </p>
            </div>
          </div>

          {/* Stage filter tabs */}
          <div className="flex gap-1 rounded-lg bg-white/5 p-1">
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setFilter(opt.key)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  filter === opt.key
                    ? "bg-sky-500/20 text-sky-400"
                    : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <LoadingSkeleton key={i} rows={4} height={160} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-navy-800/60 p-5 text-center">
            <p className="text-sm text-slate-400">
              No recommendations found for this filter.
            </p>
          </div>
        ) : (
          filtered.map((rec) => (
            <AgenticRecommendationCard key={rec.id} rec={rec} />
          ))
        )}
      </div>

      {/* Execution Savings KPIs */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">💰</span>
          <div>
            <h2 className="text-base font-bold text-white">
              Realized Savings
            </h2>
            <p className="text-xs text-slate-400">
              Savings accumulated from executed actions
            </p>
          </div>
        </div>

        {savingsLoading ? (
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <LoadingSkeleton key={i} rows={2} height={80} />
            ))}
          </div>
        ) : kpi ? (
          <div className="grid grid-cols-4 gap-4">
            <div className="rounded-xl border border-white/10 bg-navy-800/60 p-4">
              <p className="text-xs text-slate-400">Total Saved</p>
              <p className="text-lg font-bold text-emerald-400">
                {fmtBRL(kpi.totalRealizedSavings)}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-navy-800/60 p-4">
              <p className="text-xs text-slate-400">Executed Actions</p>
              <p className="text-lg font-bold text-white">
                {kpi.executionsCount}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-navy-800/60 p-4">
              <p className="text-xs text-slate-400">Success Rate</p>
              <p className="text-lg font-bold text-sky-400">
                {Math.round(
                  (kpi.successCount / Math.max(kpi.executionsCount, 1)) * 100,
                )}
                %
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-navy-800/60 p-4">
              <p className="text-xs text-slate-400">Average Savings/Action</p>
              <p className="text-lg font-bold text-amber-400">
                {fmtBRL(
                  kpi.totalRealizedSavings / Math.max(kpi.executionsCount, 1),
                )}
              </p>
            </div>
          </div>
        ) : null}

        {/* Savings detail rows */}
        {!savingsLoading && savingsRows.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-white/10">
            <table className="w-full text-xs">
              <thead className="bg-white/5">
                <tr className="text-slate-400">
                  <th className="px-4 py-2 text-left font-medium">Resource</th>
                  <th className="px-4 py-2 text-left font-medium">Action</th>
                  <th className="px-4 py-2 text-right font-medium">
                    Cost Before
                  </th>
                  <th className="px-4 py-2 text-right font-medium">
                    Actual Cost
                  </th>
                  <th className="px-4 py-2 text-right font-medium">
                    Actual Savings
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {savingsRows.map((row, idx) => (
                  <tr
                    key={idx}
                    className="text-slate-300 hover:bg-white/[0.02]"
                  >
                    <td className="px-4 py-2 font-medium">
                      {row.resourceName}
                    </td>
                    <td className="px-4 py-2">{row.action}</td>
                    <td className="px-4 py-2 text-right">
                      {fmtBRL(row.beforeCost)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {fmtBRL(row.actualAfterCost)}
                    </td>
                    <td className="px-4 py-2 text-right font-bold text-emerald-400">
                      {fmtBRL(row.actualSavings)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Execution Log */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">📜</span>
          <div>
            <h2 className="text-base font-bold text-white">Execution Log</h2>
            <p className="text-xs text-slate-400">
              History of executed remediation actions
            </p>
          </div>
        </div>

        {execLoading ? (
          <LoadingSkeleton rows={5} height={200} />
        ) : executions.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-navy-800/60 p-5 text-center">
            <p className="text-sm text-slate-400">
              No executions recorded yet.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-white/10">
            <table className="w-full text-xs">
              <thead className="bg-white/5">
                <tr className="text-slate-400">
                  <th className="px-4 py-2 text-left font-medium">Date/Time</th>
                  <th className="px-4 py-2 text-left font-medium">Resource</th>
                  <th className="px-4 py-2 text-left font-medium">Action</th>
                  <th className="px-4 py-2 text-left font-medium">Executor</th>
                  <th className="px-4 py-2 text-center font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {executions.map((entry) => (
                  <tr
                    key={entry.executionId}
                    className="text-slate-300 hover:bg-white/[0.02]"
                  >
                    <td className="px-4 py-2 tabular-nums">
                      {new Date(entry.timestamp as string).toLocaleString(
                        "en-US",
                      )}
                    </td>
                    <td className="px-4 py-2 font-medium">
                      {entry.resourceName}
                    </td>
                    <td className="px-4 py-2">{entry.action}</td>
                    <td className="px-4 py-2">{entry.executedBy}</td>
                    <td className="px-4 py-2 text-center">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          entry.status === "success"
                            ? "bg-emerald-500/20 text-emerald-400"
                            : entry.status === "failed"
                              ? "bg-red-500/20 text-red-400"
                              : "bg-amber-500/20 text-amber-400"
                        }`}
                      >
                        {entry.status === "success"
                          ? "Success"
                          : entry.status === "failed"
                            ? "Failed"
                            : "Pending"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
