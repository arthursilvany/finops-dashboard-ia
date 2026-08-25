import { z } from "zod";

/**
 * Contract for the model's response.
 *
 * Three prose fields, nothing else. There is no field for a rate, a saving, a
 * percentage or a ranking, because what is not in the contract cannot be
 * changed by the model — the schema is the enforcement mechanism, not the
 * prompt.
 *
 * `provider_notes` is keyed by provider so the UI can place each note beside
 * the provider it describes without the model being able to introduce a
 * provider that is not in the comparison.
 */
export const multicloudNarrativeSchema = z.object({
  /** One paragraph stating what the comparison shows. */
  summary: z.string().min(1),
  /**
   * The trade-offs a reader must weigh. Prose only: each entry names a tension,
   * it does not quantify one.
   */
  tradeoffs: z.array(z.string().min(1)).min(1).max(5),
  /**
   * What to do next. Suppressed entirely when the dataset cannot support a
   * cross-provider recommendation.
   */
  recommendation: z.string().min(1),
});

export type MulticloudNarrativeResponse = z.infer<
  typeof multicloudNarrativeSchema
>;

/** The narrative as served, after guardrails. */
export interface MulticloudNarrative extends MulticloudNarrativeResponse {
  /**
   * Appended deterministically, never authored by the model: a rate difference
   * is not a business case until migration cost is accounted for.
   */
  caveats: string[];
}
