"use client";

import { useState, useMemo } from "react";
import {
  useReservationDetail,
  useReservationTrend,
  useReservationOptions,
} from "@/hooks/useReservations";
import { KpiCard } from "@/components/KpiCard";
import { ChartCard } from "@/components/ChartCard";
import { GaugeChart } from "@/components/GaugeChart";
import { ColumnChart } from "@/components/ColumnChart";
import { DataTable } from "@/components/DataTable";
import { LoadingSkeleton, ErrorCard } from "@/components/StatusCards";
import { FilterBar } from "@/components/FilterBar";
import type { ReservationRow } from "@/lib/types";

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function pct(n: number) {
  return `${n.toFixed(1)}%`;
}

function utilizationColor(u: number): string {
  if (u >= 95) return "text-emerald-400";
  if (u >= 85) return "text-yellow-400";
  return "text-red-400";
}

export default function ReservationDetailPage() {
  const [selectedName, setSelectedName] = useState("");
  const [selectedResourceType, setSelectedResourceType] = useState("");
  const [selectedCommitmentType, setSelectedCommitmentType] = useState("");

  const extraParams = useMemo(() => {
    const p: Record<string, string> = {};
    if (selectedName) p.commitmentName = selectedName;
    if (selectedResourceType) p.resourceType = selectedResourceType;
    if (selectedCommitmentType) p.commitmentType = selectedCommitmentType;
    return p;
  }, [selectedName, selectedResourceType, selectedCommitmentType]);

  const detail = useReservationDetail(extraParams);
  const trend = useReservationTrend(extraParams);
  const options = useReservationOptions();

  const kpis = useMemo(() => {
    if (!detail.data) return null;
    const rows = detail.data;
    const totalCommitments = rows.length;
    const totalUsed = rows.reduce((s, r) => s + r.used, 0);
    const totalUnused = rows.reduce((s, r) => s + r.unused, 0);
    const avgUtilization =
      rows.length > 0
        ? rows.reduce((s, r) => s + r.utilization, 0) / rows.length
        : 0;
    return {
      totalCommitments,
      totalUsed,
      totalUnused,
      avgUtilization,
    };
  }, [detail.data]);

  const underutilized = useMemo(() => {
    if (!detail.data) return [];
    return detail.data.filter((r) => r.utilization < 85);
  }, [detail.data]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-white">Reservation Detail</h1>
      <FilterBar />

      {/* Local Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-slate-400">
            Commitment Name
          </label>
          <select
            value={selectedName}
            onChange={(e) => setSelectedName(e.target.value)}
            className="h-9 w-64 rounded-lg border border-white/10 bg-navy-800 px-2 text-sm text-white focus:border-sky-500 focus:outline-none"
          >
            <option value="">All</option>
            {options.data?.commitmentNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs text-slate-400">
            Resource Type
          </label>
          <select
            value={selectedResourceType}
            onChange={(e) => setSelectedResourceType(e.target.value)}
            className="h-9 w-56 rounded-lg border border-white/10 bg-navy-800 px-2 text-sm text-white focus:border-sky-500 focus:outline-none"
          >
            <option value="">All</option>
            {options.data?.resourceTypes.map((rt) => (
              <option key={rt} value={rt}>
                {rt.split("/").pop()}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs text-slate-400">
            Commitment Type
          </label>
          <select
            value={selectedCommitmentType}
            onChange={(e) => setSelectedCommitmentType(e.target.value)}
            className="h-9 w-48 rounded-lg border border-white/10 bg-navy-800 px-2 text-sm text-white focus:border-sky-500 focus:outline-none"
          >
            <option value="">All</option>
            {options.data?.commitmentTypes.map((ct) => (
              <option key={ct} value={ct}>
                {ct}
              </option>
            ))}
          </select>
        </div>

        {(selectedName || selectedResourceType || selectedCommitmentType) && (
          <button
            onClick={() => {
              setSelectedName("");
              setSelectedResourceType("");
              setSelectedCommitmentType("");
            }}
            className="h-9 rounded-lg border border-white/10 px-3 text-xs text-slate-400 hover:bg-white/5"
          >
            Clear
          </button>
        )}
      </div>

      {/* Alert Banner */}
      {underutilized.length > 0 && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3">
          <p className="text-sm text-yellow-300">
            ⚠️ {underutilized.length} commitment
            {underutilized.length > 1 ? "s" : ""} below 85% utilization —{" "}
            {fmt(underutilized.reduce((s, r) => s + r.unused, 0))} idle cost
          </p>
        </div>
      )}

      {/* KPI Row */}
      {detail.error ? (
        <ErrorCard
          message="Failed to load reservations"
          onRetry={() => detail.mutate()}
        />
      ) : !kpis ? (
        <div className="grid grid-cols-3 gap-4 lg:grid-cols-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <LoadingSkeleton key={i} rows={1} height={80} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard
            title="Total Commitments"
            value={String(kpis.totalCommitments)}
          />
          <KpiCard title="Used" value={fmt(kpis.totalUsed)} />
          <KpiCard
            title="Idle / Waste"
            value={fmt(kpis.totalUnused)}
            subtitle={kpis.totalUnused > 0 ? "action needed" : undefined}
          />
          <KpiCard title="Avg Utilization" value={pct(kpis.avgUtilization)} />
        </div>
      )}

      {/* Charts Row: Stacked Bar + Gauge */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <ChartCard
            title="Used vs Unused Trend"
            subtitle="Monthly commitment utilization"
          >
            {trend.error ? (
              <ErrorCard
                message="Failed to load trend"
                onRetry={() => trend.mutate()}
              />
            ) : !trend.data ? (
              <LoadingSkeleton height={300} />
            ) : (
              <ColumnChart
                categories={trend.data.map((t) =>
                  new Date(t.month).toLocaleDateString("en-US", {
                    month: "short",
                    year: "numeric",
                  }),
                )}
                series={[
                  {
                    name: "Used",
                    data: trend.data.map((t) => t.used),
                    color: "#34d399",
                  },
                  {
                    name: "Unused",
                    data: trend.data.map((t) => t.unused),
                    color: "#f87171",
                  },
                ]}
                stacked
              />
            )}
          </ChartCard>
        </div>

        <ChartCard title="Avg Utilization" subtitle="Across all commitments">
          {!kpis ? (
            <LoadingSkeleton height={200} />
          ) : (
            <GaugeChart
              value={kpis.avgUtilization}
              title="Utilization"
              color={
                kpis.avgUtilization >= 95
                  ? "#34d399"
                  : kpis.avgUtilization >= 85
                    ? "#fbbf24"
                    : "#f87171"
              }
            />
          )}
        </ChartCard>
      </div>

      {/* Detail Table */}
      <ChartCard
        title="Commitment Breakdown"
        subtitle="Individual commitment utilization"
      >
        {detail.error ? (
          <ErrorCard
            message="Failed to load detail"
            onRetry={() => detail.mutate()}
          />
        ) : !detail.data ? (
          <LoadingSkeleton height={400} />
        ) : (
          <DataTable<ReservationRow>
            data={detail.data}
            columns={[
              { key: "commitmentName", header: "Name" },
              { key: "commitmentType", header: "Type" },
              { key: "term", header: "Term" },
              {
                key: "resourceType",
                header: "Resource",
                format: (v) => String(v).split("/").pop() ?? String(v),
              },
              {
                key: "used",
                header: "Used",
                align: "right" as const,
                format: (v) => fmt(Number(v)),
              },
              {
                key: "unused",
                header: "Unused",
                align: "right" as const,
                format: (v) => fmt(Number(v)),
              },
              {
                key: "utilization",
                header: "Utilization",
                align: "right" as const,
                format: (_v, row) => (
                  <span className={utilizationColor(row.utilization)}>
                    {pct(row.utilization)}
                  </span>
                ),
              },
              { key: "days", header: "Days", align: "right" as const },
            ]}
          />
        )}
      </ChartCard>
    </div>
  );
}
