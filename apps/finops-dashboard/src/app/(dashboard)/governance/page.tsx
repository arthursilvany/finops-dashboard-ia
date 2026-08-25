"use client";

import {
  useGovernanceKpi,
  useTagCompliance,
  useBudgetVsActual,
} from "@/hooks/useGovernance";
import { KpiCard } from "@/components/KpiCard";
import { ChartCard } from "@/components/ChartCard";
import { ColumnChart } from "@/components/ColumnChart";
import { LoadingSkeleton, ErrorCard } from "@/components/StatusCards";
import { FilterBar } from "@/components/FilterBar";

function fmtBRL(n: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(n);
}

export default function GovernancePage() {
  const kpi = useGovernanceKpi();
  const tagCompliance = useTagCompliance();
  const budgetChart = useBudgetVsActual();

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-white">Governance & Compliance</h1>
      <FilterBar />

      {/* KPI Row */}
      {kpi.error ? (
        <ErrorCard message="Failed to load KPI data" onRetry={() => kpi.mutate()} />
      ) : !kpi.data ? (
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <LoadingSkeleton key={i} rows={1} height={80} />)}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-4">
          <KpiCard
            title="Overall Tag Compliance"
            value={`${kpi.data.overallCompliance}%`}
            subtitle="env + owner + cost-center"
          />
          <KpiCard
            title="Tagged Resources"
            value={kpi.data.taggedResources.toLocaleString()}
            subtitle={`of ${kpi.data.totalResources.toLocaleString()} total`}
          />
          <KpiCard
            title="Untagged Resources"
            value={(kpi.data.totalResources - kpi.data.taggedResources).toLocaleString()}
            subtitle="Missing required tags"
          />
          <KpiCard
            title="Active Policies"
            value={kpi.data.policiesActive.toLocaleString()}
            subtitle="Compliance enforced"
          />
        </div>
      )}

      {/* Tag Compliance by Subscription */}
      <ChartCard
        title="Tag Coverage by Subscription"
        subtitle="% of resources carrying each required tag, shown separately so one unadopted tag does not read as zero governance"
      >
        {tagCompliance.error ? (
          <ErrorCard message="Failed to load compliance data" onRetry={() => tagCompliance.mutate()} />
        ) : !tagCompliance.data ? (
          <LoadingSkeleton rows={4} height={240} />
        ) : (
          <ColumnChart
            categories={tagCompliance.data.map((r) => r.subscriptionName)}
            series={[
              {
                name: "env",
                data: tagCompliance.data.map(
                  (r) => r.tagCoverage?.find((c) => c.tag === "env")?.pct ?? 0,
                ),
                color: "#38bdf8",
              },
              {
                name: "owner",
                data: tagCompliance.data.map(
                  (r) => r.tagCoverage?.find((c) => c.tag === "owner")?.pct ?? 0,
                ),
                color: "#f472b6",
              },
              {
                name: "cost-center",
                data: tagCompliance.data.map(
                  (r) => r.tagCoverage?.find((c) => c.tag === "cost-center")?.pct ?? 0,
                ),
                color: "#818cf8",
              },
            ]}
            height={240}
            horizontal
            formatValue={(v) => `${v}%`}
            showLegend
          />
        )}
      </ChartCard>

      {/* Budget vs Actual by Subscription */}
      <ChartCard
        title="Budget vs Actual Spend"
        subtitle="Current month by subscription"
      >
        {budgetChart.error ? (
          <ErrorCard message="Failed to load budget data" onRetry={() => budgetChart.mutate()} />
        ) : !budgetChart.data ? (
          <LoadingSkeleton rows={4} height={240} />
        ) : (
          <ColumnChart
            categories={budgetChart.data.map((r) => r.subscriptionName)}
            series={[
              {
                name: "Budget",
                data: budgetChart.data.map((r) => r.budget),
                color: "#818cf8",
              },
              {
                name: "Actual",
                data: budgetChart.data.map((r) => r.actual),
                color: "#38bdf8",
              },
            ]}
            height={240}
            formatValue={fmtBRL}
            showLegend
          />
        )}
      </ChartCard>

      {/* Compliance Detail Table */}
      {tagCompliance.data && (
        <div className="rounded-xl border border-white/10 bg-navy-800/60 p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-300">Compliance Detail</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="py-2 text-left font-medium text-slate-400">Subscription</th>
                <th className="py-2 text-right font-medium text-slate-400">Total Resources</th>
                <th className="py-2 text-right font-medium text-slate-400">env</th>
                <th className="py-2 text-right font-medium text-slate-400">owner</th>
                <th className="py-2 text-right font-medium text-slate-400">cost-center</th>
                <th className="py-2 text-right font-medium text-slate-400">All tags</th>
                <th className="py-2 text-right font-medium text-slate-400">Status</th>
              </tr>
            </thead>
            <tbody>
              {tagCompliance.data.map((row) => (
                <tr key={row.subscriptionName} className="border-b border-white/5">
                  <td className="py-2.5 text-slate-200">{row.subscriptionName}</td>
                  <td className="py-2.5 text-right text-slate-400">{row.total.toLocaleString()}</td>
                  {["env", "owner", "cost-center"].map((tag) => {
                    const cov = row.tagCoverage?.find((c) => c.tag === tag);
                    return (
                      <td key={tag} className="py-2.5 text-right text-slate-400">
                        {cov ? `${cov.pct}%` : "—"}
                      </td>
                    );
                  })}
                  <td className="py-2.5 text-right text-slate-200">{row.compliancePct}%</td>
                  <td className="py-2.5 text-right">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${
                        row.compliancePct >= 80
                          ? "bg-emerald-500/20 text-emerald-400"
                          : row.compliancePct >= 60
                          ? "bg-amber-500/20 text-amber-400"
                          : "bg-red-500/20 text-red-400"
                      }`}
                    >
                      {row.compliancePct >= 80 ? "Compliant" : row.compliancePct >= 60 ? "At Risk" : "Non-Compliant"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
