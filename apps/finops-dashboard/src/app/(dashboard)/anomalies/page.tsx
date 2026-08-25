"use client";

import {
  useAnomalyTimeline,
  useAnomalySummary,
  useAnomalyTopResources,
} from "@/hooks/useAnomalies";
import { KpiCard } from "@/components/KpiCard";
import { ChartCard } from "@/components/ChartCard";
import { AreaChart } from "@/components/AreaChart";
import { DataTable } from "@/components/DataTable";
import { LoadingSkeleton, ErrorCard } from "@/components/StatusCards";
import { FilterBar } from "@/components/FilterBar";
import type { AnomalyResource } from "@/lib/types";

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export default function AnomaliesPage() {
  const timeline = useAnomalyTimeline();
  const summary = useAnomalySummary();
  const topRes = useAnomalyTopResources();

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-white">Cost Anomalies</h1>
      <FilterBar />

      {/* KPI Row */}
      {summary.error ? (
        <ErrorCard
          message="Failed to load anomaly summary"
          onRetry={() => summary.mutate()}
        />
      ) : !summary.data ? (
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <LoadingSkeleton key={i} rows={1} height={80} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-4">
          <KpiCard
            title="Anomalies (7d)"
            value={String(summary.data.anomalies7d)}
          />
          <KpiCard
            title="Anomalies (30d)"
            value={String(summary.data.anomalies30d)}
          />
          <KpiCard
            title="Largest Deviation"
            value={fmt(summary.data.largestDeviation)}
          />
          <KpiCard
            title="Last Anomaly"
            value={summary.data.lastAnomalyDate || "None"}
          />
        </div>
      )}

      {/* Anomaly Timeline — Actual vs Baseline with anomaly scatter */}
      <ChartCard
        title="Cost Anomaly Timeline"
        subtitle="Last 90 days — actual vs baseline"
      >
        {timeline.error ? (
          <ErrorCard
            message="Failed to load timeline"
            onRetry={() => timeline.mutate()}
          />
        ) : !timeline.data ? (
          <LoadingSkeleton height={350} />
        ) : (
          <AreaChart
            categories={timeline.data.map((d) =>
              new Date(d.day).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              }),
            )}
            series={[
              {
                name: "Actual Cost",
                data: timeline.data.map((d) => d.actualCost),
                color: "#38bdf8",
                areaOpacity: 0.3,
              },
              {
                name: "Baseline",
                data: timeline.data.map((d) => d.baseline),
                color: "#818cf8",
                lineStyle: "dashed",
                areaOpacity: 0,
              },
            ]}
            height={350}
          />
        )}
      </ChartCard>

      {/* Top Resources on Anomaly Days */}
      <ChartCard title="Top Resources Contributing to Anomalies">
        {topRes.error ? (
          <ErrorCard message="Failed to load" onRetry={() => topRes.mutate()} />
        ) : !topRes.data ? (
          <LoadingSkeleton rows={5} height={40} />
        ) : (
          <DataTable<AnomalyResource & Record<string, unknown>>
            columns={[
              { key: "resourceName", header: "Resource" },
              { key: "consumedService", header: "Service" },
              {
                key: "dayCost",
                header: "Day Cost",
                align: "right",
                format: (v) => fmt(v as number),
              },
            ]}
            data={topRes.data as (AnomalyResource & Record<string, unknown>)[]}
          />
        )}
      </ChartCard>
    </div>
  );
}
