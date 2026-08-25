"use client";

import { useRemediationSummary } from "@/hooks/useRemediationSummary";
import { LoadingSkeleton } from "@/components/StatusCards";

const SOURCE_LABELS: Record<string, string> = {
  pricesheet: "📋 Price Sheet",
  mcp: "🔌 Azure Pricing MCP",
  "retail-api": "🌐 Retail API",
  estimate: "📊 Estimate",
};

function sourceBadges(sources: string[]) {
  if (sources.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {sources.map((s) => (
        <span
          key={s}
          className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400"
        >
          {SOURCE_LABELS[s] ?? s}
        </span>
      ))}
    </div>
  );
}

function fmtCurrency(n: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}

interface CardDef {
  title: string;
  monthly: number;
  annual: number;
  currency: string;
  accent: string;
  icon: string;
  sources?: string[];
  isCount?: boolean;
  count?: number;
}

function KpiCardItem({ card }: { card: CardDef }) {
  const isNegative = card.monthly < 0;
  const valueColor = card.accent;

  return (
    <div className="rounded-xl border border-white/10 bg-navy-800/60 p-4 backdrop-blur-sm">
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium text-slate-400">{card.title}</p>
        <span className="text-lg">{card.icon}</span>
      </div>
      {card.isCount ? (
        <p className={`mt-2 text-3xl font-bold ${valueColor}`}>{card.count}</p>
      ) : (
        <>
          <p className={`mt-2 text-2xl font-bold ${valueColor}`}>
            {isNegative ? "−" : ""}
            {fmtCurrency(Math.abs(card.monthly), card.currency)}
            <span className="text-xs font-normal text-slate-500"> /month</span>
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {isNegative ? "−" : ""}
            {fmtCurrency(Math.abs(card.annual), card.currency)} /year
          </p>
        </>
      )}
      {card.sources && sourceBadges(card.sources)}
    </div>
  );
}

export function FinOpsKpiCards() {
  const { data: summary, isLoading } = useRemediationSummary();

  if (isLoading || !summary) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <LoadingSkeleton key={i} rows={3} height={120} />
        ))}
      </div>
    );
  }

  const allSources = Array.from(
    new Set(summary.reliabilitySources.concat(summary.securitySources)),
  );
  const cur = summary.currency;

  const isNetPositive = summary.netImpactMonthly >= 0;

  const cards: CardDef[] = [
    {
      title: "Total Saving (Advisor)",
      monthly: summary.totalSavingsMonthly,
      annual: summary.totalSavingsAnnual,
      currency: cur,
      accent: "text-emerald-400",
      icon: "💰",
    },
    {
      title: "Remediation Cost — Reliability",
      monthly: summary.reliabilityCostMonthly,
      annual: summary.reliabilityCostAnnual,
      currency: cur,
      accent: "text-orange-400",
      icon: "🔧",
      sources: summary.reliabilitySources,
    },
    {
      title: "Remediation Cost — Security",
      monthly: summary.securityCostMonthly,
      annual: summary.securityCostAnnual,
      currency: cur,
      accent: "text-red-400",
      icon: "🛡️",
      sources: summary.securitySources,
    },
    {
      title: "Total Remediation Cost",
      monthly: summary.totalRemediationMonthly,
      annual: summary.totalRemediationAnnual,
      currency: cur,
      accent: "text-amber-400",
      icon: "📊",
      sources: allSources,
    },
    {
      title: "Net Financial Impact",
      monthly: summary.netImpactMonthly,
      annual: summary.netImpactAnnual,
      currency: cur,
      accent: isNetPositive ? "text-emerald-400" : "text-red-400",
      icon: isNetPositive ? "📈" : "📉",
    },
    {
      title: "Zero-Cost Remediations",
      monthly: 0,
      annual: 0,
      currency: cur,
      accent: "text-sky-400",
      icon: "✅",
      isCount: true,
      count: summary.zeroCostCount,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xl">📊</span>
        <div>
          <h2 className="text-base font-bold text-white">
            Executive KPIs — Remediation
          </h2>
          <p className="text-xs text-slate-400">
            Consolidated view of savings, costs, and net impact
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((card) => (
          <KpiCardItem key={card.title} card={card} />
        ))}
      </div>
    </div>
  );
}
