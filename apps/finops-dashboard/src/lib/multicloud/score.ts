/**
 * The composite cost-benefit score.
 *
 * A single number is what a decision maker asks for and the easiest thing to
 * get wrong, because it hides the judgement that produced it. Three rules keep
 * this one defensible:
 *
 *  1. The score never travels without its breakdown. Every surface that shows
 *     a score shows what went into it.
 *  2. Weights are the reader's, not ours. An egress-heavy workload and an
 *     internal batch workload genuinely have different answers, so the weights
 *     are adjustable and the defaults are only defaults.
 *  3. An index with no data is *excluded* and the remaining weights are
 *     renormalized. It is never given a neutral value, because a neutral value
 *     is a measurement claim — it says "average" when the truth is "unknown" —
 *     and it drags every provider toward the middle, flattening exactly the
 *     differences the view exists to find.
 */

import type { CloudProvider } from "../customer-data/contract";
import { CAPACITY_INDEX_TABLE, SLA_REFERENCE_TABLE } from "./normalize";
import type {
  ArchetypeComparison,
  ScoreBreakdown,
  ScoreComponent,
  ScoreIndexId,
  ScoreWeights,
} from "./types";

/**
 * Defaults lean on price because it is the only index measured from the
 * customer's own invoices; the other three lean on reference data of
 * progressively weaker provenance.
 */
export const DEFAULT_WEIGHTS: ScoreWeights = {
  price: 0.5,
  performance: 0.2,
  sla: 0.15,
  egress: 0.15,
};

/** Scales weights to sum to 1, ignoring negatives. */
export function normalizeWeights(weights: ScoreWeights): ScoreWeights {
  const safe: ScoreWeights = {
    price: Math.max(0, weights.price),
    performance: Math.max(0, weights.performance),
    sla: Math.max(0, weights.sla),
    egress: Math.max(0, weights.egress),
  };
  const total = safe.price + safe.performance + safe.sla + safe.egress;
  if (total <= 0) return { ...DEFAULT_WEIGHTS };
  return {
    price: safe.price / total,
    performance: safe.performance / total,
    sla: safe.sla / total,
    egress: safe.egress / total,
  };
}

/**
 * Every index returns a **badness ratio**: 1.0 for the best provider on that
 * index, 2.0 for one that is twice as bad, and so on.
 *
 * This replaced min-max scaling, which was actively misleading here. Mapping
 * values onto `(v - min)/(max - min)` means that with exactly two providers —
 * the common case for this feature — the cheaper always scores 100 and the
 * dearer always 0, whether the gap is 0.5% or 500%. The composite score is the
 * number a CFO reads, and it must not report a decisive verdict built from a
 * rounding-level difference. A ratio keeps the size of the gap.
 */
function ratiosToBest(
  badness: Map<CloudProvider, number>,
): Map<CloudProvider, number> {
  const out = new Map<CloudProvider, number>();
  const values = Array.from(badness.values()).filter((v) => v > 0 && Number.isFinite(v));
  if (values.length === 0) return out;

  const best = Math.min(...values);
  for (const [provider, value] of Array.from(badness.entries())) {
    if (!(value > 0) || !Number.isFinite(value)) continue;
    out.set(provider, value / best);
  }
  return out;
}

/** Mean of a provider's per-archetype ratios. */
function meanRatios(
  collected: Map<CloudProvider, number[]>,
): Map<CloudProvider, number> {
  const out = new Map<CloudProvider, number>();
  for (const [provider, list] of Array.from(collected.entries())) {
    if (list.length === 0) continue;
    out.set(provider, list.reduce((a: number, b: number) => a + b, 0) / list.length);
  }
  return out;
}

/** Observed on-demand rate for a provider in one archetype, or null. */
function onDemandRate(
  archetype: ArchetypeComparison,
  provider: CloudProvider,
): number | null {
  const cell = archetype.cells[provider]?.["on-demand"];
  return cell?.observed ? cell.rate : null;
}

/**
 * Archetypes where *every* compared provider has an observed on-demand rate.
 *
 * Every index is restricted to these. Averaging over whichever archetypes each
 * provider happens to run compares different things: a provider running both
 * compute and a database is averaged against one running compute alone, and
 * since those two archetypes differ by an order of magnitude in every
 * reference table, the first is ranked last for reasons that have nothing to
 * do with its prices.
 */
function comparableArchetypes(
  archetypes: ArchetypeComparison[],
  providers: CloudProvider[],
): ArchetypeComparison[] {
  if (providers.length === 0) return [];
  return archetypes.filter((archetype) =>
    providers.every((p) => {
      const rate = onDemandRate(archetype, p);
      return rate !== null && rate > 0;
    }),
  );
}

/**
 * Price index: the provider's on-demand rate relative to the cheapest observed
 * rate, averaged across the commonly-observed archetypes.
 *
 * Averaging *ratios* rather than raw rates is essential. Raw rates live in
 * incompatible units — a GB-month and a vCPU-hour cannot be summed — and
 * averaging them would let whichever archetype happens to carry the largest
 * absolute number dominate the index.
 */
function priceIndex(
  archetypes: ArchetypeComparison[],
  providers: CloudProvider[],
): Map<CloudProvider, number> {
  const ratios = new Map<CloudProvider, number[]>();

  for (const archetype of comparableArchetypes(archetypes, providers)) {
    const rates = providers.map((p) => onDemandRate(archetype, p)!);
    const cheapest = Math.min(...rates);
    if (!(cheapest > 0)) continue;

    providers.forEach((provider, i) => {
      const list = ratios.get(provider) ?? [];
      list.push(rates[i] / cheapest);
      ratios.set(provider, list);
    });
  }

  return meanRatios(ratios);
}

/**
 * Performance index: capacity delivered per unit of cost, as a ratio to the
 * best provider in each archetype.
 *
 * Rests on `CAPACITY_INDEX_TABLE`, the weakest reference data in the feature,
 * and covers only the archetypes where a vCPU actually means something.
 */
function performanceIndex(
  archetypes: ArchetypeComparison[],
  providers: CloudProvider[],
): Map<CloudProvider, number> {
  const ratios = new Map<CloudProvider, number[]>();

  for (const archetype of comparableArchetypes(archetypes, providers)) {
    const capacities = CAPACITY_INDEX_TABLE[archetype.archetypeId];
    if (!capacities) continue;

    // Every compared provider needs a capacity reference, otherwise the
    // archetype ranks providers on which ones the reference table happens to
    // cover.
    const perf = providers.map((provider) => {
      const capacity = capacities[provider as "Azure" | "AWS" | "GCP"];
      const rate = onDemandRate(archetype, provider)!;
      return capacity === undefined ? null : capacity / rate;
    });
    if (perf.some((p) => p === null || !(p > 0))) continue;

    const best = Math.max(...(perf as number[]));
    providers.forEach((provider, i) => {
      const list = ratios.get(provider) ?? [];
      list.push(best / (perf[i] as number));
      ratios.set(provider, list);
    });
  }

  return meanRatios(ratios);
}

/**
 * SLA index, scored on **downtime** rather than on the availability figure.
 *
 * 99.99% and 99.9% look almost identical as numbers and differ by a factor of
 * ten in minutes lost per month. Scoring the availability figure directly would
 * make every provider score ~100 and render the index inert; scoring the
 * complement is what the SLA is actually about.
 */
function slaIndex(
  archetypes: ArchetypeComparison[],
  providers: CloudProvider[],
): Map<CloudProvider, number> {
  const ratios = new Map<CloudProvider, number[]>();

  for (const archetype of comparableArchetypes(archetypes, providers)) {
    const slas = SLA_REFERENCE_TABLE[archetype.archetypeId];
    if (!slas) continue;

    const downtime = providers.map((provider) => {
      const sla = slas[provider as "Azure" | "AWS" | "GCP"];
      // The table stores availability as a fraction (0.9999), so the
      // complement is `1 - sla`, not `100 - sla`. Subtracting from 100 would
      // yield ~99 for every provider and a ratio of ~1.000004 — the index
      // would still be weighted, shown in the breakdown and named in
      // `participatingIndices` while carrying no information at all.
      //
      // Floored rather than allowed to reach zero: a published 100% SLA is a
      // commercial statement, not an absence of outages, and dividing by it
      // would hand one provider an unbounded advantage.
      return sla === undefined ? null : Math.max(1 - sla, 1e-6);
    });
    if (downtime.some((d) => d === null)) continue;

    const best = Math.min(...(downtime as number[]));
    providers.forEach((provider, i) => {
      const list = ratios.get(provider) ?? [];
      list.push((downtime[i] as number) / best);
      ratios.set(provider, list);
    });
  }

  return meanRatios(ratios);
}

/** Egress index: the observed per-GB egress rate, as a ratio to the cheapest. */
function egressIndex(
  archetypes: ArchetypeComparison[],
  providers: CloudProvider[],
): Map<CloudProvider, number> {
  const egress = archetypes.find((a) => a.archetypeId === "network-egress");
  const rates = new Map<CloudProvider, number>();
  if (!egress) return rates;

  for (const provider of providers) {
    const rate = onDemandRate(egress, provider);
    if (rate !== null && rate > 0) rates.set(provider, rate);
  }
  return ratiosToBest(rates);
}

const OMITTED: Record<ScoreIndexId, string> = {
  price: "No archetype was observed on-demand for every compared provider.",
  performance: "No capacity reference covers the commonly-observed archetypes.",
  sla: "No SLA reference covers the commonly-observed archetypes.",
  egress: "No egress rate was observed for the compared providers.",
};

/**
 * Scores each compared provider.
 *
 * An index participates only when it produced a value for *every* compared
 * provider. A half-populated index would rank providers on data that exists
 * for some of them and not others, which is worse than not using it: the
 * provider with the missing value would be penalised for a reporting gap
 * rather than for anything about its offering.
 */
export function scoreProviders(
  archetypes: ArchetypeComparison[],
  providers: CloudProvider[],
  weights: ScoreWeights,
): ScoreBreakdown[] {
  if (providers.length === 0) return [];

  // Each index is a badness ratio: 1.0 is best, 2.0 is twice as bad.
  const raw: Record<ScoreIndexId, Map<CloudProvider, number>> = {
    price: priceIndex(archetypes, providers),
    performance: performanceIndex(archetypes, providers),
    sla: slaIndex(archetypes, providers),
    egress: egressIndex(archetypes, providers),
  };

  const complete = (Object.keys(raw) as ScoreIndexId[]).filter(
    (id) => providers.every((p) => raw[id].has(p)) && weights[id] > 0,
  );

  const participatingWeight = complete.reduce((a, id) => a + weights[id], 0);

  // No index cleared the bar — typically because the providers share no
  // archetype, so `comparableArchetypes()` is empty. Scoring anyway gives every
  // provider 0.0 and an order determined solely by input order, which the UI
  // would render as a podium and the narrative would be asked to justify.
  // An unrankable comparison must be returned as unranked, not as a tie.
  if (complete.length === 0) return [];

  return providers
    .map((provider) => {
      const components: ScoreComponent[] = (
        Object.keys(raw) as ScoreIndexId[]
      ).map((id) => {
        if (!complete.includes(id)) {
          return {
            indexId: id,
            value: null,
            weightApplied: 0,
            contribution: 0,
            omittedReason:
              weights[id] === 0 ? "Weight set to zero." : OMITTED[id],
          };
        }
        // 100 for the best provider, 50 for one twice as bad. Proportional, so
        // a small real difference stays a small difference in the score.
        const value = 100 / raw[id].get(provider)!;
        const weightApplied =
          participatingWeight > 0 ? weights[id] / participatingWeight : 0;
        return {
          indexId: id,
          value,
          weightApplied,
          contribution: value * weightApplied,
        };
      });

      return {
        provider,
        score: components.reduce((a, c) => a + c.contribution, 0),
        components,
        participatingIndices: complete,
      };
    })
    .sort((a, b) => b.score - a.score);
}
