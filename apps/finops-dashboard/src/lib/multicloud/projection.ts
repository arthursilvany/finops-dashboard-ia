/**
 * What the model is allowed to see.
 *
 * Lives in its own module because two things depend on it and must not
 * disagree: `narrative.ts` sends it, and `guardrails.ts` derives the set of
 * quotable numbers from it. That is the whole point — **the numbers a
 * narrative may cite are exactly the numbers it was shown**, not everything the
 * facts happen to contain.
 *
 * Deriving the allowed set from the full `MulticloudFacts` was subtly wrong: it
 * authorised internal intermediates like a weighted score contribution, which
 * the model never receives and has no business quoting, while making the
 * allowed set dense enough that fabricated figures landed within tolerance of
 * something by chance.
 */

import {
  CANONICAL_UNIT_LABELS,
  COMMITMENT_TERM_LABELS,
  SCORE_INDEX_LABELS,
  UNOBSERVED_REASON_LABELS,
  type MulticloudFacts,
} from "./types";

/**
 * Deliberately lossy. Costs, quantities and row counts are dropped and only the
 * rate survives, because a model holding a cost and a quantity is a model that
 * can divide — and a divided number is a new number, which is precisely what
 * the guardrails exist to reject. Give it the conclusion, not the working.
 */
export function projectFactsForModel(facts: MulticloudFacts) {
  return {
    window: {
      from: facts.window.from,
      toExclusive: facts.window.toExclusive,
      clipped: facts.window.clipped,
    },
    currency: facts.currency,
    providersCompared: facts.providersCompared,
    providersPresentButNotCompared: facts.providersPresent.filter(
      (p) => !facts.providersCompared.includes(p),
    ),
    coverage: {
      observedCells: facts.coverage.observedCells,
      totalCells: facts.coverage.totalCells,
      percent: Math.round(facts.coverage.ratio * 100),
    },
    ranking: facts.scores.map((s) => ({
      provider: s.provider,
      score: Number(s.score.toFixed(1)),
      indicesUsed: s.participatingIndices.map((id) => SCORE_INDEX_LABELS[id]),
      omitted: s.components
        .filter((c) => c.value === null)
        .map((c) => `${SCORE_INDEX_LABELS[c.indexId]}: ${c.omittedReason ?? "no data"}`),
    })),
    weights: facts.weights,
    archetypes: facts.archetypes.map((a) => ({
      workload: a.label,
      unit: CANONICAL_UNIT_LABELS[a.unit],
      equivalence: a.equivalence,
      cheapestOnDemand: a.cheapestProvider,
      spreadPercent: a.spread === null ? null : Math.round(a.spread * 100),
      rates: Object.entries(a.cells).flatMap(([provider, terms]) =>
        Object.entries(terms ?? {}).map(([term, cell]) => ({
          provider,
          term: COMMITMENT_TERM_LABELS[term as keyof typeof COMMITMENT_TERM_LABELS],
          rate: cell.observed ? Number(cell.rate.toFixed(4)) : null,
          notObserved: cell.observed
            ? null
            : UNOBSERVED_REASON_LABELS[cell.reason],
        })),
      ),
    })),
    references: facts.references.map((r) => `${r.name} (captured ${r.capturedAt})`),
  };
}

export type ModelPayload = ReturnType<typeof projectFactsForModel>;
