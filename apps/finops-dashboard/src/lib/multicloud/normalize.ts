/**
 * Unit normalization: turning vendor-authored `PricingUnit` text into a
 * quantity that can be divided into cost and compared across clouds.
 *
 * This is the least glamorous file in the feature and the one most likely to
 * silently produce a wrong answer. FOCUS `PricingUnit` is free text written by
 * each vendor's billing pipeline. The same hour appears as "1 Hour", "Hrs",
 * "hour", "Hours"; storage appears as "1 GB/Month", "GB-Mo", "GiB-month"; and
 * — the dangerous case — some meters bill in *batches*: "100 Hours",
 * "10,000 requests", "1M tokens". A parser that ignores the multiplier
 * understates the quantity by up to six orders of magnitude, which shows up as
 * a spectacular and entirely fictional price advantage.
 *
 * Two decisions keep this honest:
 *
 *  1. The leading multiplier is always parsed and applied.
 *  2. An unrecognised unit returns null rather than a guess. The cell then
 *     reports "no quantity reported" instead of a fabricated rate.
 */

import type { CanonicalUnit } from "./types";
import type { ArchetypeId } from "./types";

/** Result of interpreting one row's unit and quantity. */
export interface NormalizedQuantity {
  unit: CanonicalUnit;
  /** Quantity restated in `unit`. */
  quantity: number;
}

/**
 * GiB vs GB is a 7.4% difference and vendors mix the two.
 *
 * The comparison does not silently convert between them: doing so would imply
 * a precision the billing data does not carry. Both are mapped to the same
 * canonical unit and the residual difference is accepted as noise, which is
 * documented rather than hidden because it is smaller than the spreads the
 * view is built to detect (and the alternative — dropping half the rows — is
 * worse).
 */
export const BINARY_DECIMAL_NOTE =
  "Vendors mix GB and GiB in their pricing units. Both are treated as one " +
  "unit here; the residual ~7% difference is below the spread this view is " +
  "designed to surface.";

/**
 * Multiplier prefixing a unit string: "100 Hours" → 100, "1M tokens" → 1e6.
 *
 * Returns the multiplier *and* the remaining text, from one match. Two regexes
 * — one to read the prefix, one to strip it — is a bug waiting to happen: they
 * disagreed on "1 Million tokens", where the stripper ate the `M` that the
 * reader had declined to treat as a scale, leaving "illion tokens" and a
 * denominator wrong by six orders of magnitude.
 */
function leadingMultiplier(raw: string): { multiplier: number; rest: string } {
  const match = raw.match(/^\s*([\d.,]+)\s*(k|m|b|thousand|million|billion)?\b\s*/i);
  if (!match) return { multiplier: 1, rest: raw };

  const rest = raw.slice(match[0].length);
  const digits = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(digits) || digits <= 0) return { multiplier: 1, rest };

  const scale = match[2]?.toLowerCase();
  const factor =
    scale === "k" || scale === "thousand"
      ? 1e3
      : scale === "m" || scale === "million"
        ? 1e6
        : scale === "b" || scale === "billion"
          ? 1e9
          : 1;

  return { multiplier: digits * factor, rest };
}

/**
 * Byte magnitudes, expressed in GiB, largest first.
 *
 * The magnitude has to be read, not just the fact that a unit is a byte unit.
 * A meter billed in `TB` whose quantity is counted as GB understates the
 * denominator a thousandfold, and a thousandfold understatement of quantity is
 * a thousandfold *overstatement* of the unit rate.
 */
const BYTE_MAGNITUDES: Array<{ pattern: RegExp; gib: number }> = [
  { pattern: /\b(pb|pib|petabytes?|pebibytes?)\b/, gib: 1024 * 1024 },
  { pattern: /\b(tb|tib|terabytes?|tebibytes?)\b/, gib: 1024 },
  { pattern: /\b(gb|gib|gigabytes?|gibibytes?)\b/, gib: 1 },
  { pattern: /\b(mb|mib|megabytes?|mebibytes?)\b/, gib: 1 / 1024 },
];

/** GiB per unit of the given byte meter, or null when it is not a byte meter. */
function byteScaleGib(u: string): number | null {
  for (const { pattern, gib } of BYTE_MAGNITUDES) {
    if (pattern.test(u)) return gib;
  }
  return null;
}

/**
 * Time and volume dimensions, detected separately.
 *
 * Vendors write the same meter as "1 GB/Month", "GB-Mo", "GB-Months" and
 * "gibibyte month". A single combined regex that happens to cover the spellings
 * in one dataset silently stops matching when a vendor renames a meter, and an
 * unmatched unit becomes an empty cell — a failure that presents as missing
 * data rather than as the parsing bug it is. Plurals are therefore explicit on
 * every alternative.
 */
const MONTHLY = /\b(months?|mos?)\b/;
const HOURLY = /\b(hours?|hrs?)\b/;
const TOKENS = /token/;
const OPERATIONS = /(request|invocation|operation|transaction|execution)/;

/**
 * Decides which canonical family a unit string belongs to.
 *
 * `expected` participates only where the unit text is genuinely ambiguous. A
 * byte meter with no time dimension is a *volume* — either data transferred out
 * or data scanned — and no vendor writes which one in `PricingUnit`: BigQuery
 * bills `tebibyte`, Athena bills `TB`, and egress bills `GB`. The archetype is
 * the only thing that knows, so it decides, and only between those two.
 */
function detectFamily(u: string, expected: CanonicalUnit): CanonicalUnit | null {
  const hasBytes = byteScaleGib(u) !== null;
  const monthly = MONTHLY.test(u);
  const hourly = HOURLY.test(u);

  if (hasBytes && monthly) return "gib-month";
  if (hasBytes && hourly) return "gib-hour";
  if (TOKENS.test(u)) return "thousand-tokens";
  if (OPERATIONS.test(u)) return "million-requests";
  if (hasBytes) return expected === "tb-scanned" ? "tb-scanned" : "gb-egress";
  if (hourly) return "vcpu-hour";
  return null;
}

/**
 * Interprets a row's `pricingUnit` and `consumedQuantity`.
 *
 * `expected` is the archetype's canonical unit. When the parsed unit family
 * disagrees with it, the row is rejected rather than coerced: a storage meter
 * that wandered into the compute archetype must not be counted as vCPU-hours,
 * and a mismatch is evidence the taxonomy matched something it should not
 * have.
 *
 * Returns null when the unit is unrecognised, the quantity is not positive, or
 * the family disagrees. Callers surface that as "no quantity reported".
 */
export function normalizeQuantity(
  pricingUnit: string,
  consumedQuantity: number,
  expected: CanonicalUnit,
): NormalizedQuantity | null {
  if (!Number.isFinite(consumedQuantity) || consumedQuantity <= 0) return null;

  const raw = (pricingUnit || "").toLowerCase();
  if (!raw.trim()) return null;

  // The multiplier is stripped before family detection so "100 Hours" is still
  // an hour meter, then reapplied to the quantity.
  const { multiplier, rest } = leadingMultiplier(raw);
  const bare = rest.trim();
  if (!bare) return null;

  const matched = detectFamily(bare, expected);
  if (!matched) return null;

  // `cluster-hour` and `vcpu-hour` are both hour meters and are
  // indistinguishable from the unit text alone — only the archetype knows
  // which one it is asking for, so an hour meter satisfies either.
  const isHourFamily = matched === "vcpu-hour";
  const compatible =
    matched === expected ||
    (isHourFamily && expected === "cluster-hour") ||
    (isHourFamily && expected === "vcpu-hour");
  if (!compatible) return null;

  const inSourceUnits = consumedQuantity * multiplier;
  const bytes = byteScaleGib(bare) ?? 1;

  // Byte meters are rescaled to the canonical magnitude; count meters are
  // divided down to their canonical batch. Everything else is already there.
  let quantity: number;
  switch (expected) {
    case "gib-month":
    case "gib-hour":
    case "gb-egress":
      quantity = inSourceUnits * bytes;
      break;
    case "tb-scanned":
      quantity = (inSourceUnits * bytes) / 1024;
      break;
    case "thousand-tokens":
      quantity = inSourceUnits / 1_000;
      break;
    case "million-requests":
      quantity = inSourceUnits / 1_000_000;
      break;
    default:
      quantity = inSourceUnits;
  }

  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  return { unit: expected, quantity };

}

/**
 * Published SLA per provider and archetype, as a monthly availability
 * fraction.
 *
 * This is reference data, not customer data: it is not derivable from a
 * billing export, and it is emphatically not something to ask a language model
 * for at request time. Values are the vendors' published single-region service
 * commitments. They are deliberately coarse — the point is to stop a reader
 * from choosing a cheaper option that carries a materially weaker commitment,
 * not to adjudicate credits.
 *
 * Update this table and `SLA_REFERENCE.capturedAt` together.
 */
export const SLA_REFERENCE_TABLE: Partial<
  Record<ArchetypeId, Partial<Record<"Azure" | "AWS" | "GCP", number>>>
> = {
  "general-purpose-compute": { Azure: 0.9995, AWS: 0.9995, GCP: 0.9995 },
  "object-storage": { Azure: 0.9999, AWS: 0.9999, GCP: 0.9999 },
  "managed-kubernetes": { Azure: 0.9995, AWS: 0.9995, GCP: 0.9995 },
  "relational-database": { Azure: 0.9999, AWS: 0.9995, GCP: 0.9995 },
  "serverless-functions": { Azure: 0.9995, AWS: 0.9995, GCP: 0.9995 },
  "data-warehouse": { Azure: 0.999, AWS: 0.999, GCP: 0.999 },
  "ai-inference": { Azure: 0.999, AWS: 0.99, GCP: 0.999 },
};

/**
 * Relative capacity delivered per canonical unit, per provider.
 *
 * A vCPU is not a constant across vendors: clock speed, generation and
 * simultaneous-multithreading policy all differ, so a vCPU-hour bought from
 * one cloud does not do the same amount of work as a vCPU-hour bought from
 * another. Ignoring this makes the cheapest vCPU-hour look like the best deal
 * even when it delivers less work.
 *
 * Values are indices around 1.0, not benchmark scores, and they are the
 * weakest evidence in this feature — which is why the performance index they
 * feed can be switched off entirely from the UI, and why the provenance is
 * always rendered.
 */
export const CAPACITY_INDEX_TABLE: Partial<
  Record<ArchetypeId, Partial<Record<"Azure" | "AWS" | "GCP", number>>>
> = {
  "general-purpose-compute": { Azure: 1.0, AWS: 1.0, GCP: 1.05 },
  "relational-database": { Azure: 1.0, AWS: 1.0, GCP: 1.0 },
};

export const SLA_REFERENCE = {
  name: "Published service-level agreements",
  capturedAt: "2026-02-01",
  note:
    "Vendor-published single-region monthly availability commitments. " +
    "Coarse by design: used to flag a materially weaker commitment, not to " +
    "adjudicate service credits.",
} as const;

export const CAPACITY_REFERENCE = {
  name: "Relative capacity per vCPU-hour",
  capturedAt: "2026-02-01",
  note:
    "Indices around 1.0 reflecting that a vCPU-hour is not constant across " +
    "vendors. The weakest evidence in this comparison; the performance index " +
    "can be disabled from the weight controls.",
} as const;
