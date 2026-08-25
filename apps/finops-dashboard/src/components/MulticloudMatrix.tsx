"use client";

import { CANONICAL_UNIT_LABELS, COMMITMENT_TERM_LABELS } from "@/lib/multicloud/types";
import { UNOBSERVED_REASON_LABELS } from "@/lib/multicloud/types";
import type {
  ArchetypeComparison,
  CommitmentTerm,
  ComparisonCell,
  MulticloudFacts,
} from "@/lib/multicloud/types";
import type { CloudProvider } from "@/lib/customer-data/contract";

const TERMS: CommitmentTerm[] = ["on-demand", "1-year", "3-year"];

/**
 * A rate is meaningless without its unit and its scale. Rates span five orders
 * of magnitude here — a token costs $0.000005, a cluster-hour costs $0.10 — so
 * a fixed number of decimals would render most of the matrix as "$0.00".
 */
function formatRate(rate: number, currency: string): string {
  const digits = rate < 0.01 ? 6 : rate < 1 ? 4 : 2;
  const symbol = currency === "USD" ? "$" : "";
  return `${symbol}${rate.toFixed(digits)}`;
}

function formatMoney(value: number, currency: string): string {
  const symbol = currency === "USD" ? "$" : "";
  return `${symbol}${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/**
 * An empty cell states why it is empty.
 *
 * Rendering a dash here would let the reader supply their own explanation, and
 * the two plausible ones — "this provider is cheaper" and "we have no data" —
 * point in opposite directions.
 */
function CellView({
  cell,
  currency,
  isCheapest,
}: {
  cell: ComparisonCell;
  currency: string;
  isCheapest: boolean;
}) {
  if (!cell.observed) {
    return (
      <td className="px-3 py-2 text-center">
        <span
          className="text-[11px] italic text-slate-600"
          title={UNOBSERVED_REASON_LABELS[cell.reason]}
        >
          {UNOBSERVED_REASON_LABELS[cell.reason]}
        </span>
      </td>
    );
  }

  return (
    <td className="px-3 py-2 text-center">
      <div
        className={`text-sm font-medium ${
          isCheapest ? "text-emerald-400" : "text-slate-200"
        }`}
      >
        {formatRate(cell.rate, currency)}
      </div>
      <div className="text-[10px] text-slate-500">
        {formatMoney(cell.cost, currency)} · {cell.rowCount.toLocaleString("en-US")}{" "}
        {cell.rowCount === 1 ? "row" : "rows"}
        {cell.discountVsBaseline !== null && cell.discountVsBaseline > 0.005
          ? ` · ${(cell.discountVsBaseline * 100).toFixed(0)}% off list`
          : ""}
      </div>
    </td>
  );
}

function ArchetypeBlock({
  archetype,
  providers,
  currency,
}: {
  archetype: ArchetypeComparison;
  providers: CloudProvider[];
  currency: string;
}) {
  const applicable = providers.filter((p) => archetype.cells[p] !== undefined);
  if (applicable.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/10 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">
            {archetype.label}
          </h3>
          <p className="text-[11px] text-slate-500">
            Rate per {CANONICAL_UNIT_LABELS[archetype.unit]}
          </p>
        </div>
        {archetype.spread !== null && archetype.cheapestProvider ? (
          <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-300">
            {archetype.cheapestProvider} cheapest ·{" "}
            {(archetype.spread * 100).toFixed(0)}% spread
          </span>
        ) : (
          <span className="text-[11px] text-slate-600">
            Not enough providers to rank
          </span>
        )}
      </div>

      <table className="w-full">
        <thead>
          <tr className="border-b border-white/5 text-[11px] uppercase tracking-wider text-slate-500">
            <th className="px-3 py-2 text-left font-medium">Term</th>
            {applicable.map((provider) => (
              <th key={provider} className="px-3 py-2 text-center font-medium">
                {provider}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {TERMS.map((term) => (
            <tr key={term} className="border-b border-white/5 last:border-0">
              <td className="px-3 py-2 text-xs text-slate-400">
                {COMMITMENT_TERM_LABELS[term]}
              </td>
              {applicable.map((provider) => (
                <CellView
                  key={provider}
                  cell={archetype.cells[provider]![term]}
                  currency={currency}
                  isCheapest={
                    term === "on-demand" &&
                    archetype.cheapestProvider === provider
                  }
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* The equivalence claim is shown at the point of use so a reader who
          disagrees with it can discount the row rather than the whole view. */}
      <div className="border-t border-white/5 px-4 py-2">
        <p className="text-[10px] leading-relaxed text-slate-600">
          <span className="text-slate-500">Treated as equivalent:</span>{" "}
          {applicable
            .map((p) => `${p} — ${archetype.equivalence[p]}`)
            .join(" · ")}
        </p>
      </div>
    </div>
  );
}

export function MulticloudMatrix({ facts }: { facts: MulticloudFacts }) {
  return (
    <div className="space-y-4">
      {facts.archetypes.map((archetype) => (
        <ArchetypeBlock
          key={archetype.archetypeId}
          archetype={archetype}
          providers={facts.providersPresent}
          currency={facts.currency}
        />
      ))}
    </div>
  );
}
