import { z } from "zod";

import { PERSONA_IDS } from "./catalog";
import type { PersonaId } from "./types";

/**
 * Model response contract.
 *
 * AI rewrites exactly three fields. `metrics` and `caveats` intentionally do
 * not appear here: what is outside the contract cannot be changed.
 */
export const refinedCardSchema = z.object({
  persona: z.enum(PERSONA_IDS as unknown as [PersonaId, ...PersonaId[]]),
  headline: z.string().min(1),
  why_it_matters: z.string().min(1),
  next_action: z.string().min(1),
});

export const refinedCardsSchema = z.object({
  cards: z.array(refinedCardSchema).min(1),
});

export type RefinedCardResponse = z.infer<typeof refinedCardSchema>;
