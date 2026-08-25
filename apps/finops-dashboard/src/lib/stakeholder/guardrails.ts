import type { PersonaId, StakeholderCard } from "./types";

/**
 * Stakeholder Cards guardrails.
 *
 * Validation is **per card**, never global: one bad card must not bring down the
 * whole narrative. The result records which guardrail rejected the card, so that
 * a dropped card does not look arbitrary on screen.
 *
 * See `docs/product/prd-stakeholder-cards.md` §6.
 */

export interface GuardrailResult {
  ok: boolean;
  guardrail?: string;
  reason?: string;
}

export interface RefinedFields {
  headline: string;
  whyItMatters: string;
  nextAction: string;
}

/** Fields that AI can rewrite. `metrics` and `caveats` are immutable. */
const REFINABLE_FIELDS: (keyof RefinedFields)[] = [
  "headline",
  "whyItMatters",
  "nextAction",
];

// ---------------------------------------------------------------------------
// Number extraction
// ---------------------------------------------------------------------------

/**
 * Numbers with an **explicit currency**. Only these participate in guardrail
 * arithmetic: "5 environments, including 3 production environments" is a
 * count, not money.
 */
const MONEY_PATTERN =
  /(?:R\$|BRL|USD|US\$|\$|€|EUR)\s*(-?\d[\d.,]*\d|-?\d)|(-?\d[\d.,]*\d|-?\d)\s*(?:BRL|USD|EUR)\b/gi;

/** Any number, with or without currency. Used by anchoring and dilution. */
const NUMBER_PATTERN = /-?\d[\d.,]*\d|-?\d/g;

/**
 * Converts a numeric token into a number.
 *
 * Locale-ambiguous tokens (`1.234` can mean one thousand two hundred
 * thirty-four in pt-BR or one point two three four in en-US) are resolved by
 * the caller in the direction that makes rejection **harder**.
 */
function parseNumber(token: string, ambiguousAsThousands: boolean): number {
  const cleaned = token.trim();
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");

  if (hasComma && hasDot) {
    // The last separator is the decimal separator.
    return cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
      ? Number(cleaned.replace(/\./g, "").replace(",", "."))
      : Number(cleaned.replace(/,/g, ""));
  }
  if (hasComma) return Number(cleaned.replace(/\./g, "").replace(",", "."));
  if (hasDot) {
    const decimals = cleaned.split(".").pop() ?? "";
    // `1.234` is ambiguous; `1.23` and `1.2345` are not (three digits means
    // thousands in pt-BR).
    if (decimals.length === 3) {
      return ambiguousAsThousands
        ? Number(cleaned.replace(/\./g, ""))
        : Number(cleaned);
    }
    return Number(cleaned);
  }
  return Number(cleaned);
}

function isAmbiguous(token: string): boolean {
  return (
    !token.includes(",") &&
    token.includes(".") &&
    (token.split(".").pop() ?? "").length === 3
  );
}

interface MoneyToken {
  raw: string;
  index: number;
}

function moneyTokens(text: string): MoneyToken[] {
  const tokens: MoneyToken[] = [];
  for (const match of Array.from(text.matchAll(MONEY_PATTERN))) {
    const raw = (match[1] ?? match[2] ?? "").trim();
    if (raw) tokens.push({ raw, index: match.index ?? 0 });
  }
  return tokens;
}

function allNumbers(text: string): string[] {
  return Array.from(text.matchAll(NUMBER_PATTERN), (m) => m[0]);
}

/** Normalizes a number for format-tolerant comparison. */
function normalizeForAnchor(token: string): string[] {
  const asThousands = parseNumber(token, true);
  const asDecimal = parseNumber(token, false);
  return Array.from(
    new Set(
      [asThousands, asDecimal]
        .filter((n) => Number.isFinite(n))
        .map((n) => Math.abs(Math.round(n * 100) / 100).toString()),
    ),
  );
}

// ---------------------------------------------------------------------------
// Guardrails
// ---------------------------------------------------------------------------

/** #1 — Does the persona exist: is there a deterministic card behind it? */
function checkPersonaExists(
  persona: PersonaId,
  known: Set<PersonaId>,
): GuardrailResult {
  return known.has(persona)
    ? { ok: true }
    : {
        ok: false,
        guardrail: "persona-existe",
        reason: `persona "${persona}" has no deterministic card`,
      };
}

/** #2 — Non-empty response. */
function checkNonEmpty(fields: RefinedFields): GuardrailResult {
  for (const key of REFINABLE_FIELDS) {
    if (!fields[key] || fields[key].trim().length === 0) {
      return {
        ok: false,
        guardrail: "non-empty-response",
        reason: `field "${key}" is empty`,
      };
    }
  }
  return { ok: true };
}

/**
 * #3 — Anti-dilution: **is this still worth reading?**
 *
 * All other guardrails ask "is this true?" This is the only one that rejects
 * true text. Prose that cited numbers cannot return with none: "identified
 * blockers must be treated as a priority" passes every honesty check but is
 * still strictly worse than deterministic text that named the retained value.
 */
function checkNoDilution(
  original: RefinedFields,
  refined: RefinedFields,
): GuardrailResult {
  for (const key of REFINABLE_FIELDS) {
    const before = allNumbers(original[key]).length;
    const after = allNumbers(refined[key]).length;
    if (before > 0 && after === 0) {
      return {
        ok: false,
        guardrail: "anti-diluicao",
        reason: `"${key}" cited ${before} number(s) and returned with none`,
      };
    }
  }
  return { ok: true };
}

/**
 * #4 — Anchoring: every number is supported by facts from its own card.
 *
 * The allowed set comes exclusively from the deterministic card. This is why
 * the anchoring test must remove cards from the payload before validation —
 * otherwise the card validates itself.
 */
function checkAnchoring(
  refined: RefinedFields,
  allowed: Set<string>,
): GuardrailResult {
  for (const key of REFINABLE_FIELDS) {
    for (const token of allNumbers(refined[key])) {
      const candidates = normalizeForAnchor(token);
      if (!candidates.some((candidate) => allowed.has(candidate))) {
        return {
          ok: false,
          guardrail: "ancoragem",
          reason: `"${key}" cites ${token}, which is unsupported by the card`,
        };
      }
    }
  }
  return { ok: true };
}

/** Terms that qualify a value as savings. Portuguese is retained for legacy inputs. */
const SAVINGS_TERMS = /econom|saving|redu[çc]/i;

/**
 * Labels that assign a cost role to a value. When one appears **between** the
 * savings term and number, the number is correctly labeled as cost and the
 * sentence is honest: "identified savings against a run rate of X".
 */
const COST_LABELS =
  /run rate|custo|consumo|gasto|fatur|compromiss|on-demand|pre[çc]o|or[çc]amento/i;

/**
 * #5 — Number role: is what was called savings actually savings?
 *
 * Total cost and run rate can never be presented as savings. Conservative by
 * design: reject only when nothing between the savings term and value labels
 * that value as cost.
 */
function checkNumberRole(
  refined: RefinedFields,
  costValues: Set<string>,
  savingsValues: Set<string>,
): GuardrailResult {
  for (const key of REFINABLE_FIELDS) {
    const sentences = refined[key].split(/(?<=[.!?])\s+/);
    for (const sentence of sentences) {
      const savingsMatch = SAVINGS_TERMS.exec(sentence);
      if (!savingsMatch) continue;
      const savingsIndex = savingsMatch.index;

      for (const token of moneyTokens(sentence)) {
        const candidates = normalizeForAnchor(token.raw);
        const isCost = candidates.some((c) => costValues.has(c));
        const isSavings = candidates.some((c) => savingsValues.has(c));
        if (!isCost || isSavings) continue;

        const gap = sentence.slice(
          Math.min(savingsIndex, token.index),
          Math.max(savingsIndex, token.index),
        );
        if (COST_LABELS.test(gap)) continue;

        return {
          ok: false,
          guardrail: "papel-do-numero",
          reason: `"${key}" presents ${token.raw} (cost) as savings`,
        };
      }
    }
  }
  return { ok: true };
}

/** #6 — Entities: do cited identifiers exist in the card? */
function checkEntities(
  refined: RefinedFields,
  knownEntities: string[],
): GuardrailResult {
  // Resource/service-style identifiers: tokens with hyphens or dots that look
  // like technical names rather than Portuguese words.
  const pattern = /\b[a-z0-9]+(?:[-_][a-z0-9]+){1,}\b/gi;

  for (const key of REFINABLE_FIELDS) {
    for (const match of Array.from(refined[key].matchAll(pattern))) {
      const token = match[0].toLowerCase();
      const known = knownEntities.some((entity) =>
        entity.toLowerCase().includes(token),
      );
      if (!known) {
        return {
          ok: false,
          guardrail: "entidades",
          reason: `"${key}" cites identifier "${match[0]}", which does not exist in the card`,
        };
      }
    }
  }
  return { ok: true };
}

/** Capabilities absent from the pipeline that the model tends to invent. */
const INVENTED_CLAIMS = [
  /\bSLA\b/i,
  /\bRTO\b/i,
  /\bRPO\b/i,
  /\bcarbono\b/i,
  /\bcarbon\b/i,
  /\bsustentabilidade\b/i,
  /\bsustainability\b/i,
  /\bIOPS\b/i,
  /\bcertifica[çc][ãa]o\b/i,
  /\bconformidade regulat[óo]ria\b/i,
  /\bregulatory compliance\b/i,
];

/** #7 — Claims: was any capability invented? */
function checkClaims(refined: RefinedFields): GuardrailResult {
  for (const key of REFINABLE_FIELDS) {
    for (const pattern of INVENTED_CLAIMS) {
      if (pattern.test(refined[key])) {
        return {
          ok: false,
          guardrail: "alegacoes",
          reason: `"${key}" claims an unassessed capability (${pattern.source})`,
        };
      }
    }
  }
  return { ok: true };
}

/** Markers that claim a decomposition: parts fit in the whole. */
const DECOMPOSITION_MARKERS =
  /\b(of which|including|whereof|sendo|dos quais|das quais|desses|dessas|destes|destas|sendo que|incluindo)\b/gi;

/**
 * Contrast markers that **end** the parts clause.
 *
 * Without this limit, a value merely *listed beside* the whole is read as a
 * part of it — a false positive that has already rejected honest narrative.
 */
const CONTRAST_MARKERS =
  /\b(in addition to|additionally|whereas|however|but|nevertheless|nonetheless|on the other hand|and also|separately|apart from|além de|além disso|enquanto|porém|mas|contudo|entretanto|por outro lado|e ainda|separadamente|à parte)\b/i;

/** Rounding tolerance. */
const DECOMPOSITION_TOLERANCE = 0.01;

/**
 * #8 — False decomposition.
 *
 * All preceding guardrails inspect each number separately. A sentence can pass
 * all of them and still be false because falsehood lies in the **relationship**
 * between two true numbers:
 *
 *   "BRL 65,154.97/month in actionable savings, OF WHICH BRL 187,556.66/month
 *    requires no architecture change and BRL 81,859.57/month requires
 *    validation."
 *
 * All three values exist and are correctly labeled, but the first is a
 * portion of an environment while the others are corporate totals. In a
 * regulated context, that is a material error.
 *
 * Conservative in three ways, because needless rejection discards narrative:
 * explicit currency only; the clause ends at the first contrast marker; and
 * ambiguous tokens are read as **larger whole / smaller parts**.
 */
export function checkDecomposition(text: string): GuardrailResult {
  for (const marker of Array.from(text.matchAll(DECOMPOSITION_MARKERS))) {
    const markerIndex = marker.index ?? 0;

    const before = text.slice(0, markerIndex);
    const wholeTokens = moneyTokens(before);
    if (wholeTokens.length === 0) continue;
    const wholeToken = wholeTokens[wholeTokens.length - 1];

    let after = text.slice(markerIndex + marker[0].length);
    // The parts clause ends at the first sentence break...
    const sentenceEnd = after.search(/[.!?](\s|$)/);
    if (sentenceEnd >= 0) after = after.slice(0, sentenceEnd);
    // ...or at the first contrast marker, whichever comes first.
    const contrast = after.search(CONTRAST_MARKERS);
    if (contrast >= 0) after = after.slice(0, contrast);

    const partTokens = moneyTokens(after);
    if (partTokens.length < 2) continue;

    // Direction that makes rejection harder: larger whole, smaller parts.
    const whole = isAmbiguous(wholeToken.raw)
      ? Math.max(
          parseNumber(wholeToken.raw, true),
          parseNumber(wholeToken.raw, false),
        )
      : parseNumber(wholeToken.raw, true);

    const parts = partTokens.map((token) =>
      isAmbiguous(token.raw)
        ? Math.min(parseNumber(token.raw, true), parseNumber(token.raw, false))
        : parseNumber(token.raw, true),
    );

    if (parts.some((p) => !Number.isFinite(p)) || !Number.isFinite(whole)) {
      continue;
    }

    const sum = parts.reduce((total, part) => total + part, 0);
    if (sum > whole * (1 + DECOMPOSITION_TOLERANCE)) {
      return {
        ok: false,
        guardrail: "decomposicao",
        reason:
          `"${marker[0]}" claims that ${parts.join(" + ")} fits in ${whole}` +
          ` — the parts total ${Math.round(sum * 100) / 100}`,
      };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Set of values that prose in that card can cite.
 *
 * Comes **only** from the deterministic card: metrics, caveats, and original
 * prose. No facts from other cards — importing a corporate total into the
 * Application Owner card destroys the only reason for that card to exist.
 */
function allowedValuesOf(card: StakeholderCard): Set<string> {
  const allowed = new Set<string>();

  const add = (token: string) => {
    for (const candidate of normalizeForAnchor(token)) allowed.add(candidate);
  };

  for (const metric of card.metrics) {
    if (metric.raw !== null) {
      add(String(metric.raw));
      // The formatted value is what the human reads; prose may repeat it.
      for (const token of allNumbers(metric.value)) add(token);
    }
  }
  for (const text of [
    card.headline,
    card.whyItMatters,
    card.nextAction,
    ...card.caveats,
  ]) {
    for (const token of allNumbers(text)) add(token);
  }

  return allowed;
}

/** Identifiers prose can cite: only those already named by the card. */
function knownEntitiesOf(card: StakeholderCard): string[] {
  return [
    card.title,
    card.question,
    card.focus,
    card.headline,
    card.whyItMatters,
    card.nextAction,
    ...card.metrics.map((m) => `${m.label} ${m.value} ${m.tip}`),
    ...card.caveats,
  ];
}

function valuesByRole(
  card: StakeholderCard,
  matcher: RegExp,
): Set<string> {
  const values = new Set<string>();
  for (const metric of card.metrics) {
    if (metric.raw === null) continue;
    if (!matcher.test(`${metric.label} ${metric.factPath}`)) continue;
    for (const candidate of normalizeForAnchor(String(metric.raw))) {
      values.add(candidate);
    }
    for (const token of allNumbers(metric.value)) {
      for (const candidate of normalizeForAnchor(token)) values.add(candidate);
    }
  }
  return values;
}

/**
 * Runs all eight guardrails against a refined card.
 *
 * `knownPersonas` comes from the deterministic set — this is guardrail #1.
 */
export function validateRefinedCard(
  card: StakeholderCard,
  refined: RefinedFields,
  knownPersonas: Set<PersonaId>,
): GuardrailResult {
  const original: RefinedFields = {
    headline: card.headline,
    whyItMatters: card.whyItMatters,
    nextAction: card.nextAction,
  };

  const allowed = allowedValuesOf(card);
  const costValues = valuesByRole(card, /custo|run rate|cost|consumo|compromiss/i);
  const savingsValues = valuesByRole(card, /econom|saving|desperd/i);
  const entities = knownEntitiesOf(card);

  const checks: (() => GuardrailResult)[] = [
    () => checkPersonaExists(card.persona, knownPersonas),
    () => checkNonEmpty(refined),
    () => checkNoDilution(original, refined),
    () => checkAnchoring(refined, allowed),
    () => checkNumberRole(refined, costValues, savingsValues),
    () => checkEntities(refined, entities),
    () => checkClaims(refined),
    () =>
      checkDecomposition(
        REFINABLE_FIELDS.map((key) => refined[key]).join(" "),
      ),
  ];

  for (const check of checks) {
    const result = check();
    if (!result.ok) return result;
  }

  return { ok: true };
}
