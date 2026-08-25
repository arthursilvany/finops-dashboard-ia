"use client";

import {
  useWorkloadKpi,
  useWorkloadCpuScatter,
  useWorkloadRightsizing,
} from "@/hooks/useWorkload";
import { KpiCard } from "@/components/KpiCard";
import { ChartCard } from "@/components/ChartCard";
import { ScatterChart } from "@/components/ScatterChart";
import { DataTable } from "@/components/DataTable";
import { LoadingSkeleton, ErrorCard } from "@/components/StatusCards";
import { FilterBar } from "@/components/FilterBar";

function fmtBRL(n: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(n);
}

export default function WorkloadPage() {
  const kpi = useWorkloadKpi();
  const scatter = useWorkloadCpuScatter();
  const rightsize = useWorkloadRightsizing();

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-white">Workload Analysis</h1>
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
          <KpiCard title="Total VMs" value={kpi.data.totalVMs.toLocaleString()} />
          <KpiCard
            title="Rightsizing Candidates"
            value={kpi.data.rightsizingCandidates.toLocaleString()}
            subtitle="VMs under-utilised"
          />
          <KpiCard
            title="Potential Monthly Savings"
            value={fmtBRL(kpi.data.potentialMonthlySavings)}
            subtitle="From rightsizing"
          />
          <KpiCard
            title="Avg CPU Utilisation"
            value={`${kpi.data.avgCpuUtilization}%`}
            subtitle="Across all VMs"
          />
        </div>
      )}

      {/* Scatter: CPU vs Cost */}
      <ChartCard
        title="CPU Utilisation vs Monthly Cost"
        subtitle="Bubble size = relative cost. Low CPU + high cost = prime rightsizing targets"
      >
        {scatter.error ? (
          <ErrorCard message="Failed to load scatter data" onRetry={() => scatter.mutate()} />
        ) : !scatter.data ? (
          <LoadingSkeleton rows={6} height={320} />
        ) : (
          <ScatterChart
            series={[
              {
                name: "Virtual Machines",
                data: scatter.data
                  .filter((p) => p.service === "Virtual Machines")
                  .map((p) => ({ name: p.name, x: p.cpuAvg, y: p.monthlyCost, z: p.monthlyCost })),
                color: "#38bdf8",
              },
              {
                name: "SQL Database",
                data: scatter.data
                  .filter((p) => p.service === "SQL Database")
                  .map((p) => ({ name: p.name, x: p.cpuAvg, y: p.monthlyCost, z: p.monthlyCost })),
                color: "#818cf8",
              },
              {
                name: "Kubernetes",
                data: scatter.data
                  .filter((p) => p.service === "Kubernetes")
                  .map((p) => ({ name: p.name, x: p.cpuAvg, y: p.monthlyCost, z: p.monthlyCost })),
                color: "#34d399",
              },
            ]}
            height={320}
            xLabel="CPU Avg (%)"
            yLabel="Monthly Cost (R$)"
            formatX={(v) => `${v}%`}
            formatY={fmtBRL}
          />
        )}
      </ChartCard>

      {/* Rightsizing Recommendations */}
      <ChartCard
        title="Rightsizing Recommendations"
        subtitle="Top candidates from Azure Advisor"
      >
        {rightsize.error ? (
          <ErrorCard message="Failed to load recommendations" onRetry={() => rightsize.mutate()} />
        ) : !rightsize.data ? (
          <LoadingSkeleton rows={5} height={200} />
        ) : (
          <DataTable
            columns={[
              { key: "resourceName",     header: "Resource" },
              { key: "subscriptionName", header: "Subscription" },
              { key: "currentSku",       header: "Current SKU" },
              { key: "recommendedSku",   header: "Recommended SKU" },
              { key: "cpuAvg",           header: "CPU Avg",
                format: (v) => `${v}%` },
              { key: "currentCost",      header: "Current Cost",
                format: (v) => fmtBRL(Number(v)) },
              { key: "monthlySavings",   header: "Monthly Savings",
                format: (v) => (
                  <span className="font-semibold text-emerald-400">{fmtBRL(Number(v))}</span>
                ) },
            ]}
            data={rightsize.data as unknown as Record<string, unknown>[]}
          />
        )}
      </ChartCard>
    </div>
  );
}
