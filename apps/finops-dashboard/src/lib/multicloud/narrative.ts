/**
 * The AI layer of the multicloud comparison.
 *
 * The rule this module exists to enforce, inherited from `src/lib/stakeholder/`:
 *
 *   The narrative reframes, never recalculates.
 *
 * The model is given the finished arithmetic and asked for prose. It cannot
 * compute, because it is never given anything to compute from — the projection
 * sent upstream contains formatted values and their labels, not the raw series
 * they were derived from. Removing the ingredients is a stronger control than
 * asking the model not to cook.
 */

import {
  createChatCompletion,
  getDeployment,
  isTruncatedByReasoning,
} from "../openai-client";
import {
  multicloudNarrativeSchema,
  type MulticloudNarrative,
  type MulticloudNarrativeResponse,
} from "./contract";
import { validateNarrative, type GuardrailViolation } from "./guardrails";
import { projectFactsForModel } from "./projection";
import {
  COMMITMENT_COMPARABILITY_CAVEAT,
  type MulticloudFacts,
} from "./types";

export { projectFactsForModel };

/**
 * Caveats attached to every narrative, authored here rather than by the model.
 *
 * These are the qualifications that must survive being forwarded, and a model
 * that is asked to include them will eventually decide they read awkwardly and
 * soften one. Appending them deterministically removes that discretion.
 */
export const STANDING_CAVEATS = [
  "Rates are derived from observed billing data only. Cells marked as not " +
    "observed are gaps in the data, not zero cost.",
  "Rate differences are not a business case. Migration effort, egress on exit, " +
    "retraining and dual-running costs are outside this comparison.",
  COMMITMENT_COMPARABILITY_CAVEAT,
];

const SYSTEM_PROMPT = `You are a FinOps analyst writing the executive summary of a
multicloud cost comparison for a cloud architecture review.

The arithmetic is already complete and is given to you. Your job is prose.

Inviolable rules:
1. Do not compute, derive, adjust or round any number. Only quote figures exactly
   as they appear in the payload, in the same form.
2. Never describe a cell marked "not observed" as though it had a value. A gap in
   the data is a gap in the data, not a zero and not a low price.
3. Never recommend a provider that contradicts the ranking in the payload. If you
   believe the ranking is misleading, say why in a tradeoff; do not invert it.
4. Never mention a provider that is not in the payload's compared list.
5. Never make claims about latency, throughput, IOPS, carbon, sustainability,
   compliance, payback periods, ROI or migration effort. Nothing in this dataset
   measures them.
6. Never state or imply a total saving from switching provider. The payload
   measures unit rates, not the cost of moving.
7. Write in English, plainly, for a reader who owns a budget and is not a
   specialist in any of these clouds.

Return JSON matching exactly this shape, with no additional fields:
{
  "summary": "one paragraph on what the comparison shows",
  "tradeoffs": ["1 to 5 short paragraphs, each naming a tension the reader must weigh"],
  "recommendation": "what to do next, grounded in the ranking"
}`;


/**
 * Output budget.
 *
 * Scales with the number of archetypes that actually have something to say —
 * a comparison spanning eight workloads needs more room than one spanning two —
 * with a ceiling, because past a point a longer executive summary is a worse
 * executive summary.
 */
export function tokenBudgetFor(facts: MulticloudFacts): number {
  const comparable = facts.archetypes.filter((a) => a.cheapestProvider !== null);
  return Math.min(1800, 700 + comparable.length * 120);
}

export interface NarrativeResult {
  narrative: MulticloudNarrative | null;
  /** Why no narrative was produced. Null on success. */
  suppressedReason: string | null;
  violations: GuardrailViolation[];
}

function parseResponse(raw: string): MulticloudNarrativeResponse | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    const parsed = multicloudNarrativeSchema.safeParse(
      JSON.parse(raw.slice(start, end + 1)),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Produces the narrative, or explains why there isn't one.
 *
 * Failure is never partial. A narrative that breaches a guardrail is discarded
 * whole rather than patched, because the deterministic comparison is already a
 * complete deliverable — there is nothing to be gained by shipping prose we
 * could not validate alongside a table we could.
 */
export async function buildNarrative(
  facts: MulticloudFacts,
): Promise<NarrativeResult> {
  if (facts.insufficientForRecommendation) {
    return {
      narrative: null,
      suppressedReason: facts.insufficientForRecommendation,
      violations: [],
    };
  }

  if (facts.providersCompared.length < 2) {
    return {
      narrative: null,
      suppressedReason:
        "A narrative requires at least two providers with observed rates.",
      violations: [],
    };
  }

  const payload = projectFactsForModel(facts);

  let response;
  try {
    response = await createChatCompletion({
      model: getDeployment(),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(payload) },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: tokenBudgetFor(facts),
    });
  } catch (error) {
    return {
      narrative: null,
      suppressedReason:
        error instanceof Error
          ? `The narrative service failed: ${error.message}`
          : "The narrative service failed.",
      violations: [],
    };
  }

  if (isTruncatedByReasoning(response)) {
    return {
      narrative: null,
      suppressedReason:
        "The model spent its whole budget reasoning and returned nothing.",
      violations: [],
    };
  }

  const parsed = parseResponse(response.choices[0]?.message?.content ?? "");
  if (!parsed) {
    return {
      narrative: null,
      suppressedReason: "The model response did not match the contract.",
      violations: [],
    };
  }

  const violations = validateNarrative(parsed, facts);
  if (violations.length > 0) {
    return {
      narrative: null,
      suppressedReason:
        "The narrative failed validation against the measured facts.",
      violations,
    };
  }

  return {
    narrative: { ...parsed, caveats: STANDING_CAVEATS },
    suppressedReason: null,
    violations: [],
  };
}
