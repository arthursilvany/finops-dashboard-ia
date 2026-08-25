"use client";

import { useCustomerNarrative } from "@/hooks/useCustomerNarrative";
import type { CustomerNarrative } from "@/lib/customer-narrative-contract";
import { LoadingSkeleton } from "@/components/StatusCards";

const RISK_STYLE = {
  low: "bg-emerald-500/15 text-emerald-300",
  medium: "bg-amber-500/15 text-amber-300",
  high: "bg-orange-500/15 text-orange-300",
  critical: "bg-red-500/15 text-red-300",
} as const;

const IMPACT_DIMENSION_STYLE = {
  financial: "bg-emerald-500/15 text-emerald-300",
  risk: "bg-red-500/15 text-red-300",
  operational: "bg-sky-500/15 text-sky-300",
  productivity: "bg-violet-500/15 text-violet-300",
} as const;

function NarrativeContent({
  narrative,
  freshness,
}: {
  narrative: CustomerNarrative;
  freshness: "current" | "stale";
}) {
  const sourceTitle = new Map(
    narrative.sources.map((source) => [source.url, source.title]),
  );

  return (
    <section className="space-y-4 rounded-2xl border border-sky-500/20 bg-sky-500/[0.06] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl" aria-hidden="true">✦</span>
            <h2 className="text-base font-bold text-white">AI Action Narrative</h2>
            {freshness === "stale" && (
              <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                STALE SNAPSHOT
              </span>
            )}
          </div>
          <p className="mt-1 text-sm font-medium text-sky-200">
            {narrative.decisionHeadline}
          </p>
          <p className="mt-2 max-w-4xl text-sm leading-relaxed text-slate-300">
            {narrative.executiveSummary}
          </p>
          <div className="mt-3 max-w-4xl rounded-lg border border-sky-400/30 bg-sky-500/10 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-300">
              Commitment we are asking for
            </p>
            <p className="mt-0.5 text-sm font-medium text-white">
              {narrative.executiveCommitment}
            </p>
          </div>
        </div>
        <div className="text-right text-[10px] text-slate-500">
          <p>Generated {new Date(narrative.generatedAtUtc).toLocaleString()}</p>
          <p>
            Source files last modified{" "}
            {new Date(narrative.sourceLastModifiedAtUtc).toLocaleString()}
          </p>
          <p>Model: {narrative.model}</p>
        </div>
      </div>

      {narrative.assessmentCoverage.limitations.length > 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.07] px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-300">
            Assessment boundaries
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {narrative.assessmentCoverage.limitations.join(" · ")}
          </p>
        </div>
      )}

      <div className="space-y-3">
        {narrative.actions.map((action) => (
          <article
            key={action.id}
            className="rounded-xl border border-white/10 bg-navy-900/60 p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span
                  aria-label={`Priority ${action.priority}`}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-xs font-bold text-sky-300"
                >
                  {action.priority}
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    {action.title}
                  </h3>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <span className="rounded bg-indigo-500/15 px-2 py-0.5 text-[10px] text-indigo-300">
                      {action.framework} · {action.frameworkArea}
                    </span>
                    {action.wafPillar && (
                      <span className="rounded bg-purple-500/15 px-2 py-0.5 text-[10px] text-purple-300">
                        {action.wafPillar}
                      </span>
                    )}
                    <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">
                      {action.effort} effort · {Math.round(action.confidence * 100)}%
                      confidence
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-slate-300">
              {action.recommendedChange}
            </p>

            <div className="mt-3 rounded-lg border border-white/5 bg-white/[0.02] p-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Why it matters
                </p>
                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-semibold ${IMPACT_DIMENSION_STYLE[action.businessImpactDimension]}`}
                >
                  {action.businessImpactDimension}
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-300">
                {action.businessImpact}
              </p>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Risk of change
                  </p>
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-semibold ${RISK_STYLE[action.changeRisk]}`}
                  >
                    {action.changeRisk}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  {action.changeImpact}
                </p>
              </div>
              <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Impact of no action
                  </p>
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-semibold ${RISK_STYLE[action.inactionRisk]}`}
                  >
                    {action.inactionRisk}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  {action.inactionImpact}
                </p>
              </div>
            </div>

            <div className="mt-3 rounded-lg bg-sky-500/[0.07] px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-300">
                Next action
              </p>
              <p className="mt-0.5 text-xs text-slate-200">{action.nextAction}</p>
            </div>

            <div className="mt-2 rounded-lg border border-sky-400/30 bg-sky-500/10 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-300">
                Commitment
              </p>
              <p className="mt-0.5 text-xs font-medium text-white">
                {action.commitment}
              </p>
            </div>

            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
              {Array.from(new Set(action.sourceUrls)).map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-sky-400 hover:underline"
                >
                  <span aria-hidden="true">↗ </span>
                  {sourceTitle.get(url) ?? "Microsoft Learn"}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function CustomerNarrativePanel() {
  const { data, error, isLoading, mutate } = useCustomerNarrative();

  if (isLoading) return <LoadingSkeleton rows={4} height={180} />;
  if (error) {
    return (
      <section className="rounded-xl border border-red-500/25 bg-red-500/[0.07] p-4">
        <h2 className="text-sm font-semibold text-red-300">
          AI Action Narrative could not be loaded
        </h2>
        <p className="mt-1 text-xs text-slate-400">
          Check the customer dataset and narrative status before the demo.
        </p>
        <button
          type="button"
          onClick={() => mutate()}
          className="mt-3 rounded bg-red-500/15 px-3 py-1.5 text-xs font-medium text-red-200 hover:bg-red-500/25"
        >
          Retry
        </button>
      </section>
    );
  }
  if (!data) return null;

  if (data.status?.state === "failed") {
    return (
      <section className="rounded-xl border border-red-500/25 bg-red-500/[0.07] p-4">
        <h2 className="text-sm font-semibold text-red-300">
          AI Action Narrative unavailable
        </h2>
        <p className="mt-1 text-xs text-slate-400">
          {data.status.error || "Narrative generation did not complete."} Re-run
          customer ingestion before using this assessment.
        </p>
      </section>
    );
  }

  if (!data.narrative) {
    return (
      <section className="rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-4">
        <h2 className="text-sm font-semibold text-amber-300">
          AI Action Narrative not generated
        </h2>
        <p className="mt-1 text-xs text-slate-400">
          Add Resource Graph and Advisor exports, then run customer ingestion.
        </p>
      </section>
    );
  }

  return (
    <NarrativeContent
      narrative={data.narrative}
      freshness={data.freshness}
    />
  );
}
