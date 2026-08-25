import {
  createChatCompletion,
  getDeployment,
  isTruncatedByReasoning,
} from "../openai-client";
import { refinedCardsSchema } from "./contract";
import { validateRefinedCard } from "./guardrails";
import type {
  CardRefinementLog,
  PersonaId,
  StakeholderCard,
  StakeholderCardsPayload,
} from "./types";

/**
 * AI layer — optional and always protected by guardrails.
 *
 * The deterministic card is already shareable. AI only rewrites `headline`,
 * `why_it_matters`, and `next_action` to make them sound written *for* that
 * person. `metrics` and `caveats` are immutable: the model does not even
 * receive them as editable.
 */

/** Output budget per card. */
const TOKENS_PER_CARD = 320;
/** Minimum so a one-card payload still has headroom. */
const MIN_VISIBLE_TOKENS = 900;

/**
 * The limit must grow with the number of cards.
 *
 * Without this, the model is asked to write N more blocks under a limit sized
 * for none of them: the response truncates in the middle of JSON, parsing
 * fails, and the run silently degrades — a failure that *looks* like "the
 * model did not help" when it was actually underfunded.
 */
export function tokenBudgetFor(cardCount: number): number {
  return Math.max(MIN_VISIBLE_TOKENS, cardCount * TOKENS_PER_CARD);
}

const SYSTEM_PROMPT = `Rewrite executive FinOps card text in English.

NON-NEGOTIABLE RULES:
1. REFRAME; NEVER RECALCULATE. Use only figures already in the card. Do not add, subtract, convert, or project. Do not introduce new numbers.
2. WRITE *TO* THE PERSON; NEVER *ABOUT* THEM. Do not say "For the CFO, ...". They already know who they are; third person makes the card sound like a report about them.
3. DO NOT IMPORT A METRIC FROM ANOTHER CARD. A corporate total on the Application Owner card destroys the only reason for that card to exist.
4. NEVER SOFTEN A BLOCKER, DEADLINE, OR PREREQUISITE. A card that hides a conclusion is worse than no card.
5. METRICS FROM DIFFERENT SCOPES MUST BE IN SEPARATE SENTENCES — never joined by "of which", "including", or similar phrasing.
6. Do not invent capabilities: do not cite SLA, RTO, RPO, IOPS, carbon, sustainability, or regulatory compliance — none was assessed.
7. Retain numbers cited in the original text. Prose that cited numbers must not return with none.
8. Do not alter metrics or caveats: you do not receive them for editing.

FORMAT: return valid JSON only:
{"cards":[{"persona":"<id>","headline":"<one sentence>","why_it_matters":"<two to three sentences>","next_action":"<action THIS person can authorize>"}]}`;

/**
 * Projects cards into facts sent to the model.
 *
 * Cards **must** be in the payload. Otherwise the model is silently forbidden
 * from citing numbers in its own card. This is why anchoring tests start by
 * removing cards from the payload — otherwise they become tautological: the
 * card validates itself.
 */
export function projectCardsForModel(cards: StakeholderCard[]) {
  return cards.map((card) => ({
    persona: card.persona,
    title: card.title,
    question: card.question,
    focus: card.focus,
    headline: card.headline,
    why_it_matters: card.whyItMatters,
    next_action: card.nextAction,
    metrics: card.metrics.map((m) => ({
      label: m.label,
      value: m.value,
      tip: m.tip,
      raw: m.raw,
    })),
    caveats: card.caveats,
  }));
}

export interface RefinementOutcome {
  cards: StakeholderCard[];
  log: CardRefinementLog[];
  model: string;
}

/**
 * Applies refinement card by card.
 *
 * Validation is per card: a bad card does not bring down the whole narrative.
 * When a guardrail rejects a card, it returns to deterministic text and the
 * reason is recorded.
 */
export function applyRefinement(
  cards: StakeholderCard[],
  refined: { persona: PersonaId; headline: string; why_it_matters: string; next_action: string }[],
): { cards: StakeholderCard[]; log: CardRefinementLog[] } {
  const known = new Set<PersonaId>(cards.map((c) => c.persona));
  const byPersona = new Map(refined.map((r) => [r.persona, r]));
  const log: CardRefinementLog[] = [];

  const output = cards.map((card) => {
    const candidate = byPersona.get(card.persona);
    if (!candidate) {
      log.push({
        persona: card.persona,
        state: "deterministic",
        reason: "the model did not return this card",
      });
      return card;
    }

    const fields = {
      headline: candidate.headline,
      whyItMatters: candidate.why_it_matters,
      nextAction: candidate.next_action,
    };

    const verdict = validateRefinedCard(card, fields, known);
    if (!verdict.ok) {
      log.push({
        persona: card.persona,
        state: "rejected",
        failedGuardrail: verdict.guardrail,
        reason: verdict.reason,
      });
      return card;
    }

    log.push({ persona: card.persona, state: "refined" });
    return { ...card, ...fields };
  });

  return { cards: output, log };
}

/** Extracts JSON from the response while tolerating code fences. */
function parseModelJson(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : content).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < 0) {
    throw new Error("the model did not return JSON");
  }
  return JSON.parse(raw.slice(start, end + 1));
}

/** Calls the model and returns the payload with refined cards and the log. */
export async function refineStakeholderCards(
  payload: StakeholderCardsPayload,
): Promise<StakeholderCardsPayload> {
  const model = getDeployment();

  const userPrompt = JSON.stringify(
    {
      currency: payload.currency,
      collection_coverage: payload.coverage,
      cards: projectCardsForModel(payload.cards),
    },
    null,
    2,
  );

  const response = await createChatCompletion({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    max_tokens: tokenBudgetFor(payload.cards.length),
    temperature: 0.3,
  });

  if (isTruncatedByReasoning(response)) {
    throw new Error(
      "response was truncated by the token budget before producing text",
    );
  }

  const content = response.choices[0]?.message?.content ?? "";
  const parsed = refinedCardsSchema.parse(parseModelJson(content));
  const { cards, log } = applyRefinement(payload.cards, parsed.cards);

  return { ...payload, cards, refinement: { model, log } };
}
