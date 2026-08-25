"use client";

import {
  useCostSummaryKpi,
  useMiniKpis,
  usePricingModel,
  useDailyCostByCategory,
  useServiceTrend,
  useCostByService,
  useCostByProvider,
} from "@/hooks/useCostSummary";
import { KpiCard } from "@/components/KpiCard";
import { MiniKpiCard } from "@/components/MiniKpiCard";
import { ChartCard } from "@/components/ChartCard";
import { ColumnChart } from "@/components/ColumnChart";
import { AreaChart } from "@/components/AreaChart";
import { PieChart } from "@/components/PieChart";
import { ServiceTrendList } from "@/components/ServiceTrendList";
import { LoadingSkeleton, ErrorCard } from "@/components/StatusCards";
import { FilterBar } from "@/components/FilterBar";

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

const categoryColors: Record<string, string> = {
  Compute: "#38bdf8",
  "AI/ML": "#818cf8",
  Database: "#34d399",
  Storage: "#fbbf24",
  Network: "#f87171",
  Others: "#a78bfa",
};

export default function CostSummaryPage() {
  const kpi = useCostSummaryKpi();
  const miniKpis = useMiniKpis();
  const pricing = usePricingModel();
  const dailyCat = useDailyCostByCategory(30);
  const trend = useServiceTrend();
  const byService = useCostByService(8);
  const byProvider = useCostByProvider();

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-white">Cost Summary</h1>
      <FilterBar />

      {/* KPI Row — 4 accent-colored cards */}
      {kpi.error ? (
        <ErrorCard
          message="Failed to load KPI data"
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
            title="Total Cloud Cost (30d)"
            value={fmt(kpi.data.totalCost30d)}
            subtitle={`${kpi.data.subscriptionCount} subscriptions · ${kpi.data.resourceCount} resources`}
            accentColor="#2dd4bf"
          />
          <KpiCard
            title="MoM Change"
            value={`+${fmt(kpi.data.momChangeDelta)}`}
            changePercent={kpi.data.momChangePercent}
            subtitle="vs previous month"
            accentColor="#f87171"
          />
          <KpiCard
            title="Identified Savings"
            value={fmt(kpi.data.savingsIdentified)}
            subtitle={`${kpi.data.savingsRecommendations} recommendations`}
            accentColor="#38bdf8"
          />
          <KpiCard
            title="Realized Savings"
            value={fmt(kpi.data.savingsRealized)}
            subtitle={`${kpi.data.savingsActions} executed actions`}
            accentColor="#34d399"
          />
        </div>
      )}

      {/* Mini KPI Gauges — 4 progress bar cards */}
      {miniKpis.error ? (
        <ErrorCard
          message="Failed to load mini KPIs"
          onRetry={() => miniKpis.mutate()}
        />
      ) : !miniKpis.data ? (
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <LoadingSkeleton key={i} rows={1} height={70} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-4">
          {miniKpis.data.map((g) => (
            <MiniKpiCard key={g.label} {...g} />
          ))}
        </div>
      )}

      {/* Row: Stacked Daily Cost (8/12) + Pricing Model Donut (4/12) */}
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-8">
          <ChartCard
            title="Daily Cost by Category"
            subtitle="Last 30 days"
          >
            {dailyCat.error ? (
              <ErrorCard
                message="Failed to load daily costs"
                onRetry={() => dailyCat.mutate()}
              />
            ) : !dailyCat.data ? (
              <LoadingSkeleton height={300} />
            ) : (
              (() => {
                const cats = Object.keys(
                  dailyCat.data[0]?.categories ?? categoryColors,
                );
                const categories = dailyCat.data.map((d) =>
                  new Date(d.day).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  }),
                );
                const series = cats.map((cat) => ({
                  name: cat,
                  data: dailyCat.data!.map((d) => d.categories[cat] ?? 0),
                  color: categoryColors[cat],
                }));
                return (
                  <AreaChart
                    categories={categories}
                    series={series}
                    stacked
                    height={300}
                    showLegend
                  />
                );
              })()
            )}
          </ChartCard>
        </div>

        <div className="col-span-4">
          <ChartCard title="Pricing Model" subtitle="Monthly distribution">
            {pricing.error ? (
              <ErrorCard
                message="Failed to load pricing"
                onRetry={() => pricing.mutate()}
              />
            ) : !pricing.data ? (
              <LoadingSkeleton height={300} />
            ) : (
              <PieChart
                data={pricing.data.map((p) => ({
                  name: p.model,
                  value: Math.round(p.cost),
                }))}
                innerRadius="50%"
                height={300}
              />
            )}
          </ChartCard>
        </div>
      </div>

      {/* Row: Cost by Service horizontal bar (8/12) + Service Trend MoM (4/12) */}
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-8">
          <ChartCard title="Cost by Service" subtitle="Top 8 services">
            {byService.error ? (
              <ErrorCard
                message="Failed to load services"
                onRetry={() => byService.mutate()}
              />
            ) : !byService.data ? (
              <LoadingSkeleton height={300} />
            ) : (
              <ColumnChart
                categories={byService.data.map((s) => s.service)}
                series={[
                  {
                    name: "Cost",
                    data: byService.data.map((s) => s.cost),
                    color: "#38bdf8",
                  },
                ]}
                horizontal
                showLegend={false}
                height={300}
              />
            )}
          </ChartCard>
        </div>

        <div className="col-span-4">
          <ChartCard title="Top Services — MoM Trend">
            {trend.error ? (
              <ErrorCard
                message="Failed to load trend"
                onRetry={() => trend.mutate()}
              />
            ) : !trend.data ? (
              <LoadingSkeleton height={300} />
            ) : (
              <ServiceTrendList data={trend.data} />
            )}
          </ChartCard>
        </div>
      </div>

      {/* Multicloud only: a single-provider dataset needs no split. */}
      {(byProvider.data?.length ?? 0) > 1 && (
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12">
            <ChartCard
              title="Cost by Cloud Provider"
              subtitle="Month to date — FOCUS ProviderName"
            >
              {byProvider.error ? (
                <ErrorCard
                  message="Failed to load providers"
                  onRetry={() => byProvider.mutate()}
                />
              ) : (
                <ColumnChart
                  categories={byProvider.data!.map((p) => p.providerName)}
                  series={[
                    {
                      name: "Cost",
                      data: byProvider.data!.map((p) => p.cost),
                      color: "#a78bfa",
                    },
                  ]}
                  horizontal
                  showLegend={false}
                  height={220}
                />
              )}
            </ChartCard>
          </div>
        </div>
      )}
    </div>
  );
}
