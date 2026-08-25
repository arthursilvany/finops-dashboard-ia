import type { PersonaId } from "./types";

/**
 * Persona catalog.
 *
 * The questions determine which metrics are primary, and especially which are
 * **not**. Order goes from money to execution, following how decisions move
 * through an organization.
 *
 * Adoption rule: add a persona only when verified facts support it. A persona
 * is a consequence of available data, never of the customer's org chart.
 * (This is why Sustainability is not here: the pipeline does not measure
 * energy or carbon.)
 */
export interface PersonaDefinition {
  id: PersonaId;
  /** Customer-configurable (`CFO` → `Finance Director`). */
  title: string;
  /** NOT configurable: this structure keeps cards from diverging. */
  question: string;
  focus: string;
}

export const PERSONAS: readonly PersonaDefinition[] = [
  {
    id: "cfo",
    title: "CFO",
    question: "What is this worth, and when does it enter the budget?",
    focus: "Money: OPEX, ESR, and the cost of delay.",
  },
  {
    id: "cio",
    title: "CIO",
    question: "Does the capacity we bought align with actual use?",
    focus: "IT efficiency, governance debt, and deadlines.",
  },
  {
    id: "architect",
    title: "Cloud Architect",
    question: "What do I execute, and what could break?",
    focus: "Technical prerequisites, limits, capacity, and telemetry.",
  },
  {
    id: "procurement",
    title: "Procurement",
    question: "Am I buying a discount on waste?",
    focus: "Active commitments, price baseline, and prior cleanup.",
  },
  {
    id: "app-owner",
    title: "Application Owner",
    question: "Will this break my application?",
    focus: "Its own scope and required validation.",
  },
] as const;

export const PERSONA_IDS: readonly PersonaId[] = PERSONAS.map((p) => p.id);

/**
 * Overrides titles only. IDs, questions, and metrics are not configurable:
 * they are the structure that keeps cards from diverging.
 */
export type PersonaTitleOverrides = Partial<Record<PersonaId, string>>;

export function resolvePersonas(
  overrides: PersonaTitleOverrides = {},
): PersonaDefinition[] {
  return PERSONAS.map((persona) => ({
    ...persona,
    title: overrides[persona.id]?.trim() || persona.title,
  }));
}

export function personaById(id: PersonaId): PersonaDefinition {
  const persona = PERSONAS.find((p) => p.id === id);
  if (!persona) throw new Error(`Unknown persona: ${id}`);
  return persona;
}
