/**
 * Tests for the deterministic layer of the Stakeholder Cards.
 *
 * Run with: `npm run stakeholder:test`
 *
 * These tests do not check prose aesthetics: they prove the properties that make
 * the feature safe for a regulated context (see
 * `docs/product/prd-stakeholder-cards.md`).
 */
import {
  buildFactsFromMock,
  buildPayloadFromFacts,
  buildStakeholderCards,
  flattenFacts,
  PERSONA_IDS,
} from "../src/lib/stakeholder";
import { NAO_AVALIADO } from "../src/lib/stakeholder/format";
import { buildScopeRollups } from "../src/lib/stakeholder/scope";
import type { StakeholderFacts } from "../src/lib/stakeholder";

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

const facts = buildFactsFromMock();
const { cards } = buildStakeholderCards(facts);
const flat = flattenFacts(facts);

console.log("\nStakeholder Cards — deterministic layer\n");

console.log("Catalog");

check("the five PRD personas are present in this order", () => {
  const ids = cards.map((c) => c.persona);
  assert(
    JSON.stringify(ids) === JSON.stringify([...PERSONA_IDS]),
    `expected ${PERSONA_IDS.join(", ")}, got ${ids.join(", ")}`,
  );
});

check("every card is self-contained", () => {
  for (const card of cards) {
    assert(card.question.length > 0, `${card.persona}: empty question`);
    assert(card.focus.length > 0, `${card.persona}: empty focus`);
    assert(card.headline.length > 0, `${card.persona}: empty headline`);
    assert(card.whyItMatters.length > 0, `${card.persona}: empty whyItMatters`);
    assert(card.nextAction.length > 0, `${card.persona}: empty nextAction`);
    assert(card.metrics.length > 0, `${card.persona}: no metrics`);
    assert(card.caveats.length > 0, `${card.persona}: no caveats`);
  }
});

check("every metric has a tip — no orphan number leaves the pipeline", () => {
  for (const card of cards) {
    for (const m of card.metrics) {
      assert(
        m.tip.trim().length > 0,
        `${card.persona} / ${m.label}: missing tip`,
      );
    }
  }
});

console.log("\nInvariant: reframes, never recalculates");

check("every raw value traces to a verified fact", () => {
  for (const card of cards) {
    for (const m of card.metrics) {
      if (m.raw === null) continue;
      assert(
        flat.has(m.factPath),
        `${card.persona} / ${m.label}: missing factPath (${m.factPath})`,
      );
      assert(
        flat.get(m.factPath) === m.raw,
        `${card.persona} / ${m.label}: raw ${m.raw} differs from fact ${flat.get(m.factPath)}`,
      );
    }
  }
});

check("no new number is created", () => {
  const known = new Set(flat.values());
  for (const card of cards) {
    for (const m of card.metrics) {
      if (m.raw === null) continue;
      assert(
        known.has(m.raw),
        `${card.persona} / ${m.label}: value ${m.raw} does not exist in facts`,
      );
    }
  }
});

check("same fact, same value in every card", () => {
  const byPath = new Map<string, { value: number | null; text: string }>();
  for (const card of cards) {
    for (const m of card.metrics) {
      const seen = byPath.get(m.factPath);
      if (!seen) {
        byPath.set(m.factPath, { value: m.raw, text: m.value });
        continue;
      }
      assert(
        seen.value === m.raw && seen.text === m.value,
        `${m.factPath} appears with divergent values: ${seen.text} vs ${m.value}`,
      );
    }
  }
});

console.log("\nReal customization");

check("no metric appears in every persona", () => {
  const usage = new Map<string, number>();
  for (const card of cards) {
    for (const path of Array.from(
      new Set(card.metrics.map((m) => m.factPath)),
    )) {
      usage.set(path, (usage.get(path) ?? 0) + 1);
    }
  }
  for (const [path, count] of Array.from(usage.entries())) {
    assert(
      count < cards.length,
      `${path} appears in ${count} personas — the catalog is wrong`,
    );
  }
});

check("every persona has at least one exclusive metric", () => {
  for (const card of cards) {
    const others = new Set(
      cards
        .filter((c) => c.persona !== card.persona)
        .flatMap((c) => c.metrics.map((m) => m.factPath)),
    );
    const exclusive = card.metrics.filter((m) => !others.has(m.factPath));
    assert(
      exclusive.length > 0,
      `${card.persona}: no exclusive metric — the card is a generic summary`,
    );
  }
});

console.log("\nHonest degradation");

check("a missing layer becomes 'not assessed', never zero", () => {
  const degraded: StakeholderFacts = {
    ...facts,
    esr: { ...facts.esr, unusedCommitmentCost: null },
    governance: {
      overallCompliance: null,
      taggedResources: null,
      totalResources: null,
      policiesActive: null,
      tagCoveragePercent: null,
    },
    anomalies: {
      last7d: null,
      last30d: null,
      largestDeviation: null,
      lastAnomalyDate: "",
    },
  };

  const { cards: degradedCards } = buildStakeholderCards(degraded);
  for (const card of degradedCards) {
    for (const m of card.metrics) {
      if (m.raw !== null) continue;
      assert(
        m.value === NAO_AVALIADO,
        `${card.persona} / ${m.label}: missing fact rendered as "${m.value}"`,
      );
    }
  }
});

check("no card claims an absence of risk because data is missing", () => {
  const prosa = cards
    .flatMap((c) => [c.headline, c.whyItMatters, c.nextAction, ...c.caveats])
    .join(" ")
    .toLowerCase();
  for (const proibido of ["no risk", "low risk", "zero risk"]) {
    assert(
      !prosa.includes(proibido),
      `deterministic prose contains "${proibido}"`,
    );
  }
});

check("a card without scope declares not assessed rather than remaining silent", () => {
  const semEscopo: StakeholderFacts = { ...facts, scopes: [] };
  const { cards: c, scope } = buildStakeholderCards(semEscopo);
  const appOwner = c.find((card) => card.persona === "app-owner")!;
  assert(scope === null, "scope should be null");
  assert(
    appOwner.caveats.some((cv) => cv.toLowerCase().includes("not assessed")),
    "the Application Owner card did not declare its scope as not assessed",
  );
});

console.log("\nBlock rules");

check("savings buckets are not recombined", () => {
  const cfo = cards.find((c) => c.persona === "cfo")!;
  const paths = cfo.metrics.map((m) => m.factPath);
  const temBalde =
    paths.includes("savings.commitmentGap") ||
    paths.includes("savings.idleResources");
  const temTotal =
    paths.includes("savings.totalPotentialAnnual") ||
    paths.includes("savings.totalPotentialMonthly");
  assert(
    !(temBalde && temTotal),
    "the CFO card exposes a bucket and total at the same time — risk of counting the same money twice",
  );
});

check("the ready versus validation split is present where savings are cited", () => {
  const cfo = cards.find((c) => c.persona === "cfo")!;
  assert(
    cfo.caveats.some((c) => c.toLowerCase().includes("engineering validation")),
    "the CFO card cites savings without the execution split",
  );
});

check("the commitment discount assumption is always declared", () => {
  for (const persona of ["cfo", "procurement"] as const) {
    const card = cards.find((c) => c.persona === persona)!;
    assert(
      card.caveats.some((c) => c.includes("30%")),
      `${persona}: commitment savings without the caveat that it is modeled`,
    );
  }
});

check("the Application Owner card does not import a corporate total", () => {
  const appOwner = cards.find((c) => c.persona === "app-owner")!;
  const corporativos = [
    "savings.totalPotentialAnnual",
    "savings.totalPotentialMonthly",
    "cost.annualizedRunRate",
    "esr.effectiveSavingsRate",
  ];
  for (const path of appOwner.metrics.map((m) => m.factPath)) {
    assert(
      !corporativos.includes(path),
      `the Application Owner card exposes a corporate metric (${path})`,
    );
  }
});

console.log("\nScope rollup");

check("rollup assigns idleness to the correct subscription", () => {
  const scopes = buildScopeRollups(
    [
      { subscriptionName: "Prod", cost: 100, percentage: 80 },
      { subscriptionName: "Dev", cost: 25, percentage: 20 },
    ],
    [
      {
        resourceName: "vm-a",
        consumedService: "VM",
        subscriptionName: "Dev",
        monthlyCost: 10,
        avgDailyCost: 0.3,
        daysActive: 30,
      },
      {
        resourceName: "vm-b",
        consumedService: "VM",
        subscriptionName: "Dev",
        monthlyCost: 5,
        avgDailyCost: 0.2,
        daysActive: 30,
      },
    ],
  );

  const dev = scopes.find((s) => s.subscriptionName === "Dev")!;
  const prod = scopes.find((s) => s.subscriptionName === "Prod")!;
  assert(dev.idleCount === 2, `Dev should have 2 idle resources, has ${dev.idleCount}`);
  assert(
    dev.idleMonthlyCost === 15,
    `Dev should total 15, totaled ${dev.idleMonthlyCost}`,
  );
  assert(prod.idleCount === 0, "Prod should not inherit idleness from Dev");
});

check("requested scope is respected", () => {
  const alvo = facts.scopes[facts.scopes.length - 1].subscriptionName;
  const { scope } = buildStakeholderCards(facts, { scope: alvo });
  assert(
    scope?.subscriptionName === alvo,
    `expected ${alvo}, got ${scope?.subscriptionName}`,
  );
});

console.log("\nPayload and configuration");

check("payload declares coverage and schema version", () => {
  const payload = buildPayloadFromFacts(facts);
  assert(payload.schemaVersion === "1.0.0", "schemaVersion inesperado");
  assert(payload.cards.length === 5, "payload did not return five cards");
  assert(
    payload.scopeOptions.length === facts.scopes.length,
    "scope options differ from the rollup",
  );
  assert(
    typeof payload.coverage.costExport === "boolean",
    "coverage is missing from payload",
  );
});

check("only the title is configurable per customer", () => {
  const { cards: renomeados } = buildStakeholderCards(facts, {
    titleOverrides: { cfo: "Finance Director" },
  });
  const cfo = renomeados.find((c) => c.persona === "cfo")!;
  const original = cards.find((c) => c.persona === "cfo")!;
  assert(cfo.title === "Finance Director", "title was not overridden");
  assert(cfo.question === original.question, "question cannot be changed");
  assert(
    JSON.stringify(cfo.metrics) === JSON.stringify(original.metrics),
    "metrics cannot change with the title",
  );
});

console.log(
  `\n${passes} passed, ${failures} failed\n`,
);

if (failures > 0) process.exit(1);
