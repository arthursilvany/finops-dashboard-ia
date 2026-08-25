import type { ParsedFilters } from "../filter-schema";
import type { PersonaTitleOverrides } from "./catalog";
import { buildStakeholderCards } from "./builders";
import { buildStakeholderFacts } from "./facts";
import type { StakeholderCardsPayload, StakeholderFacts } from "./types";

export const STAKEHOLDER_SCHEMA_VERSION = "1.0.0";

export * from "./types";
export { PERSONAS, PERSONA_IDS, personaById, resolvePersonas } from "./catalog";
export type { PersonaDefinition, PersonaTitleOverrides } from "./catalog";
export {
  buildFactsFromContext,
  buildFactsFromMock,
  buildStakeholderFacts,
  flattenFacts,
} from "./facts";
export { buildStakeholderCards } from "./builders";
export { buildScopeRollups, resolveScope } from "./scope";

/** Builds the complete payload from verified facts. */
export function buildPayloadFromFacts(
  facts: StakeholderFacts,
  options: {
    scope?: string | null;
    titleOverrides?: PersonaTitleOverrides;
  } = {},
): StakeholderCardsPayload {
  const { cards, scope } = buildStakeholderCards(facts, options);

  return {
    schemaVersion: STAKEHOLDER_SCHEMA_VERSION,
    generatedAtUtc: new Date().toISOString(),
    currency: facts.currency,
    customerName: facts.customerName,
    scope: scope?.subscriptionName ?? null,
    scopeOptions: facts.scopes.map((s) => s.subscriptionName),
    coverage: facts.coverage,
    cards,
  };
}

/**
 * Route entry point: verifies the facts once and projects N perspectives over
 * them.
 */
export function buildStakeholderCardsPayload(
  filters: ParsedFilters,
  options: {
    scope?: string | null;
    titleOverrides?: PersonaTitleOverrides;
    customerSlug?: string | null;
  } = {},
): { payload: StakeholderCardsPayload; facts: StakeholderFacts } {
  const facts = buildStakeholderFacts(filters, options.customerSlug);
  return { payload: buildPayloadFromFacts(facts, options), facts };
}
