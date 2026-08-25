"use client";

import {
  useChargebackKpi,
  useChargebackByBU,
  useChargebackTrend,
} from "@/hooks/useChargeback";
import { KpiCard } from "@/components/KpiCard";
import { ChartCard } from "@/components/ChartCard";
import { PieChart } from "@/components/PieChart";
import { AreaChart } from "@/components/AreaChart";
import { LoadingSkeleton, ErrorCard } from "@/components/StatusCards";
import { FilterBar } from "@/components/FilterBar";

function fmtBRL(n: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(n);
}

const BU_COLORS = ["#38bdf8", "#818cf8", "#34d399", "#fbbf24", "#f87171", "#fb923c", "#a78bfa"];

export default function ChargebackPage() {
  const kpi = useChargebackKpi();
  const byBU = useChargebackByBU();
  const trend = useChargebackTrend();

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-white">Chargeback & Allocation</h1>
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
            title="Total Allocated"
            value={fmtBRL(kpi.data.totalAllocated)}
            subtitle="Tagged to cost-center"
          />
          <KpiCard
            title="Untagged Cost"
            value={fmtBRL(kpi.data.untaggedCost)}
            subtitle="No cost-center tag"
          />
          <KpiCard
            title="Business Units"
            value={kpi.data.businessUnits.toLocaleString()}
          />
          <KpiCard
            title="Top Business Unit"
            value={kpi.data.topBU}
            subtitle="Highest spend"
          />
        </div>
      )}

      {/* Pie + Trend */}
      <div className="grid grid-cols-2 gap-4">
        <ChartCard
          title="Cost by Business Unit"
          subtitle="Current month allocation"
        >
          {byBU.error ? (
            <ErrorCard message="Failed to load BU data" onRetry={() => byBU.mutate()} />
          ) : !byBU.data ? (
            <LoadingSkeleton rows={5} height={280} />
          ) : (
            <PieChart
              data={byBU.data.map((r, i) => ({
                name: r.businessUnit,
                value: r.cost,
                color: BU_COLORS[i % BU_COLORS.length],
              }))}
              height={280}
              showLegend
            />
          )}
        </ChartCard>

        <ChartCard
          title="Monthly Trend by BU"
          subtitle="Last 4 months"
        >
          {trend.error ? (
            <ErrorCard message="Failed to load trend" onRetry={() => trend.mutate()} />
          ) : !trend.data || trend.data.length === 0 ? (
            <LoadingSkeleton rows={5} height={280} />
          ) : (() => {
            const categories = trend.data.map((r) => r.month as string);
            const buKeys = Object.keys(trend.data[0]).filter((k) => k !== "month");
            return (
              <AreaChart
                categories={categories}
                series={buKeys.map((bu, i) => ({
                  name: bu,
                  data: trend.data!.map((r) => Number(r[bu] ?? 0)),
                  color: BU_COLORS[i % BU_COLORS.length],
                  areaOpacity: 0.15,
                }))}
                height={280}
                showLegend
                formatValue={fmtBRL}
              />
            );
          })()}
        </ChartCard>
      </div>

      {/* BU Detail Table */}
      {byBU.data && (
        <div className="rounded-xl border border-white/10 bg-navy-800/60 p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-300">Business Unit Breakdown</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="py-2 text-left font-medium text-slate-400">Business Unit</th>
                <th className="py-2 text-right font-medium text-slate-400">Monthly Cost</th>
                <th className="py-2 text-right font-medium text-slate-400">% of Total</th>
              </tr>
            </thead>
            <tbody>
              {byBU.data.map((row, i) => (
                <tr key={row.businessUnit} className="border-b border-white/5">
                  <td className="flex items-center gap-2 py-2.5">
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ background: BU_COLORS[i % BU_COLORS.length] }}
                    />
                    <span className="text-slate-200">{row.businessUnit}</span>
                  </td>
                  <td className="py-2.5 text-right font-medium text-white">
                    {fmtBRL(row.cost)}
                  </td>
                  <td className="py-2.5 text-right text-slate-400">{row.percentage.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
