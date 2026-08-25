"use client";

import type { CardRefinementLog, StakeholderCard } from "@/lib/stakeholder/types";

/**
 * Renders a card.
 *
 * The card is independently shareable: metrics, meaning, caveats, and action.
 * Nothing here depends on another card being visible.
 */
export function StakeholderCardView({
  card,
  refinement,
}: {
  card: StakeholderCard;
  refinement?: CardRefinementLog;
}) {
  return (
    <article className="space-y-5 rounded-xl border border-white/10 bg-navy-800/60 p-6 backdrop-blur-sm">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold text-white">{card.title}</h2>
          <RefinementBadge refinement={refinement} />
        </div>
        <p className="text-sm font-medium text-sky-300">“{card.question}”</p>
        <p className="text-xs text-slate-500">{card.focus}</p>
      </header>

      <p className="text-base font-semibold leading-snug text-white">
        {card.headline}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {card.metrics.map((metric) => (
          <div
            key={metric.factPath}
            className="rounded-lg border border-white/5 bg-white/[0.03] p-4"
            title={metric.tip}
          >
            <p className="text-xs font-medium text-slate-400">{metric.label}</p>
            <p className="mt-1 text-xl font-bold text-white">{metric.value}</p>
            <p className="mt-2 text-[11px] leading-snug text-slate-500">
              {metric.tip}
            </p>
          </div>
        ))}
      </div>

      <section className="space-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-500">
          Why it matters
        </h3>
        <p className="text-sm leading-relaxed text-slate-300">
          {card.whyItMatters}
        </p>
      </section>

      <section className="space-y-1 rounded-lg border border-sky-500/20 bg-sky-500/5 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-sky-400">
          Next action
        </h3>
        <p className="text-sm leading-relaxed text-slate-200">
          {card.nextAction}
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-amber-400">
          Caveats
        </h3>
        <ul className="space-y-1.5">
          {card.caveats.map((caveat) => (
            <li
              key={caveat}
              className="flex gap-2 text-xs leading-relaxed text-slate-400"
            >
              <span className="text-amber-400">▪</span>
              <span>{caveat}</span>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}

/**
 * Shows when a card remained deterministic because AI refinement was rejected.
 * Without this, the fallback would look arbitrary.
 */
function RefinementBadge({ refinement }: { refinement?: CardRefinementLog }) {
  if (!refinement || refinement.state === "deterministic") return null;

  if (refinement.state === "refined") {
    return (
      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
        AI-refined text
      </span>
    );
  }

  return (
    <span
      className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300"
      title={refinement.reason}
    >
      AI rejected ({refinement.failedGuardrail}) — deterministic text
    </span>
  );
}
