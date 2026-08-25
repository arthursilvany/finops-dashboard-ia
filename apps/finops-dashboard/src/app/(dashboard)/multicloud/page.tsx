"use client";

import { FilterBar } from "@/components/FilterBar";
import { ErrorCard, LoadingSkeleton } from "@/components/StatusCards";
import { MulticloudMatrix } from "@/components/MulticloudMatrix";
import { MulticloudScorePanel } from "@/components/MulticloudScorePanel";
import { useMulticloudCompare } from "@/hooks/useMulticloudCompare";
import type { MulticloudNarrative } from "@/lib/multicloud/contract";
import {
  confidenceLabel,
  coverageNotices,
} from "@/lib/multicloud/coverage";
import { COMMITMENT_COMPARABILITY_CAVEAT } from "@/lib/multicloud/types";
import type { MulticloudFacts } from "@/lib/multicloud/types";

function Notices({ facts }: { facts: MulticloudFacts }) {
  const notices = coverageNotices(facts);
  if (notices.length === 0) return null;

  return (
    <div className="space-y-2">
      {notices.map((notice, index) => (
        <div
          key={index}
          className={`rounded-lg border p-3 ${
            notice.severity === "warning"
              ? "border-amber-500/25 bg-amber-500/5"
              : "border-white/10 bg-white/[0.02]"
          }`}
        >
          <p
            className={`text-xs font-medium ${
              notice.severity === "warning" ? "text-amber-300" : "text-slate-300"
            }`}
          >
            {notice.title}
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
            {notice.detail}
          </p>
        </div>
      ))}
    </div>
  );
}

function EstateSummary({ facts }: { facts: MulticloudFacts }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <p className="text-[10px] uppercase tracking-wider text-slate-500">
          Providers compared
        </p>
        <p className="mt-1 text-lg font-semibold text-slate-100">
          {facts.providersCompared.length > 0
            ? facts.providersCompared.join(" · ")
            : "None"}
        </p>
      </div>
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <p className="text-[10px] uppercase tracking-wider text-slate-500">
          Common period
        </p>
        <p className="mt-1 text-sm font-medium text-slate-100">
          {facts.window.from} → {facts.window.toExclusive}
        </p>
      </div>
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <p className="text-[10px] uppercase tracking-wider text-slate-500">
          Coverage
        </p>
        <p className="mt-1 text-sm font-medium text-slate-100">
          {confidenceLabel(facts.coverage.ratio)} ·{" "}
          {facts.coverage.observedCells}/{facts.coverage.totalCells} cells
        </p>
      </div>
    </div>
  );
}

function NarrativePanel({
  narrative,
  note,
  isLoading,
  onRequest,
  disabled,
}: {
  narrative: MulticloudNarrative | null;
  note: string | null;
  isLoading: boolean;
  onRequest: () => void;
  disabled: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Executive summary
        </h3>
        <button
          type="button"
          onClick={onRequest}
          disabled={isLoading || disabled}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isLoading ? "Writing…" : narrative ? "Rewrite" : "Summarize with AI"}
        </button>
      </div>

      {!narrative && !note && (
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          Optional. The AI writes prose over the table above — it never produces,
          adjusts or fills in a number. Anything it writes is checked against the
          measured facts before it reaches this panel.
        </p>
      )}

      {note && (
        <p className="mt-2 text-[11px] leading-relaxed text-amber-300/80">
          {note}
        </p>
      )}

      {narrative && (
        <div className="mt-3 space-y-3">
          <p className="text-xs leading-relaxed text-slate-300">
            {narrative.summary}
          </p>

          {narrative.tradeoffs.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">
                Trade-offs
              </p>
              <ul className="mt-1 space-y-1.5">
                {narrative.tradeoffs.map((tradeoff, index) => (
                  <li
                    key={index}
                    className="text-[11px] leading-relaxed text-slate-400"
                  >
                    · {tradeoff}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">
              Recommendation
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
              {narrative.recommendation}
            </p>
          </div>

          <ul className="space-y-1 border-t border-white/5 pt-2">
            {narrative.caveats.map((caveat, index) => (
              <li key={index} className="text-[10px] leading-relaxed text-slate-600">
                {caveat}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function MulticloudPage() {
  const {
    facts,
    isLoading,
    error,
    weights,
    setWeight,
    resetWeights,
    isDefaultWeights,
    exportQuery,
    narrative,
    narrativeNote,
    isNarrating,
    requestNarrative,
  } = useMulticloudCompare();

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-white">Multicloud Comparison</h1>
          {facts && (
            <a
              href={`/api/multicloud/markdown?${exportQuery}`}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-white/5"
            >
              Export Markdown
            </a>
          )}
        </div>
        <p className="text-sm text-slate-400">
          What the same workload actually costs on each cloud, measured from
          your own FOCUS billing data. Rates are what you pay — not list
          prices — so a cell only exists where the workload actually ran.
        </p>
      </header>

      <FilterBar />

      {error ? (
        <ErrorCard message={`Could not load the comparison: ${error.message}`} />
      ) : isLoading || !facts ? (
        <LoadingSkeleton rows={4} height={240} />
      ) : (
        <>
          <EstateSummary facts={facts} />
          <Notices facts={facts} />

          <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <MulticloudMatrix facts={facts} />
            <div className="space-y-4">
              <MulticloudScorePanel
                facts={facts}
                weights={weights}
                onWeightChange={setWeight}
                onReset={resetWeights}
                isDefaultWeights={isDefaultWeights}
              />

              <NarrativePanel
                narrative={narrative}
                note={narrativeNote}
                isLoading={isNarrating}
                onRequest={requestNarrative}
                disabled={facts.providersCompared.length < 2}
              />

              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Read this before deciding
                </h3>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                  {COMMITMENT_COMPARABILITY_CAVEAT}
                </p>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                  Rate differences exclude the cost of migrating: egress to
                  leave, rebuild effort, retraining and the period of running
                  both. A cheaper rate is the start of a business case, not the
                  conclusion.
                </p>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Reference data
                </h3>
                <ul className="mt-2 space-y-2">
                  {facts.references.map((reference) => (
                    <li key={reference.name} className="text-[11px]">
                      <span className="text-slate-400">{reference.name}</span>
                      <span className="text-slate-600">
                        {" "}
                        · captured {reference.capturedAt}
                      </span>
                      <p className="mt-0.5 leading-relaxed text-slate-600">
                        {reference.note}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
