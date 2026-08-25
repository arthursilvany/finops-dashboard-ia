/**
 * The deterministic layer. All arithmetic for the multicloud comparison lives
 * here and nowhere else.
 *
 * Downstream — the API route, the React page, the Markdown export, the AI
 * narrative — may select, format and reorder what this file produces. None of
 * them may compute. That constraint is what makes it possible to hand the same
 * comparison to an architect and to a CFO without the two of them finding
 * different numbers when they meet.
 */

import type { CloudProvider } from "../customer-data/contract";
import {
  classifyRow,
  ARCHETYPES,
  ARCHETYPE_BY_ID,
  COMPARABLE_PROVIDERS,
} from "./taxonomy";
import type { ClassifiableRow } from "./taxonomy";
import {
  CAPACITY_REFERENCE,
  SLA_REFERENCE,
  normalizeQuantity,
} from "./normalize";
import { scoreProviders, DEFAULT_WEIGHTS, normalizeWeights } from "./score";
import type {
  ArchetypeComparison,
  ArchetypeId,
  CommitmentTerm,
  ComparisonCell,
  ComparisonWindow,
  MulticloudFacts,
  ScoreWeights,
  UnobservedReason,
} from "./types";

/**
 * One aggregated measurement, already classified and unit-normalized.
 *
 * Both data paths converge on this shape. The ADX path aggregates in KQL and
 * classifies in TypeScript; the customer POC path does both in TypeScript. The
 * classification itself runs through `classifyRow` in *both* cases — pushing
 * the taxonomy into KQL would create a second implementation of the most
 * contestable logic in the feature, free to drift from the first.
 */
export interface Observation {
  provider: CloudProvider;
  archetypeId: ArchetypeId;
  term: CommitmentTerm;
  cost: number;
  /** Already expressed in the archetype's canonical unit. */
  quantity: number;
  /** Cost at the row's own baseline (list, else contracted). 0 when absent. */
  baselineCost: number;
  rowCount: number;
}

/** A billing row reduced to what the comparison needs. */
export interface ComparableRow extends ClassifiableRow {
  chargePeriodStart: string;
  chargePeriodEnd: string;
  chargeCategory: string;
  pricingCategory: string;
  pricingUnit: string;
  consumedQuantity: number;
  cost: number;
  baselineCost: number;
  skuTerm: string;
}

const ALL_TERMS: CommitmentTerm[] = ["on-demand", "1-year", "3-year"];

/**
 * Which purchase term a row represents, or null when it must be excluded.
 *
 * Spot and preemptible capacity (`PricingCategory = Dynamic`) is deliberately
 * excluded rather than folded into on-demand. Its price is a market rate for
 * interruptible capacity, so averaging it into the on-demand rate would make a
 * provider look cheap for durable workloads on the strength of capacity that
 * can be reclaimed mid-run.
 *
 * Non-usage rows (purchases, tax, credits) are excluded for the same reason
 * they are excluded from every rate: they consume no quantity, so they have no
 * defensible denominator.
 *
 * On-demand is an allowlist, not a fallback. Hubs emit both `Committed` and
 * `Commitment` for the same thing — `queries/cost-summary.ts` already defends
 * against both — and a catch-all `return "on-demand"` would silently pour a
 * provider's discounted commitment rates into its on-demand cell, making it
 * look cheaper on-demand than it is while reporting its commitment cells as
 * absent. An unrecognised category is dropped instead.
 */
const ON_DEMAND_CATEGORIES = new Set([
  "standard",
  "on-demand",
  "ondemand",
  "usage-based",
]);

const COMMITTED_CATEGORIES = new Set([
  "committed",
  "commitment",
  "committed use",
  "reserved",
]);

export function termOf(row: ComparableRow): CommitmentTerm | null {
  if (row.chargeCategory && row.chargeCategory !== "Usage") return null;

  const pricing = (row.pricingCategory || "Standard").toLowerCase().trim();
  if (pricing === "dynamic" || pricing === "spot") return null;

  if (ON_DEMAND_CATEGORIES.has(pricing)) return "on-demand";
  if (!COMMITTED_CATEGORIES.has(pricing)) return null;

  // FOCUS reports the term in months. Anything else is a commitment whose term
  // we cannot read, and guessing between one and three years would move real
  // money into the wrong column.
  const months = Number(row.skuTerm);
  if (months >= 30) return "3-year";
  if (months >= 1) return "1-year";
  return null;
}

/**
 * Reduces billing rows to observations.
 *
 * Rows that do not classify, do not carry a readable term, or whose unit
 * cannot be normalized are dropped here — silently in the sense that they
 * produce no observation, but visibly in the sense that the affected cell then
 * reports why it is empty.
 */
export function toObservations(rows: ComparableRow[]): Observation[] {
  const bucket = new Map<string, Observation>();

  for (const row of rows) {
    const archetypeId = classifyRow(row);
    if (!archetypeId) continue;

    const term = termOf(row);
    if (!term) continue;

    const archetype = ARCHETYPE_BY_ID.get(archetypeId);
    if (!archetype) continue;

    const normalized = normalizeQuantity(
      row.pricingUnit,
      row.consumedQuantity,
      archetype.unit,
    );
    if (!normalized) continue;

    const key = `${row.providerName}|${archetypeId}|${term}`;
    const existing = bucket.get(key);
    if (existing) {
      existing.cost += row.cost;
      existing.quantity += normalized.quantity;
      existing.baselineCost += row.baselineCost;
      existing.rowCount += 1;
    } else {
      bucket.set(key, {
        provider: row.providerName,
        archetypeId,
        term,
        cost: row.cost,
        quantity: normalized.quantity,
        baselineCost: row.baselineCost,
        rowCount: 1,
      });
    }
  }

  return Array.from(bucket.values());
}

/**
 * The period every compared provider has data for.
 *
 * Providers are onboarded at different times. Comparing three months of AWS
 * against twelve of Azure and reporting the difference as a price gap is the
 * single easiest way to produce a confident, well-formatted, wrong answer, so
 * the comparison is clipped to the intersection and the clipping is reported.
 */
export function commonWindow(
  spans: Array<{ provider: CloudProvider; from: string; toExclusive: string }>,
): ComparisonWindow {
  if (spans.length === 0) {
    const today = new Date().toISOString().slice(0, 10);
    return {
      from: today,
      toExclusive: today,
      providerSpans: [],
      clipped: false,
    };
  }

  const from = spans.reduce((a, s) => (s.from > a ? s.from : a), spans[0].from);
  const toExclusive = spans.reduce(
    (a, s) => (s.toExclusive < a ? s.toExclusive : a),
    spans[0].toExclusive,
  );

  const clipped = spans.some(
    (s) => s.from < from || s.toExclusive > toExclusive,
  );

  return { from, toExclusive, providerSpans: spans, clipped };
}

/**
 * Clips rows onto the comparison window, prorating what straddles the edge.
 *
 * Whole-row inclusion is not enough. On the ADX path a group's charge period
 * spans that SKU's entire history, so a filter that merely asks "does this
 * overlap the window?" admits every row at full cost and clips nothing at all —
 * twelve months of Azure would still be compared against three of AWS while the
 * UI claimed a common period. Cost, quantity and baseline are scaled together,
 * because prorating cost alone would inflate every derived rate by 1/factor.
 */
export function clipToWindow(
  rows: ComparableRow[],
  window: ComparisonWindow,
): ComparableRow[] {
  if (window.toExclusive <= window.from) return [];

  const days = (from: string, toExclusive: string): number => {
    const a = Date.parse(`${from}T00:00:00Z`);
    const b = Date.parse(`${toExclusive}T00:00:00Z`);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    return Math.max(0, (b - a) / 86_400_000);
  };

  const out: ComparableRow[] = [];

  for (const row of rows) {
    const start =
      row.chargePeriodStart > window.from ? row.chargePeriodStart : window.from;
    const end =
      row.chargePeriodEnd < window.toExclusive
        ? row.chargePeriodEnd
        : window.toExclusive;
    if (end <= start) continue;

    const full = days(row.chargePeriodStart, row.chargePeriodEnd);
    const inside = days(start, end);

    // An unreadable or zero-length period is kept whole rather than scaled to
    // nothing: it demonstrably overlapped the window, and a fabricated zero
    // would delete real spend from the comparison.
    const factor = full > 0 ? Math.min(inside / full, 1) : 1;
    if (factor >= 1) {
      out.push(row);
      continue;
    }

    out.push({
      ...row,
      chargePeriodStart: start,
      chargePeriodEnd: end,
      cost: row.cost * factor,
      consumedQuantity: row.consumedQuantity * factor,
      baselineCost: row.baselineCost * factor,
    });
  }

  return out;
}

/**
 * Why a given provider × archetype × term produced no observation.
 *
 * The reason is derived from what *was* seen, so it points at the actual gap
 * rather than restating that a number is missing.
 */
function reasonFor(
  provider: CloudProvider,
  archetypeId: ArchetypeId,
  providersPresent: CloudProvider[],
  observations: Observation[],
  hadRowsButNoQuantity: Set<string>,
): UnobservedReason {
  if (!providersPresent.includes(provider)) return "provider-absent";
  if (hadRowsButNoQuantity.has(`${provider}|${archetypeId}`)) {
    return "quantity-missing";
  }
  const anyTerm = observations.some(
    (o) => o.provider === provider && o.archetypeId === archetypeId,
  );
  return anyTerm ? "term-absent" : "archetype-absent";
}

function cellFrom(observation: Observation): ComparisonCell {
  const rate = observation.cost / observation.quantity;
  const discount =
    observation.baselineCost > 0
      ? Math.max(
          0,
          Math.min(1, 1 - observation.cost / observation.baselineCost),
        )
      : null;

  const archetype = ARCHETYPE_BY_ID.get(observation.archetypeId);

  return {
    observed: true,
    rate,
    unit: archetype!.unit,
    cost: observation.cost,
    quantity: observation.quantity,
    rowCount: observation.rowCount,
    discountVsBaseline: discount,
  };
}

export interface BuildFactsInput {
  rows: ComparableRow[];
  currency: string;
  weights?: Partial<ScoreWeights>;
  /**
   * Providers that appear in the dataset at all, including those with no
   * comparable workload. Passed in rather than derived from `rows` so that a
   * provider filtered down to nothing still reports "provider absent" honestly.
   */
  providersPresent: CloudProvider[];
  /**
   * Observed span per provider, from a query over *all* the provider's data.
   *
   * Passed in rather than derived from `rows` because `rows` have already been
   * reduced to comparable dimensions. A provider that bills mostly workloads
   * outside the taxonomy would otherwise appear to have onboarded later than it
   * did, and the window would be clipped against a date that never existed.
   */
  spans?: Array<{ provider: CloudProvider; from: string; toExclusive: string }>;
}

/** Builds the single source of truth for the comparison. */
export function buildMulticloudFacts(input: BuildFactsInput): MulticloudFacts {
  const { rows, currency, providersPresent } = input;
  const weights = normalizeWeights({ ...DEFAULT_WEIGHTS, ...input.weights });

  // The window must be intersected over providers that can actually be
  // compared. `providersPresent` may include "Other" (contract.ts maps any
  // unrecognised ProviderName there) or a provider whose spend is entirely
  // outside the taxonomy. Neither can ever produce a cell, but either would
  // drag `max(from)` forward and `min(toExclusive)` back — silently truncating
  // a sound comparison, or emptying it altogether when the spans do not
  // overlap, which then surfaces as the wrong diagnosis ("no comparable
  // workload") for a dataset that is full of comparable workload.
  const comparableProviders = providersPresent.filter((p) =>
    COMPARABLE_PROVIDERS.includes(p),
  );

  const spans = (
    input.spans ??
    comparableProviders
      .map((provider) => {
        const providerRows = rows.filter((r) => r.providerName === provider);
        if (providerRows.length === 0) return null;
        return {
          provider,
          from: providerRows.reduce(
            (a, r) => (r.chargePeriodStart < a ? r.chargePeriodStart : a),
            providerRows[0].chargePeriodStart,
          ),
          toExclusive: providerRows.reduce(
            (a, r) => (r.chargePeriodEnd > a ? r.chargePeriodEnd : a),
            providerRows[0].chargePeriodEnd,
          ),
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
  ).filter((s) => comparableProviders.includes(s.provider));

  const window = commonWindow(spans);
  const windowed = clipToWindow(rows, window);
  const observations = toObservations(windowed);

  // Rows that classified and carried cost but yielded no usable quantity. This
  // is the difference between "this provider does not run that workload" and
  // "this provider runs it but does not report how much", which are different
  // findings with different remedies.
  const hadRowsButNoQuantity = new Set<string>();
  for (const row of windowed) {
    const archetypeId = classifyRow(row);
    if (!archetypeId) continue;
    const archetype = ARCHETYPE_BY_ID.get(archetypeId);
    if (!archetype) continue;
    if (normalizeQuantity(row.pricingUnit, row.consumedQuantity, archetype.unit))
      continue;
    if (row.cost > 0) {
      hadRowsButNoQuantity.add(`${row.providerName}|${archetypeId}`);
    }
  }

  const byKey = new Map(
    observations.map((o) => [`${o.provider}|${o.archetypeId}|${o.term}`, o]),
  );

  const comparedSet = new Set(observations.map((o) => o.provider));
  const providersCompared = providersPresent.filter((p) => comparedSet.has(p));

  let totalCells = 0;
  let observedCells = 0;

  const archetypes: ArchetypeComparison[] = ARCHETYPES.map((definition) => {
    const cells: ArchetypeComparison["cells"] = {};
    const equivalence: ArchetypeComparison["equivalence"] = {};

    for (const provider of providersPresent) {
      const matcher = definition.matchers[provider];
      if (!matcher) continue;
      equivalence[provider] = matcher.equivalenceLabel;

      const perTerm = {} as Record<CommitmentTerm, ComparisonCell>;
      for (const term of ALL_TERMS) {
        totalCells += 1;
        const observation = byKey.get(`${provider}|${definition.id}|${term}`);
        if (observation && observation.quantity > 0) {
          observedCells += 1;
          perTerm[term] = cellFrom(observation);
        } else {
          perTerm[term] = {
            observed: false,
            reason: reasonFor(
              provider,
              definition.id,
              providersPresent,
              observations,
              hadRowsButNoQuantity,
            ),
          };
        }
      }
      cells[provider] = perTerm;
    }

    // The headline comparison is on-demand: it is the only term every provider
    // can be expected to have, and commitment rates reflect purchasing history
    // as much as list economics.
    const onDemand = Object.entries(cells)
      .map(([provider, terms]) => ({
        provider: provider as CloudProvider,
        cell: terms["on-demand"],
      }))
      .filter(
        (entry): entry is { provider: CloudProvider; cell: ComparisonCell & { observed: true } } =>
          entry.cell.observed,
      );

    let cheapestProvider: CloudProvider | null = null;
    let spread: number | null = null;

    if (onDemand.length >= 2) {
      const sorted = [...onDemand].sort((a, b) => a.cell.rate - b.cell.rate);
      cheapestProvider = sorted[0].provider;
      const cheapest = sorted[0].cell.rate;
      const dearest = sorted[sorted.length - 1].cell.rate;
      spread = dearest > 0 ? (dearest - cheapest) / dearest : null;
    }

    return {
      archetypeId: definition.id,
      label: definition.label,
      unit: definition.unit,
      equivalence,
      cells,
      cheapestProvider,
      spread,
    };
  });

  const costByProvider = new Map<CloudProvider, number>();
  for (const row of windowed) {
    costByProvider.set(
      row.providerName,
      (costByProvider.get(row.providerName) ?? 0) + row.cost,
    );
  }
  const grandTotal = Array.from(costByProvider.values()).reduce(
    (a, b) => a + b,
    0,
  );

  const totalsByProvider = providersPresent.map((provider) => {
    const cost = costByProvider.get(provider) ?? 0;
    return {
      provider,
      cost,
      share: grandTotal > 0 ? cost / grandTotal : 0,
    };
  });

  const scores = scoreProviders(archetypes, providersCompared, weights);

  // With one provider there is no comparison to make. The matrix is still
  // worth rendering — it is a useful unit-economics view of the one cloud in
  // play — but nothing in it supports "move to X", and the UI must not imply
  // otherwise.
  const insufficientForRecommendation =
    providersCompared.length < 2
      ? providersCompared.length === 0
        ? "No comparable workload was found in the dataset."
        : `Only ${providersCompared[0]} has comparable workload in this dataset, ` +
          "so no cross-provider recommendation can be made. Ingest FOCUS data " +
          "for a second provider to enable the comparison."
      : scores.length === 0
        ? "The compared providers share no workload that can be scored on the " +
          "same basis, so no ranking exists to recommend from. Each provider " +
          "runs services the others do not."
        : null;

  return {
    providersPresent,
    providersCompared,
    window,
    currency,
    archetypes,
    scores,
    weights,
    totalsByProvider,
    coverage: {
      totalCells,
      observedCells,
      ratio: totalCells > 0 ? observedCells / totalCells : 0,
    },
    references: [
      { ...SLA_REFERENCE },
      { ...CAPACITY_REFERENCE },
    ],
    insufficientForRecommendation,
  };
}
