/**
 * Guardrails for the AI narrative.
 *
 * The deterministic comparison is already deliverable. The narrative is an
 * optional layer whose only job is to read well, and it is allowed through
 * only if it can be shown not to have introduced anything.
 *
 * The tests here are mechanical on purpose. "Does this prose seem reasonable?"
 * is a judgement no reviewer will make consistently at three in the afternoon
 * before a customer call; "does every number in this prose exist in the facts"
 * is a check that never gets tired.
 */

import type { CloudProvider } from "../customer-data/contract";
import type { MulticloudNarrativeResponse } from "./contract";
import { projectFactsForModel } from "./projection";
import type { MulticloudFacts } from "./types";

export interface GuardrailViolation {
  rule: string;
  detail: string;
}

/**
 * Every number the narrative may quote: exactly the numbers it was shown.
 *
 * Walked out of the projection rather than assembled from the facts. Two
 * consequences, both wanted. An internal intermediate the model never receives
 * — a weighted score contribution, say — can no longer authorise a figure that
 * happens to sit near it. And the allowed set stays small, which is what makes
 * the check bite: with hundreds of facts each contributing several roundings,
 * the set grows dense enough that almost any invention lands within tolerance
 * of something and the guardrail quietly stops guarding.
 */
function factNumbers(facts: MulticloudFacts): number[] {
  const numbers: number[] = [];

  const push = (value: number) => {
    if (!Number.isFinite(value)) return;
    numbers.push(value);
    for (const dp of [0, 1, 2]) numbers.push(Number(value.toFixed(dp)));
  };

  const walk = (node: unknown) => {
    if (typeof node === "number") {
      push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node !== null && typeof node === "object") {
      Object.values(node).forEach(walk);
    }
  };

  walk(projectFactsForModel(facts));
  return numbers;
}

/**
 * Numbers a narrative may use without them appearing in the facts.
 *
 * Commitment terms and small ordinals are structural vocabulary — "the 3-year
 * rate", "the top two providers" — not measurements, and rejecting them would
 * make ordinary English unwritable.
 */
const STRUCTURAL = new Set([0, 1, 2, 3, 4, 5, 12, 36]);

/** Numeric tokens in a string, with currency and thousands separators removed. */
function numbersIn(text: string): number[] {
  const matches = text.match(/-?\d[\d,]*\.?\d*/g) ?? [];
  return matches
    .map((raw) => Number(raw.replace(/,/g, "")))
    .filter((n) => Number.isFinite(n));
}

/**
 * Anchoring: every number in the prose traces to a number in the facts.
 *
 * A 1% relative tolerance absorbs rounding — the model writing "$0.19" for a
 * stored 0.192 is quoting the fact — while still catching a fabricated figure,
 * because inventions are not off by half a percent, they are off by a factor.
 */
function unanchoredNumbers(text: string, allowed: number[]): number[] {
  return numbersIn(text).filter((value) => {
    if (STRUCTURAL.has(value)) return false;
    return !allowed.some((fact) => {
      if (fact === value) return true;
      const scale = Math.max(Math.abs(fact), Math.abs(value));
      if (scale === 0) return true;
      return Math.abs(fact - value) / scale <= 0.01;
    });
  });
}

const ALL_PROVIDERS: CloudProvider[] = ["Azure", "AWS", "GCP", "Other"];

/** Every date the narrative is entitled to quote. */
function factDates(facts: MulticloudFacts): string[] {
  return [
    facts.window.from,
    facts.window.toExclusive,
    ...facts.window.providerSpans.flatMap((s) => [s.from, s.toExclusive]),
    ...facts.references.map((r) => r.capturedAt),
  ];
}

const ISO_DATE = /\d{4}-\d{2}-\d{2}/g;

/**
 * Removes dates the facts contain, and reports any that they do not.
 *
 * Dates have to be handled before numbers, not alongside them: `2026-01-01` is
 * a single fact, but a naive numeric scan reads it as 2026, -1 and -1, and
 * would reject the model for correctly quoting the comparison window.
 */
function extractDates(
  text: string,
  allowed: string[],
): { stripped: string; unanchored: string[] } {
  const unanchored: string[] = [];
  const stripped = text.replace(ISO_DATE, (match) => {
    if (!allowed.includes(match)) unanchored.push(match);
    return " ";
  });
  return { stripped, unanchored };
}

/**
 * Claims the narrative is never allowed to make, because nothing in the
 * pipeline measured them.
 *
 * These are the specific hallucinations this feature invites: a comparison of
 * prices reads like a comparison of clouds, and a model asked to be helpful
 * will reach for payback periods, carbon and compliance that no billing export
 * contains.
 */
const FORBIDDEN_CLAIMS: Array<{ pattern: RegExp; subject: string }> = [
  { pattern: /\bpayback\b|\broi\b|\bbreak[- ]even\b/i, subject: "payback or ROI" },
  { pattern: /\bcarbon\b|\bsustainab/i, subject: "carbon or sustainability" },
  { pattern: /\bgdpr\b|\blgpd\b|\bhipaa\b|\bcomplian/i, subject: "compliance" },
  { pattern: /\blatency\b|\bthroughput\b|\biops\b/i, subject: "measured performance" },
  { pattern: /\bmigrat\w+ (?:will|takes?|costs?) \b/i, subject: "migration effort" },
];

/**
 * Validates a model response against the facts it was given.
 *
 * Returns every violation rather than the first, so a rejected narrative can be
 * diagnosed in one pass instead of one round trip per problem.
 */
export function validateNarrative(
  response: MulticloudNarrativeResponse,
  facts: MulticloudFacts,
): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];
  const allowed = factNumbers(facts);
  const allowedDates = factDates(facts);

  const fields: Array<[string, string]> = [
    ["summary", response.summary],
    ["recommendation", response.recommendation],
    ...response.tradeoffs.map(
      (t, i) => [`tradeoffs[${i}]`, t] as [string, string],
    ),
  ];

  const fullText = fields.map(([, text]) => text).join(" ");

  // 1. Anchoring.
  for (const [field, text] of fields) {
    const dates = extractDates(text, allowedDates);
    if (dates.unanchored.length > 0) {
      violations.push({
        rule: "anchored-numbers",
        detail: `${field} cites the date(s) ${dates.unanchored.join(", ")}, which are not in the facts.`,
      });
    }

    const unanchored = unanchoredNumbers(dates.stripped, allowed);
    if (unanchored.length > 0) {
      violations.push({
        rule: "anchored-numbers",
        detail: `${field} cites ${unanchored.join(", ")}, which do not appear in the facts.`,
      });
    }
  }

  // 2. No provider outside the comparison.
  const absent = ALL_PROVIDERS.filter(
    (p) => !facts.providersCompared.includes(p),
  );
  for (const provider of absent) {
    if (provider === "Other") continue;
    const mentioned = new RegExp(`\\b${provider}\\b`, "i").test(fullText);
    if (mentioned) {
      violations.push({
        rule: "no-unobserved-provider",
        detail:
          `${provider} has no observed rate in this dataset but is discussed ` +
          `as though it does.`,
      });
    }
  }

  // 3. No recommendation the data cannot support.
  if (facts.insufficientForRecommendation) {
    violations.push({
      rule: "no-unsupported-recommendation",
      detail:
        "The dataset cannot support a cross-provider recommendation, so the " +
        "narrative must be suppressed entirely.",
    });
  }

  // 4. The recommendation may not contradict the ranking. The ranking is the
  //    deterministic output; prose that inverts it presents an opinion in the
  //    costume of a calculation.
  const best = facts.scores[0];
  if (best && facts.scores.length > 1) {
    const losers = facts.scores.slice(1).map((s) => s.provider);
    const recommendsLoser = losers.find((p) =>
      new RegExp(`\\brecommend\\w*\\b[^.]*\\b${p}\\b`, "i").test(
        response.recommendation,
      ),
    );
    const mentionsWinner = new RegExp(`\\b${best.provider}\\b`, "i").test(
      response.recommendation,
    );
    if (recommendsLoser && !mentionsWinner) {
      violations.push({
        rule: "consistent-with-ranking",
        detail:
          `The recommendation favours ${recommendsLoser}, but ${best.provider} ` +
          `ranks highest and is not mentioned.`,
      });
    }
  }

  // 5. No claims about things never measured.
  for (const { pattern, subject } of FORBIDDEN_CLAIMS) {
    if (pattern.test(fullText)) {
      violations.push({
        rule: "no-unmeasured-claims",
        detail: `The narrative makes a claim about ${subject}, which this pipeline does not measure.`,
      });
    }
  }

  return violations;
}
