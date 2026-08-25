"use client";

import {
  useAiCostKpi,
  useAiCostByModel,
  useAiCostDaily,
  useAiCostByResource,
  useAiAnomalyTimeline,
  useAiAnomalyTopResources,
  useAiCostAllocation,
} from "@/hooks/useAiCosts";
import { KpiCard } from "@/components/KpiCard";
import { ChartCard } from "@/components/ChartCard";
import { PieChart } from "@/components/PieChart";
import { AreaChart } from "@/components/AreaChart";
import { DataTable } from "@/components/DataTable";
import { LoadingSkeleton, ErrorCard } from "@/components/StatusCards";
import { FilterBar } from "@/components/FilterBar";
import type {
  AiCostByResource,
  AiAnomalyResource,
  AiCostAllocation,
} from "@/lib/types";

function fmtBRL(n: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(n);
}

const MODEL_COLORS = [
  "#38bdf8",
  "#818cf8",
  "#34d399",
  "#fbbf24",
  "#f87171",
  "#fb923c",
  "#a78bfa",
  "#e879f9",
];

export default function AiCostsPage() {
  const kpi = useAiCostKpi();
  const byModel = useAiCostByModel();
  const daily = useAiCostDaily();
  const byResource = useAiCostByResource();
  const anomalyTimeline = useAiAnomalyTimeline();
  const anomalyTop = useAiAnomalyTopResources();
  const allocation = useAiCostAllocation();

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-white">AI Cost Observability</h1>
      <FilterBar />

      {/* KPI Row */}
      {kpi.error ? (
        <ErrorCard
          message="Failed to load AI cost KPIs"
          onRetry={() => kpi.mutate()}
        />
      ) : !kpi.data ? (
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <LoadingSkeleton key={i} rows={1} height={80} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-4">
          <KpiCard
            title="AI Total Cost (30d)"
            value={fmtBRL(kpi.data.totalCost30d)}
          />
          <KpiCard
            title="Previous Period"
            value={fmtBRL(kpi.data.costPrevious30d)}
          />
          <KpiCard
            title="Change %"
            value={`${kpi.data.momChangePercent >= 0 ? "+" : ""}${kpi.data.momChangePercent.toFixed(1)}%`}
          />
          <KpiCard
            title="Top Model"
            value={kpi.data.topModel}
            subtitle={fmtBRL(kpi.data.topModelCost)}
          />
        </div>
      )}

      {/* Pie + Daily Trend */}
      <div className="grid grid-cols-2 gap-4">
        <ChartCard title="Cost by AI Model" subtitle="Current period breakdown">
          {byModel.error ? (
            <ErrorCard
              message="Failed to load model data"
              onRetry={() => byModel.mutate()}
            />
          ) : !byModel.data ? (
            <LoadingSkeleton rows={5} height={280} />
          ) : (
            <PieChart
              data={byModel.data.map((r, i) => ({
                name: r.resourceName,
                value: r.cost,
                color: MODEL_COLORS[i % MODEL_COLORS.length],
              }))}
              height={280}
              showLegend
            />
          )}
        </ChartCard>

        <ChartCard title="AI Cost Daily Trend" subtitle="Last 30 days">
          {daily.error ? (
            <ErrorCard
              message="Failed to load daily trend"
              onRetry={() => daily.mutate()}
            />
          ) : !daily.data ? (
            <LoadingSkeleton height={280} />
          ) : (
            <AreaChart
              categories={daily.data.map((d) =>
                new Date(d.day).toLocaleDateString("pt-BR", {
                  month: "short",
                  day: "numeric",
                }),
              )}
              series={[
                {
                  name: "AI Cost",
                  data: daily.data.map((d) => d.cost),
                  color: "#38bdf8",
                  areaOpacity: 0.3,
                },
              ]}
              height={280}
            />
          )}
        </ChartCard>
      </div>

      {/* Top AI Resources */}
      <ChartCard title="Top AI Resources by Cost">
        {byResource.error ? (
          <ErrorCard
            message="Failed to load resources"
            onRetry={() => byResource.mutate()}
          />
        ) : !byResource.data ? (
          <LoadingSkeleton rows={5} height={40} />
        ) : (
          <DataTable<AiCostByResource & Record<string, unknown>>
            columns={[
              { key: "resourceName", header: "Resource" },
              { key: "model", header: "Model" },
              { key: "resourceGroup", header: "Resource Group" },
              {
                key: "cost",
                header: "Cost",
                align: "right",
                format: (v) => fmtBRL(v as number),
              },
              {
                key: "dailyAvg",
                header: "Daily Avg",
                align: "right",
                format: (v) => fmtBRL(v as number),
              },
            ]}
            data={
              byResource.data as (AiCostByResource & Record<string, unknown>)[]
            }
          />
        )}
      </ChartCard>

      {/* Anomaly Detection */}
      <ChartCard
        title="AI Cost Anomaly Timeline"
        subtitle="Deviation from baseline"
      >
        {anomalyTimeline.error ? (
          <ErrorCard
            message="Failed to load anomaly timeline"
            onRetry={() => anomalyTimeline.mutate()}
          />
        ) : !anomalyTimeline.data ? (
          <LoadingSkeleton height={300} />
        ) : (
          <AreaChart
            categories={anomalyTimeline.data.map((d) =>
              new Date(d.day).toLocaleDateString("pt-BR", {
                month: "short",
                day: "numeric",
              }),
            )}
            series={[
              {
                name: "Actual",
                data: anomalyTimeline.data.map((d) => d.actualCost),
                color: "#38bdf8",
                areaOpacity: 0.3,
              },
              {
                name: "Baseline",
                data: anomalyTimeline.data.map((d) => d.baseline),
                color: "#818cf8",
                lineStyle: "dashed",
                areaOpacity: 0,
              },
            ]}
            height={300}
          />
        )}
      </ChartCard>

      {/* Anomaly Top Resources */}
      <ChartCard title="Top AI Resources with Anomalies">
        {anomalyTop.error ? (
          <ErrorCard
            message="Failed to load anomaly resources"
            onRetry={() => anomalyTop.mutate()}
          />
        ) : !anomalyTop.data ? (
          <LoadingSkeleton rows={5} height={40} />
        ) : (
          <DataTable<AiAnomalyResource & Record<string, unknown>>
            columns={[
              { key: "resourceName", header: "Resource" },
              { key: "consumedService", header: "Service" },
              {
                key: "dayCost",
                header: "Day Cost",
                align: "right",
                format: (v) => fmtBRL(v as number),
              },
              {
                key: "deviationPercent",
                header: "Deviation %",
                align: "right",
                format: (v) => `${v}%`,
              },
            ]}
            data={
              anomalyTop.data as (AiAnomalyResource & Record<string, unknown>)[]
            }
          />
        )}
      </ChartCard>

      {/* Cost Allocation by BU */}
      <ChartCard
        title="AI Cost Allocation by Business Unit"
        subtitle="Model usage per BU"
      >
        {allocation.error ? (
          <ErrorCard
            message="Failed to load allocation data"
            onRetry={() => allocation.mutate()}
          />
        ) : !allocation.data ? (
          <LoadingSkeleton rows={5} height={40} />
        ) : (
          <DataTable<AiCostAllocation & Record<string, unknown>>
            columns={[
              { key: "businessUnit", header: "Business Unit" },
              { key: "aiApp", header: "AI Application" },
              { key: "aiModel", header: "Model" },
              {
                key: "cost",
                header: "Cost",
                align: "right",
                format: (v) => fmtBRL(v as number),
              },
              {
                key: "percentage",
                header: "%",
                align: "right",
                format: (v) => `${v}%`,
              },
            ]}
            data={
              allocation.data as (AiCostAllocation & Record<string, unknown>)[]
            }
          />
        )}
      </ChartCard>
    </div>
  );
}
