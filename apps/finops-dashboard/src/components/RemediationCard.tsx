"use client";

import { useState, useCallback } from "react";
import type {
  RemediationCard as CardType,
  RemediationAiInsight,
} from "@/lib/types";

function fmtBRL(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(n);
}

const IMPACT_COLORS: Record<string, string> = {
  high: "bg-red-500/20 text-red-400 border-red-500/30",
  medium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  low: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
};

const CATEGORY_COLORS: Record<string, string> = {
  Reliability: "bg-blue-500/20 text-blue-400",
  Security: "bg-purple-500/20 text-purple-400",
};

const CATEGORY_ICONS: Record<string, string> = {
  Reliability: "🛡️",
  Security: "🔒",
};

const RESOURCE_ICONS: Record<string, string> = {
  "Virtual Machine": "🖥️",
  "Load Balancer": "⚖️",
  "Application Gateway": "🌐",
  "SQL Database": "🗄️",
  "Storage Account": "📦",
  "App Service": "🌍",
  "Key Vault": "🔑",
  "AKS Cluster": "☸️",
};

export function RemediationCardComponent({ card }: { card: CardType }) {
  const [expanded, setExpanded] = useState(false);
  const [insight, setInsight] = useState<RemediationAiInsight | null>(
    card.aiInsight,
  );
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState(false);

  const handleExpand = useCallback(async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (insight) return; // already loaded
    setInsightLoading(true);
    setInsightError(false);
    try {
      const res = await fetch("/api/remediation-insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: card.id,
          title: card.recommendation,
          description: card.description,
          resourceType: card.resourceType,
          resourceName: card.resourceName,
          resourceGroup: card.resourceGroup,
          region: card.region,
          category:
            card.category === "Reliability" ? "HighAvailability" : "Security",
          impact: card.impact,
        }),
      });
      if (!res.ok) throw new Error("fetch failed");
      const json = await res.json();
      setInsight(json.data);
    } catch {
      setInsightError(true);
    } finally {
      setInsightLoading(false);
    }
  }, [expanded, insight, card.id]);
  const impactStyle = IMPACT_COLORS[card.impact] ?? IMPACT_COLORS.medium;
  const catStyle = CATEGORY_COLORS[card.category] ?? "";
  const catIcon = CATEGORY_ICONS[card.category] ?? "📋";
  const resIcon = RESOURCE_ICONS[card.resourceType] ?? "📄";
  const isNetPositive = card.netMonthly <= 0;

  return (
    <div className="rounded-xl border border-white/10 bg-navy-800/60 backdrop-blur-sm overflow-hidden">
      {/* Header: resource info */}
      <div className="px-5 pt-4 pb-3 border-b border-white/5">
        <div className="flex items-center gap-2 text-xs text-slate-400 mb-1.5">
          <span>{resIcon}</span>
          <span className="font-medium text-slate-300">
            {card.resourceType}
          </span>
          <span className="text-white/20">·</span>
          <span>{card.region}</span>
          <span className="text-white/20">·</span>
          <span>{card.resourceGroup}</span>
        </div>
        <h3 className="text-sm font-bold text-white leading-snug">
          {card.resourceName}
        </h3>
        <p className="text-sm text-slate-300 mt-1 leading-relaxed">
          {card.recommendation}
          {card.description && (
            <span className="text-slate-500"> — {card.description}</span>
          )}
        </p>
      </div>

      {/* Badges */}
      <div className="px-5 py-2.5 flex flex-wrap items-center gap-1.5">
        {card.tags.map((tag) => {
          const isCritical = tag === "CRITICAL";
          return (
            <span
              key={tag}
              className={`rounded px-2 py-0.5 text-[10px] font-bold tracking-wide ${
                isCritical
                  ? "bg-red-500/30 text-red-300 border border-red-500/40"
                  : tag === "RELIABILITY" || tag === "HIGH AVAILABILITY"
                    ? "bg-blue-500/20 text-blue-400"
                    : tag === "SECURITY"
                      ? "bg-purple-500/20 text-purple-400"
                      : "bg-white/5 text-slate-400"
              }`}
            >
              {isCritical ? "● " : ""}
              {tag}
            </span>
          );
        })}
        {card.factTags.map((ft) => (
          <span
            key={ft}
            className="rounded bg-slate-700/40 px-2 py-0.5 text-[10px] text-slate-400"
          >
            FACT · {ft}
          </span>
        ))}
        {card.costSource === "estimate" && (
          <span className="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-400">
            HYPOTHESIS
          </span>
        )}
      </div>

      {/* COPILOT AI INSIGHT (on-demand) */}
      <div className="border-t border-white/5">
        <button
          onClick={handleExpand}
          className="w-full px-5 py-2 flex items-center justify-between text-xs hover:bg-white/[0.02] transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-sky-400 font-bold">●</span>
            <span className="font-semibold text-sky-300">
              COPILOT AI INSIGHT
            </span>
          </div>
          <div className="flex items-center gap-3">
            {insight ? (
              <span className="text-slate-400">
                Insight Confidence{" "}
                <span className="font-medium text-slate-300">
                  HYPOTHESIS · {Math.round(insight.confidence * 100)}%
                </span>
              </span>
            ) : (
              <span className="text-slate-500">Click to analyze</span>
            )}
            <span className="text-slate-500 text-lg">
              {expanded ? "▾" : "▸"}
            </span>
          </div>
        </button>

        {expanded && (
          <div className="px-5 pb-4 space-y-3">
            {insightLoading && (
              <div className="flex items-center gap-2 py-4 justify-center">
                <span className="animate-spin text-sky-400">⟳</span>
                <span className="text-xs text-slate-400">
                  Generating analysis with GPT-4o + Microsoft Learn...
                </span>
              </div>
            )}

            {insightError && !insight && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
                <p className="text-xs text-red-300">
                  Failed to generate insight. Try expanding again.
                </p>
              </div>
            )}

            {insight && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  {/* Downtime Risk */}
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">
                      Downtime Risk During Remediation
                    </p>
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          insight.downtimeRisk.startsWith("Sim")
                            ? "bg-red-500"
                            : "bg-emerald-500"
                        }`}
                      />
                      <span className="text-sm text-slate-200">
                        {insight.downtimeRisk}
                      </span>
                    </div>
                  </div>

                  {/* Confidence */}
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">
                      Insight Confidence
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-200">
                        {insight.confidenceLabel} (
                        {Math.round(insight.confidence * 100)}%)
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-sky-400 transition-all"
                        style={{
                          width: `${Math.round(insight.confidence * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Context Warning */}
                {insight.contextWarning && (
                  <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
                    <p className="text-xs text-amber-300 leading-relaxed">
                      {insight.contextWarning}
                    </p>
                  </div>
                )}

                {/* Risk if not remediated */}
                {insight.riskIfNotRemediated && (
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">
                      Risk if NOT remediated
                    </p>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {insight.riskIfNotRemediated}
                    </p>
                  </div>
                )}

                {/* Microsoft Learn source references */}
                {insight.sourceReferences &&
                  insight.sourceReferences.length > 0 && (
                    <div className="border-t border-white/5 pt-2 mt-1">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1.5">
                        📚 Sources — Microsoft Learn
                      </p>
                      <div className="space-y-1">
                        {insight.sourceReferences.map((ref, i) => (
                          <a
                            key={i}
                            href={ref.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-xs text-sky-400 hover:text-sky-300 hover:underline truncate transition-colors"
                            title={ref.title}
                          >
                            ↗ {ref.title}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Financial footer */}
      <div className="border-t border-white/10 px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs">
        <div>
          <span className="text-slate-400">Remediation </span>
          <span className="font-semibold text-red-400">
            +{fmtBRL(card.remediationCostMonthly)}/month
          </span>
          <span className="text-slate-500">
            {" "}
            · {fmtBRL(card.remediationCostAnnual)}/year
          </span>
        </div>

        {card.advisorOffsetMonthly > 0 && (
          <div>
            <span className="text-slate-400">Advisor Offset </span>
            <span className="font-semibold text-emerald-400">
              –{fmtBRL(card.advisorOffsetMonthly)}/month
            </span>
            <span className="text-slate-500">
              {" "}
              · {fmtBRL(card.advisorOffsetAnnual)}/year
            </span>
          </div>
        )}

        <div
          className={`ml-auto font-semibold ${
            isNetPositive ? "text-emerald-400" : "text-red-400"
          }`}
        >
          {isNetPositive ? "✓" : "⚠"} Net:{" "}
          {card.netMonthly <= 0 ? "–" : "+"}
          {fmtBRL(Math.abs(card.netMonthly))}/month
        </div>
      </div>
    </div>
  );
}
