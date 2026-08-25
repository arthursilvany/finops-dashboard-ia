"use client";

import { ChartCard } from "@/components/ChartCard";
import { ColumnChart } from "@/components/ColumnChart";
import { DataTable } from "@/components/DataTable";
import { KpiCard } from "@/components/KpiCard";
import { ErrorCard, LoadingSkeleton } from "@/components/StatusCards";
import {
  useSkuAdvisorCapacity,
  useSkuAdvisorKpi,
  useSkuAdvisorLevers,
  useSkuAdvisorLifecycle,
  useSkuAdvisorRecommendations,
} from "@/hooks/useSkuAdvisor";
import type {
  SkuAdvisorBlocker,
  SkuAdvisorLeverRow,
  SkuAdvisorLifecycleItem,
  SkuAdvisorRow,
} from "@/lib/sku-advisor-aggregations";

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

const RISK_TONE: Record<string, string> = {
  none: "text-slate-400",
  low: "text-emerald-400",
  medium: "text-amber-400",
  high: "text-red-400",
};

/**
 * Says, in writing, which of the advisor's three sources produced the numbers.
 * A rightsizing plan built on the bundled sample and one built on the
 * customer's own estate must not look identical on screen.
 */
function SourceBadge({
  source,
  customerName,
  generatedAt,
  inventory,
  telemetry,
}: {
  source?: "service" | "customer" | "mock";
  customerName?: string;
  generatedAt?: string;
  inventory?: "live" | "offline";
  telemetry?: "live" | "unavailable";
}) {
  if (!source) return null;

  const copy = {
    service: {
      // "Live service" says where the answer came from, not what it describes.
      // With the advisor's offline inventory the recommendations are built on
      // its bundled sample estate and only the prices are real, so the badge
      // has to distinguish the two or it will pass sample savings off as the
      // customer's own.
      tone:
        inventory === "live"
          ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
          : "border-amber-400/30 bg-amber-400/10 text-amber-200",
      text:
        inventory === "live"
          ? "Live Azure SKU Advisor service — live inventory and pricing"
          : "Advisor service — sample inventory, live pricing (set SKU_ADVISOR_LIVE_USAGE to analyze this estate)",
    },
    customer: {
      tone: "border-sky-400/30 bg-sky-400/10 text-sky-200",
      text: customerName
        ? `Advisor export loaded for ${customerName}`
        : "Advisor export loaded from the customer workspace",
    },
    mock: {
      tone: "border-amber-400/30 bg-amber-400/10 text-amber-200",
      text: "Sample data — no advisor service configured and no export loaded",
    },
  }[source];

  return (
    <div
      className={`rounded-lg border px-3 py-2 text-xs ${copy.tone}`}
      role="status"
    >
      {copy.text}
      {source === "service" && (
        <span className="ml-2 opacity-70">
          ·{" "}
          {telemetry === "live"
            ? "90-day P99 CPU/memory/IOPS telemetry guided this rightsizing"
            : "no live telemetry — sizing is spec-parity only"}
        </span>
      )}
      {generatedAt && (
        <span className="ml-2 opacity-70">
          · generated {new Date(generatedAt).toLocaleString("en-US")}
        </span>
      )}
    </div>
  );
}

export default function SkuAdvisorPage() {
  const kpi = useSkuAdvisorKpi();
  const recommendations = useSkuAdvisorRecommendations();
  const levers = useSkuAdvisorLevers();
  const lifecycle = useSkuAdvisorLifecycle();
  const capacity = useSkuAdvisorCapacity();

  const currency = kpi.data?.data.currency ?? "USD";
  const fmt = (value: number) => money(value, currency);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">SKU Advisor</h1>
          <p className="text-xs text-slate-500">
            VM rightsizing, savings levers, SKU lifecycle exposure and the
            blockers that stand between a recommendation and a saving.
          </p>
        </div>
        <SourceBadge
          source={kpi.data?.metadata.skuAdvisorSource}
          customerName={kpi.data?.metadata.customerName}
          generatedAt={kpi.data?.metadata.generatedAt}
          inventory={kpi.data?.metadata.skuAdvisorInventory}
          telemetry={kpi.data?.metadata.skuAdvisorTelemetry}
        />
      </div>

      {/* KPI row */}
      {kpi.error ? (
        <ErrorCard
          message="Failed to load SKU Advisor KPIs"
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
            title="Monthly Savings"
            value={fmt(kpi.data.data.monthlySavings)}
            subtitle={`${fmt(kpi.data.data.annualSavings)} per year`}
            accentColor="#34d399"
          />
          <KpiCard
            title="Effective Savings Rate"
            value={`${kpi.data.data.effectiveSavingsRatePct.toFixed(1)}%`}
            subtitle={`of ${fmt(kpi.data.data.currentMonthly)} evaluated spend`}
          />
          <KpiCard
            title="Recommendations"
            value={kpi.data.data.recommendationsCount.toLocaleString()}
            subtitle={`across ${kpi.data.data.workloadsEvaluated.toLocaleString()} workloads`}
          />
          <KpiCard
            title="Projected Monthly"
            value={fmt(kpi.data.data.projectedMonthly)}
            subtitle={`${kpi.data.data.pricingBasis} pricing · ≥${kpi.data.data.savingsThresholdPct}% threshold`}
          />
        </div>
      )}

      {/* Savings levers */}
      <ChartCard
        title="Savings Levers"
        subtitle="What the advisor counted toward the headline total, per lever. A lever can compute a saving and then defer it to another track so the same VM is never counted twice."
      >
        {levers.error ? (
          <ErrorCard
            message="Failed to load savings levers"
            onRetry={() => levers.mutate()}
          />
        ) : !levers.data ? (
          <LoadingSkeleton rows={4} height={220} />
        ) : (
          <div className="space-y-4">
            <ColumnChart
              categories={levers.data.data.map((l) => l.label)}
              series={[
                {
                  name: "Counted in total",
                  data: levers.data.data.map((l) => l.countedMonthly),
                  color: "#34d399",
                },
                {
                  name: "Computed",
                  data: levers.data.data.map((l) => l.monthlySavings),
                  color: "#38bdf8",
                },
              ]}
            />
            <DataTable<SkuAdvisorLeverRow>
              columns={[
                { key: "label", header: "Lever" },
                {
                  key: "evaluated",
                  header: "Evaluated",
                  format: (value) => (value ? "Yes" : "No"),
                },
                {
                  key: "workloads",
                  header: "Workloads",
                  align: "right",
                  format: (value) => Number(value).toLocaleString(),
                },
                {
                  key: "countedMonthly",
                  header: "Counted / month",
                  align: "right",
                  format: (value) => fmt(Number(value)),
                },
                {
                  key: "note",
                  header: "Note",
                  format: (value) => String(value || "—"),
                },
              ]}
              data={levers.data.data}
            />
          </div>
        )}
      </ChartCard>

      {/* Recommendations */}
      <ChartCard
        title="Recommendations"
        subtitle="Ordered by monthly saving. Rows flagged as blocked carry a saving the advisor could not clear on quota or capacity."
      >
        {recommendations.error ? (
          <ErrorCard
            message="Failed to load recommendations"
            onRetry={() => recommendations.mutate()}
          />
        ) : !recommendations.data ? (
          <LoadingSkeleton rows={6} height={320} />
        ) : (
          <DataTable<SkuAdvisorRow>
            columns={[
              { key: "currentSize", header: "Current SKU" },
              {
                key: "recommendedSize",
                header: "Recommended",
                format: (value, row) => (
                  <span className={row.blocked ? "text-amber-300" : undefined}>
                    {String(value)}
                    {row.blocked && " ⚠"}
                  </span>
                ),
              },
              { key: "region", header: "Region" },
              {
                key: "count",
                header: "VMs",
                align: "right",
                format: (value) => Number(value).toLocaleString(),
              },
              {
                key: "currentMonthly",
                header: "Current / month",
                align: "right",
                format: (value) => fmt(Number(value)),
              },
              {
                key: "monthlySavings",
                header: "Savings / month",
                align: "right",
                format: (value) => fmt(Number(value)),
              },
              {
                key: "savingsPct",
                header: "Savings %",
                align: "right",
                format: (value) => `${Number(value).toFixed(1)}%`,
              },
              {
                key: "compatRisk",
                header: "Risk",
                format: (value) => (
                  <span className={RISK_TONE[String(value)] ?? "text-slate-400"}>
                    {String(value)}
                  </span>
                ),
              },
              { key: "track", header: "Track" },
              { key: "actionability", header: "Applies at" },
            ]}
            data={recommendations.data.data}
            maxRows={25}
          />
        )}
      </ChartCard>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* SKU lifecycle */}
        <ChartCard
          title="SKU Lifecycle Exposure"
          subtitle="Spend running on retiring or previous-generation SKUs. This is a deadline, not an optimization."
        >
          {lifecycle.error ? (
            <ErrorCard
              message="Failed to load lifecycle data"
              onRetry={() => lifecycle.mutate()}
            />
          ) : !lifecycle.data ? (
            <LoadingSkeleton rows={4} height={260} />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <Stat
                  label="Retiring"
                  value={`${lifecycle.data.data.retiringVms} VMs`}
                  detail={fmt(lifecycle.data.data.retiringMonthly)}
                  tone="text-red-300"
                />
                <Stat
                  label="Previous gen"
                  value={`${lifecycle.data.data.previousGenVms} VMs`}
                  detail={fmt(lifecycle.data.data.previousGenMonthly)}
                  tone="text-amber-300"
                />
                <Stat
                  label="Total exposure"
                  value={fmt(lifecycle.data.data.exposureMonthly)}
                  detail={`catalog: ${lifecycle.data.data.catalogSource}`}
                  tone="text-slate-200"
                />
              </div>
              {lifecycle.data.data.items.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No retiring or previous-generation SKU was reported in this
                  run.
                </p>
              ) : (
                <DataTable<SkuAdvisorLifecycleItem>
                  columns={[
                    { key: "series", header: "SKU series" },
                    { key: "status", header: "Status" },
                    { key: "retirementDate", header: "Retires" },
                    {
                      key: "vms",
                      header: "VMs",
                      align: "right",
                      format: (value) => Number(value).toLocaleString(),
                    },
                    {
                      key: "monthly",
                      header: "Monthly",
                      align: "right",
                      format: (value) => fmt(Number(value)),
                    },
                    {
                      key: "liveConfirmed",
                      header: "Confirmed",
                      format: (value, row) =>
                        value ? "Live notice" : `${row.source} catalog`,
                    },
                  ]}
                  data={lifecycle.data.data.items}
                  maxRows={10}
                />
              )}
            </div>
          )}
        </ChartCard>

        {/* Capacity & quota */}
        <ChartCard
          title="Capacity & Quota Blockers"
          subtitle="A recommendation is only a saving if the target SKU can actually be provisioned."
        >
          {capacity.error ? (
            <ErrorCard
              message="Failed to load capacity data"
              onRetry={() => capacity.mutate()}
            />
          ) : !capacity.data ? (
            <LoadingSkeleton rows={4} height={260} />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <Stat
                  label="Available"
                  value={
                    capacity.data.data.checked
                      ? capacity.data.data.available.toLocaleString()
                      : "—"
                  }
                  detail={
                    capacity.data.data.checked
                      ? `of ${capacity.data.data.checkedWorkloads} checked`
                      : "not checked"
                  }
                  tone="text-emerald-300"
                />
                <Stat
                  label="Restricted"
                  value={
                    capacity.data.data.checked
                      ? capacity.data.data.restricted.toLocaleString()
                      : "—"
                  }
                  detail={
                    capacity.data.data.checked
                      ? `${capacity.data.data.notOffered} not offered`
                      : "not checked"
                  }
                  tone="text-amber-300"
                />
                <Stat
                  label="Quota blocked"
                  value={capacity.data.data.quotaBlockedWorkloads.toLocaleString()}
                  detail={`${fmt(capacity.data.data.quotaBlockedMonthlySavings)} at risk`}
                  tone="text-red-300"
                />
              </div>
              {capacity.data.data.blockers.length === 0 ? (
                <p className="text-xs text-slate-500">
                  {capacity.data.data.checked
                    ? "No quota or capacity blocker was reported in this run."
                    : "The advisor did not run the capacity and quota checks, so nothing here has been verified as provisionable."}
                </p>
              ) : (
                <DataTable<SkuAdvisorBlocker>
                  columns={[
                    { key: "currentSize", header: "Current" },
                    { key: "recommendedSize", header: "Target" },
                    { key: "region", header: "Region" },
                    { key: "reason", header: "Reason" },
                    {
                      key: "monthlySavingsAtRisk",
                      header: "At risk / month",
                      align: "right",
                      format: (value) => fmt(Number(value)),
                    },
                    { key: "detail", header: "Detail" },
                  ]}
                  data={capacity.data.data.blockers}
                  maxRows={10}
                />
              )}
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-navy-900/40 p-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${tone}`}>{value}</p>
      <p className="text-xs text-slate-500">{detail}</p>
    </div>
  );
}
