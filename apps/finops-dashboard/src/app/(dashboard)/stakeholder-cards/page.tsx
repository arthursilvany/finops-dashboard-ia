"use client";

import { useState } from "react";

import { FilterBar } from "@/components/FilterBar";
import { ErrorCard, LoadingSkeleton } from "@/components/StatusCards";
import { StakeholderCardView } from "@/components/StakeholderCardView";
import { useStakeholderCards } from "@/hooks/useStakeholderCards";
import { useFilters } from "@/hooks/useFilters";
import type {
  CardRefinementLog,
  StakeholderCard,
  StakeholderCardsPayload,
} from "@/lib/stakeholder/types";

/**
 * Tabs without a line of JavaScript: `radio` + `:checked`.
 *
 * The PRD requires the reading surface to work offline, without a CDN or
 * fetch. Keeping tab switching in plain CSS allows this markup to be reused
 * exactly in the exported artifact.
 */
function tabCss(personas: string[]): string {
  const rules = personas.map(
    (id) =>
      `#sc-tab-${id}:checked ~ .sc-panels > #sc-panel-${id}{display:block}` +
      `#sc-tab-${id}:checked ~ .sc-tablist label[for="sc-tab-${id}"]` +
      `{background:rgba(14,165,233,.12);color:#38bdf8;border-color:rgba(56,189,248,.4)}`,
  );

  return [
    ".sc-tabs input[type=radio]{position:absolute;opacity:0;pointer-events:none}",
    ".sc-panel{display:none}",
    ...rules,
  ].join("");
}

export default function StakeholderCardsPage() {
  const [scope, setScope] = useState<string | null>(null);
  const [refined, setRefined] = useState<StakeholderCardsPayload | null>(null);
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);

  const { filterParams } = useFilters();
  const { data, error, mutate } = useStakeholderCards(scope);

  const payload = refined ?? data;

  async function refineWithAi() {
    if (!data) return;
    setRefining(true);
    setRefineError(null);
    try {
      const params = new URLSearchParams(
        Object.entries(filterParams).map(([k, v]) => [k, String(v)]),
      );
      if (scope) params.set("scope", scope);
      const res = await fetch(`/api/stakeholder-cards/refine?${params}`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setRefined(json.data as StakeholderCardsPayload);
    } catch (err) {
      setRefineError((err as Error).message);
    } finally {
      setRefining(false);
    }
  }

  const exportParams = new URLSearchParams(
    Object.entries(filterParams).map(([k, v]) => [k, String(v)]),
  );
  if (scope) exportParams.set("scope", scope);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-white">Stakeholder Cards</h1>
        <p className="text-sm text-slate-400">
          One verified set of facts, viewed through five decision-making lenses.
          If two cards disagree on a number, it is a bug — not an opinion.
        </p>
      </header>

      <FilterBar />

      {error ? (
        <ErrorCard
          message="Unable to load stakeholder cards"
          onRetry={() => mutate()}
        />
      ) : !payload ? (
        <LoadingSkeleton rows={4} height={160} />
      ) : (
        <>
          <CoveragePanel payload={payload} />

          <div className="flex flex-wrap items-center gap-3">
            <ScopeSelector
              options={payload.scopeOptions}
              value={payload.scope}
              onChange={(next) => {
                setRefined(null);
                setScope(next);
              }}
            />

            <button
              onClick={refineWithAi}
              disabled={refining}
              className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-300 transition-colors hover:bg-sky-500/20 disabled:opacity-50"
            >
              {refining ? "Refining…" : "✨ Refine text with AI"}
            </button>

            <a
              href={`/api/stakeholder-cards/markdown?${exportParams}`}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-white/10"
            >
              ⬇ Export markdown (one file per persona)
            </a>

            {refined ? (
              <button
                onClick={() => setRefined(null)}
                className="text-xs text-slate-500 underline hover:text-slate-300"
              >
                Return to deterministic text
              </button>
            ) : null}
          </div>

          {refineError ? (
            <ErrorCard message={`AI refinement is unavailable: ${refineError}`} />
          ) : null}

          <PersonaTabs payload={payload} />
        </>
      )}
    </div>
  );
}

function PersonaTabs({ payload }: { payload: StakeholderCardsPayload }) {
  const personas = payload.cards.map((c) => c.persona);
  const logByPersona = new Map<string, CardRefinementLog>(
    (payload.refinement?.log ?? []).map((entry) => [entry.persona, entry]),
  );

  return (
    <div className="sc-tabs">
      <style dangerouslySetInnerHTML={{ __html: tabCss(personas) }} />

      {payload.cards.map((card, index) => (
        <input
          key={card.persona}
          type="radio"
          name="sc-persona"
          id={`sc-tab-${card.persona}`}
          defaultChecked={index === 0}
        />
      ))}

      <div className="sc-tablist mb-4 flex flex-wrap gap-2">
        {payload.cards.map((card) => (
          <label
            key={card.persona}
            htmlFor={`sc-tab-${card.persona}`}
            className="cursor-pointer rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-400 transition-colors hover:bg-white/10"
          >
            {card.title}
          </label>
        ))}
      </div>

      <div className="sc-panels">
        {payload.cards.map((card: StakeholderCard) => (
          <section
            key={card.persona}
            id={`sc-panel-${card.persona}`}
            className="sc-panel"
          >
            <StakeholderCardView
              card={card}
              refinement={logByPersona.get(card.persona)}
            />
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * Collection coverage shown in the package. Missing data is never treated as
 * an absence of risk.
 */
function CoveragePanel({ payload }: { payload: StakeholderCardsPayload }) {
  const { coverage } = payload;
  const layers = [
    { label: "Cost Export", ok: coverage.costExport },
    { label: "Governance", ok: coverage.governance },
    { label: "Anomalies", ok: coverage.anomalies },
    { label: "Commitments", ok: coverage.commitments },
  ];

  return (
    <div className="rounded-xl border border-white/10 bg-navy-800/40 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">
          Collection coverage
        </span>
        {layers.map((layer) => (
          <span
            key={layer.label}
            className={`rounded px-2 py-0.5 text-[11px] font-medium ${
              layer.ok
                ? "bg-emerald-500/15 text-emerald-300"
                : "bg-amber-500/15 text-amber-300"
            }`}
          >
            {layer.ok ? "✓" : "!"} {layer.label}
            {layer.ok ? "" : " — not assessed"}
          </span>
        ))}
      </div>

      {coverage.limitations.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {coverage.limitations.map((limitation) => (
            <li key={limitation} className="text-[11px] text-slate-500">
              ▪ {limitation}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ScopeSelector({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string | null;
  onChange: (next: string) => void;
}) {
  if (options.length === 0) return null;

  return (
    <label className="flex items-center gap-2 text-xs text-slate-400">
      Application Owner scope
      <select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border border-white/10 bg-navy-800 px-2 py-1.5 text-xs text-slate-200"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
