/**
 * Tests for Stakeholder Card AI layer guardrails.
 *
 * Run: `npm run stakeholder:guardrails-test`
 *
 * None of these tests calls the model: they validate the mechanism that decides
 * whether model output is accepted or discarded.
 */
import {
  buildFactsFromMock,
  buildPayloadFromFacts,
  PERSONA_IDS,
} from "../src/lib/stakeholder";
import {
  checkDecomposition,
  validateRefinedCard,
} from "../src/lib/stakeholder/guardrails";
import {
  applyRefinement,
  projectCardsForModel,
  tokenBudgetFor,
} from "../src/lib/stakeholder/narrative";
import { renderStakeholderMarkdown } from "../src/lib/stakeholder/markdown";
import type { PersonaId, StakeholderCard } from "../src/lib/stakeholder";

let failures = 0;
let passes = 0;

function check(name: string, assertion: () => void) {
  try {
    assertion();
    passes += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ ${name}`);
    console.error(`      ${(error as Error).message}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const payload = buildPayloadFromFacts(buildFactsFromMock());
const known = new Set<PersonaId>([...PERSONA_IDS]);
const cfo = payload.cards.find((c) => c.persona === "cfo")!;

function fieldsOf(card: StakeholderCard) {
  return {
    headline: card.headline,
    whyItMatters: card.whyItMatters,
    nextAction: card.nextAction,
  };
}

console.log("\nStakeholder Cards — AI layer guardrails\n");

console.log("Circularity — the test trap");

check("facts sent to the model include the cards", () => {
  const projected = projectCardsForModel(payload.cards);
  assert(projected.length === payload.cards.length, "incomplete projection");
  assert(
    projected[0].metrics.length > 0,
    "the model would be silently forbidden from citing numbers in its own card",
  );
});

check("anchoring validates against the card, not the model response", () => {
  // If anchoring read the refined payload as the source of truth, this
  // invented number would pass — the card would validate itself.
  const verdict = validateRefinedCard(
    cfo,
    {
      headline: "There is USD 999999999 in identified savings.",
      whyItMatters: cfo.whyItMatters,
      nextAction: cfo.nextAction,
    },
    known,
  );
  assert(!verdict.ok, "an invented number passed anchoring");
  assert(
    verdict.guardrail === "ancoragem",
    `expected anchoring guardrail, got ${verdict.guardrail}`,
  );
});

console.log("\nGuardrails 1-2 — existence and presence");

check("#1 persona without a deterministic card is rejected", () => {
  const verdict = validateRefinedCard(cfo, fieldsOf(cfo), new Set<PersonaId>());
  assert(!verdict.ok && verdict.guardrail === "persona-existe", "was not rejected");
});

check("#2 empty field is rejected", () => {
  const verdict = validateRefinedCard(
    cfo,
    { ...fieldsOf(cfo), nextAction: "   " },
    known,
  );
  assert(
    !verdict.ok && verdict.guardrail === "non-empty-response",
    "empty field passed",
  );
});

console.log("\nGuardrail 3 — dilution is also a rejection");

check("prose that cited numbers cannot return with none", () => {
  const verdict = validateRefinedCard(
    cfo,
    {
      ...fieldsOf(cfo),
      headline:
        "Identified blockers must be treated as a priority by the committee.",
    },
    known,
  );
  assert(!verdict.ok, "corporate filler passed");
  assert(
    verdict.guardrail === "anti-diluicao",
    `expected anti-diluicao, got ${verdict.guardrail}`,
  );
});

check("text without numbers remains allowed where the original had none", () => {
  const semNumeros: StakeholderCard = {
    ...cfo,
    headline: "There is a meaningful savings opportunity.",
    whyItMatters: "The environment has optimization headroom.",
    nextAction: "Approve the plan.",
  };
  const verdict = validateRefinedCard(
    semNumeros,
    {
      headline: "Identified savings deserve a decision in this cycle.",
      whyItMatters: "There is optimization headroom to capture.",
      nextAction: "Approve the capture plan.",
    },
    known,
  );
  assert(verdict.ok, `rejected unnecessarily: ${verdict.guardrail} — ${verdict.reason}`);
});

console.log("\nGuardrails 4-7 — anchoring, role, entities, claims");

check("#4 deterministic text passes its own anchoring", () => {
  for (const card of payload.cards) {
    const verdict = validateRefinedCard(card, fieldsOf(card), known);
    assert(
      verdict.ok,
      `${card.persona} rejected: ${verdict.guardrail} — ${verdict.reason}`,
    );
  }
});

check("#5 cost presented as savings is rejected", () => {
  const runRate = cfo.metrics.find(
    (m) => m.factPath === "cost.annualizedRunRate",
  )!;
  const verdict = validateRefinedCard(
    cfo,
    {
      ...fieldsOf(cfo),
      headline: `Identified savings reach ${runRate.value} per year.`,
    },
    known,
  );
  assert(!verdict.ok, "run rate sold as savings passed");
  assert(
    verdict.guardrail === "papel-do-numero",
    `expected papel-do-numero, got ${verdict.guardrail}`,
  );
});

check("#6 nonexistent identifier is rejected", () => {
  const verdict = validateRefinedCard(
    cfo,
    {
      ...fieldsOf(cfo),
      nextAction: `${cfo.nextAction} Also approve shutdown of resource vm-invented-legacy.`,
    },
    known,
  );
  assert(
    !verdict.ok && verdict.guardrail === "entidades",
    `expected entidades, got ${verdict.guardrail}`,
  );
});

check("#7 unassessed capability is rejected", () => {
  for (const sentence of [
    "The change does not affect the contracted SLA.",
    "RTO remains within the agreed target.",
    "Savings also reduce the carbon footprint.",
  ]) {
    const verdict = validateRefinedCard(
      cfo,
      { ...fieldsOf(cfo), whyItMatters: `${cfo.whyItMatters} ${sentence}` },
      known,
    );
    assert(
      !verdict.ok && verdict.guardrail === "alegacoes",
      `passed: "${sentence}" (guardrail ${verdict.guardrail})`,
    );
  }
});

console.log("\nGuardrail 8 — false decomposition");

check("parts that exceed the whole are rejected", () => {
  const verdict = checkDecomposition(
    "You have BRL 65.154,97/month in actionable savings, of which BRL 187.556,66/month " +
      "requires no architecture change and BRL 81.859,57/month requires validation.",
  );
  assert(!verdict.ok, "the PRD false decomposition passed");
  assert(verdict.guardrail === "decomposicao", "wrong guardrail");
});

check("a valid decomposition passes", () => {
  const verdict = checkDecomposition(
    "There is BRL 269.416,23/month in savings, of which BRL 187.556,66/month requires " +
      "no architecture change and BRL 81.859,57/month requires validation.",
  );
  assert(verdict.ok, `rejected a correct decomposition: ${verdict.reason}`);
});

check("conservative 1: a count without currency is not money arithmetic", () => {
  const verdict = checkDecomposition(
    "There are 5 environments, including 3 production and 4 staging.",
  );
  assert(verdict.ok, "a count was treated as money");
});

check("conservative 2: the clause ends at the first contrast marker", () => {
  // The value after "in addition to" is *listed beside* the whole, not within it.
  const verdict = checkDecomposition(
    "There is BRL 100.000,00/month in savings, of which BRL 60.000,00 needs no prerequisite " +
      "and BRL 30.000,00 is pending validation, in addition to BRL 500.000,00 in total cost.",
  );
  assert(
    verdict.ok,
    `a false positive would reject honest narrative: ${verdict.reason}`,
  );
});

check("conservative 3: an ambiguous token is read in the direction that makes rejection harder", () => {
  // `1.234` can be 1234 (pt-BR) or 1.234 (en-US). Whole uses the larger
  // reading and parts the smaller reading. Locale ambiguity rejects nothing.
  const verdict = checkDecomposition(
    "There is USD 1.234 in savings, of which USD 1.000 needs no prerequisite and USD 200 is pending validation.",
  );
  assert(verdict.ok, `locale ambiguity caused rejection: ${verdict.reason}`);
});

check("a 1% tolerance absorbs rounding", () => {
  const verdict = checkDecomposition(
    "There is BRL 100,00 in savings, of which BRL 60,00 needs no prerequisite and BRL 40,50 is pending validation.",
  );
  assert(verdict.ok, `arredondamento rejected: ${verdict.reason}`);
});

console.log("\nPer-card application");

check("one rejected card does not bring down the others", () => {
  const refined = payload.cards.map((card) => ({
    persona: card.persona,
    headline:
      card.persona === "cio"
        ? "Points requiring attention must be treated as a priority."
        : card.headline,
    why_it_matters: card.whyItMatters,
    next_action: card.nextAction,
  }));

  const { cards, log } = applyRefinement(payload.cards, refined);

  const cio = log.find((entry) => entry.persona === "cio")!;
  assert(cio.state === "rejected", "the diluted card should have been rejected");
  assert(
    cio.failedGuardrail === "anti-diluicao",
    `wrong guardrail: ${cio.failedGuardrail}`,
  );

  const cioCard = cards.find((c) => c.persona === "cio")!;
  const original = payload.cards.find((c) => c.persona === "cio")!;
  assert(
    cioCard.headline === original.headline,
    "the rejected card did not return to deterministic text",
  );
  assert(
    log.filter((entry) => entry.state === "refined").length === 4,
    "the remaining cards should have been refined",
  );
});

check("metrics and caveats are immutable", () => {
  const refined = payload.cards.map((card) => ({
    persona: card.persona,
    headline: card.headline,
    why_it_matters: card.whyItMatters,
    next_action: card.nextAction,
  }));

  const { cards } = applyRefinement(payload.cards, refined);
  for (const [index, card] of Array.from(cards.entries())) {
    assert(
      JSON.stringify(card.metrics) ===
        JSON.stringify(payload.cards[index].metrics),
      `${card.persona}: metrics were changed`,
    );
    assert(
      JSON.stringify(card.caveats) ===
        JSON.stringify(payload.cards[index].caveats),
      `${card.persona}: caveats were changed`,
    );
  }
});

check("a card missing from the response returns to deterministic text with a reason", () => {
  const { cards, log } = applyRefinement(payload.cards, []);
  assert(
    log.every((entry) => entry.state === "deterministic"),
    "unexpected state",
  );
  assert(
    log.every((entry) => (entry.reason ?? "").length > 0),
    "the fallback needs a recorded reason or it appears arbitrary",
  );
  assert(
    JSON.stringify(cards) === JSON.stringify(payload.cards),
    "cards changed without a model response",
  );
});

console.log("\nToken budget");

check("the limit grows with the number of cards", () => {
  const um = tokenBudgetFor(1);
  const cinco = tokenBudgetFor(5);
  const dez = tokenBudgetFor(10);
  assert(cinco <= dez, "the limit does not grow with N");
  assert(dez > um, "ten cards do not receive more budget than one");
  assert(
    tokenBudgetFor(payload.cards.length) >= payload.cards.length * 300,
    "budget is underfunded for the current number of cards",
  );
});

console.log("\nMarkdown export");

check("one file per persona, plus the README", () => {
  const files = renderStakeholderMarkdown(payload);
  assert(
    files.length === payload.cards.length + 1,
    `esperado ${payload.cards.length + 1} files, got ${files.length}`,
  );
  assert(files[0].name === "README.md", "README is missing");
  for (const card of payload.cards) {
    assert(
      files.some((f) => f.name === `${card.persona}.md`),
      `file for ${card.persona} is missing`,
    );
  }
});

check("each file is independently shareable", () => {
  const files = renderStakeholderMarkdown(payload);
  for (const card of payload.cards) {
    const file = files.find((f) => f.name === `${card.persona}.md`)!;
    assert(file.content.includes(card.question), "missing question");
    assert(file.content.includes("## Numbers"), "missing metrics");
    assert(file.content.includes("## Why it matters"), "missing meaning");
    assert(file.content.includes("## Caveats"), "missing caveats");
    assert(file.content.includes("## Next action"), "missing action");
    for (const metric of card.metrics) {
      assert(
        file.content.includes(metric.tip.replace(/\|/g, "\\|")),
        `missing tip for "${metric.label}" — orphan number`,
      );
    }
  }
});

check("the README explains that these are views of the same fact", () => {
  const readme = renderStakeholderMarkdown(payload)[0].content;
  assert(readme.includes("same"), "does not explain that cards share facts");
  assert(
    readme.toLowerCase().includes("not assessed"),
    "does not declare the missing-layer policy",
  );
  assert(
    readme.includes("Collection coverage"),
    "collection coverage does not appear in the package",
  );
});

check("zero external dependencies in markdown", () => {
  for (const file of renderStakeholderMarkdown(payload)) {
    assert(
      !/https?:\/\//.test(file.content),
      `${file.name} loads an external resource`,
    );
  }
});

console.log(`\n${passes} passed, ${failures} failed\n`);

if (failures > 0) process.exit(1);
