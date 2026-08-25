"use client";

import { useAiInsights } from "@/hooks/useAiInsights";
import { useRemediationImpact } from "@/hooks/useRemediationImpact";
import { ChartCard } from "@/components/ChartCard";
import { BandChart } from "@/components/BandChart";
import { RadarChart } from "@/components/RadarChart";
import { RemediationCardComponent } from "@/components/RemediationCard";
import { FinOpsKpiCards } from "@/components/FinOpsKpiCards";
import { LoadingSkeleton, ErrorCard } from "@/components/StatusCards";
import { CustomerNarrativePanel } from "@/components/CustomerNarrative";

const IMPACT_STYLES = {
  high: { badge: "bg-red-500/20 text-red-400", label: "High Impact" },
  medium: { badge: "bg-amber-500/20 text-amber-400", label: "Med Impact" },
  low: { badge: "bg-emerald-500/20 text-emerald-400", label: "Low Impact" },
};

function fmtBRL(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(n);
}

export default function AiInsightsPage() {
  const { data, error, isLoading, mutate } = useAiInsights();
  const {
    data: remediationCards,
    error: remError,
    isLoading: remLoading,
  } = useRemediationImpact();

  return (
    <div className="space-y-6">
      {/* Hero gradient panel */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-sky-900/60 via-indigo-900/60 to-purple-900/60 p-6 border border-white/10">
        <div className="absolute inset-0 bg-gradient-to-r from-sky-500/10 via-transparent to-purple-500/10 pointer-events-none" />
        <div className="relative flex items-center gap-3">
          <span className="text-3xl">✨</span>
          <div>
            <h1 className="text-xl font-bold text-white">AI Insights</h1>
            <p className="text-sm text-slate-400 mt-0.5">
              Intelligent recommendations generated from your Azure spend and
              performance data
            </p>
          </div>
        </div>
      </div>

      <CustomerNarrativePanel />

      {error && (
        <ErrorCard
          message="Failed to load AI Insights"
          onRetry={() => mutate()}
        />
      )}

      {/* Insight cards */}
      {isLoading || !data ? (
        <div className="grid grid-cols-1 gap-4">
          {[1, 2, 3].map((i) => (
            <LoadingSkeleton key={i} rows={3} height={100} />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {data.insights.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-navy-800/60 p-5 text-center">
              <p className="text-sm text-slate-400">
                No high-criticality cost recommendations found.
              </p>
            </div>
          ) : (
            data.insights.map((ins) => {
              const style = IMPACT_STYLES[ins.impact];
              return (
                <div
                  key={ins.id}
                  className="rounded-xl border border-white/10 bg-navy-800/60 p-5 backdrop-blur-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-semibold ${style.badge}`}
                        >
                          {style.label}
                        </span>
                        <span className="rounded bg-white/5 px-2 py-0.5 text-xs text-slate-400">
                          {ins.category}
                        </span>
                      </div>
                      <h3 className="font-semibold text-white">{ins.title}</h3>
                      <p className="mt-1 text-sm text-slate-400 leading-relaxed">
                        {ins.summary}
                      </p>
                    </div>
                    {ins.savingsEstimate != null && (
                      <div className="shrink-0 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-center">
                        <p className="text-[10px] text-emerald-400 font-medium uppercase tracking-wide">
                          Est. Savings
                        </p>
                        <p className="text-base font-bold text-emerald-300">
                          {fmtBRL(ins.savingsEstimate)}
                        </p>
                        <p className="text-[10px] text-emerald-500">/month</p>
                        {ins.resourceCount != null && ins.resourceCount > 1 && (
                          <p className="text-[10px] text-emerald-500 mt-0.5">
                            {ins.resourceCount} resources
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Cost Forecast */}
      <ChartCard
        title="Cost Forecast"
        subtitle="Actual + AI projection with confidence band"
      >
        {!data ? (
          <LoadingSkeleton rows={5} height={280} />
        ) : (
          <BandChart
            categories={data.costForecast.categories}
            actual={data.costForecast.actual}
            forecast={data.costForecast.forecast}
            lowerBound={data.costForecast.lowerBound}
            upperBound={data.costForecast.upperBound}
            height={280}
          />
        )}
      </ChartCard>

      {/* WAF Radar + FinOps Radar */}
      <div className="grid grid-cols-2 gap-4">
        <ChartCard
          title="WAF Health Radar"
          subtitle="5 pillars — Azure Advisor"
        >
          {!data ? (
            <LoadingSkeleton rows={5} height={280} />
          ) : (
            <RadarChart
              indicators={data.radar.indicators}
              series={data.radar.series}
              height={280}
            />
          )}
        </ChartCard>

        <ChartCard
          title="FinOps Score by Domain"
          subtitle="6 domains — real-time ADX data"
        >
          {!data ? (
            <LoadingSkeleton rows={5} height={280} />
          ) : (
            <RadarChart
              indicators={data.finopsRadar.indicators}
              series={data.finopsRadar.series}
              height={280}
            />
          )}
        </ChartCard>
      </div>

      {/* Executive KPI Cards — Remediation */}
      <FinOpsKpiCards />

      {/* Remediation Impact Cards */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xl">🛡️</span>
          <div>
            <h2 className="text-base font-bold text-white">
              Remediation Financial Impact
            </h2>
            <p className="text-xs text-slate-400">
              Critical Reliability and Security recommendations with cost
              analysis
            </p>
          </div>
        </div>

        {remError && (
          <ErrorCard message="Failed to load remediation impact" />
        )}

        {remLoading || !remediationCards ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <LoadingSkeleton key={i} rows={4} height={160} />
            ))}
          </div>
        ) : remediationCards.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-navy-800/60 p-5 text-center">
            <p className="text-sm text-slate-400">
              No critical reliability/security recommendations found.
            </p>
          </div>
        ) : (
          remediationCards.map((card) => (
            <RemediationCardComponent key={card.id} card={card} />
          ))
        )}
      </div>
    </div>
  );
}
