/**
 * Tests for the multicloud comparison.
 *
 * Run: `npm run multicloud:test`
 *
 * No test here calls a model. They validate the deterministic layer — the part
 * whose numbers reach a migration decision — plus the mechanism that decides
 * whether a model's prose is allowed through.
 */
import { normalizeQuantity } from "../src/lib/multicloud/normalize";
import {
  buildMulticloudFacts,
  commonWindow,
  termOf,
  toObservations,
} from "../src/lib/multicloud/facts";
import type { ComparableRow } from "../src/lib/multicloud/facts";
import { classifyRow } from "../src/lib/multicloud/taxonomy";
import { DEFAULT_WEIGHTS, normalizeWeights } from "../src/lib/multicloud/score";
import { coverageNotices } from "../src/lib/multicloud/coverage";
import { validateNarrative } from "../src/lib/multicloud/guardrails";
import { projectFactsForModel } from "../src/lib/multicloud/narrative";
import { renderMulticloudMarkdown } from "../src/lib/multicloud/markdown";
import { UNOBSERVED_REASON_LABELS } from "../src/lib/multicloud/types";
import {
  mockMulticloudProviders,
  mockMulticloudRows,
} from "../src/lib/mock-data/multicloud";
import type { CloudProvider } from "../src/lib/customer-data/contract";

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

const facts = buildMulticloudFacts({
  rows: mockMulticloudRows,
  currency: "USD",
  providersPresent: mockMulticloudProviders,
});

// ── Unit normalization ───────────────────────────────────────────────────
console.log("\nUnit normalization");

check("recognises the three hour spellings as one unit", () => {
  for (const unit of ["1 Hour", "Hrs", "hour", "Hours"]) {
    const result = normalizeQuantity(unit, 10, "vcpu-hour");
    assert(result !== null, `"${unit}" was not recognised as an hour meter`);
    assert(result!.quantity === 10, `"${unit}" changed the quantity`);
  }
});

check("recognises the three GB-month spellings as one unit", () => {
  for (const unit of ["1 GB/Month", "GB-Mo", "gibibyte month"]) {
    const result = normalizeQuantity(unit, 10, "gib-month");
    assert(result !== null, `"${unit}" was not recognised as a GB-month meter`);
    assert(result!.quantity === 10, `"${unit}" changed the quantity`);
  }
});

check("applies the leading batch multiplier", () => {
  // The failure this guards is severe: ignoring the "100" understates the
  // quantity 100-fold and inflates the derived rate by the same factor.
  const batched = normalizeQuantity("100 Hours", 5, "vcpu-hour");
  assert(batched !== null, "batched hour meter was not recognised");
  assert(
    batched!.quantity === 500,
    `expected 500 hours, got ${batched!.quantity}`,
  );
});

check("scales K/M token and request meters to their canonical unit", () => {
  const tokens = normalizeQuantity("1K tokens", 2_000, "thousand-tokens");
  assert(tokens !== null && tokens.quantity === 2_000, "1K tokens mis-scaled");

  const millionTokens = normalizeQuantity("1M tokens", 3, "thousand-tokens");
  assert(
    millionTokens !== null && millionTokens.quantity === 3_000,
    `expected 3000 thousand-tokens, got ${millionTokens?.quantity}`,
  );

  const requests = normalizeQuantity("10,000 requests", 500, "million-requests");
  assert(
    requests !== null && requests.quantity === 5,
    `expected 5 million requests, got ${requests?.quantity}`,
  );
});

check("returns null rather than guessing an unknown unit", () => {
  assert(
    normalizeQuantity("Widgets", 10, "vcpu-hour") === null,
    "an unrecognised unit produced a quantity instead of null",
  );
  assert(
    normalizeQuantity("", 10, "vcpu-hour") === null,
    "an empty unit produced a quantity",
  );
});

check("rejects a quantity of zero instead of dividing by it", () => {
  assert(
    normalizeQuantity("1 Hour", 0, "vcpu-hour") === null,
    "zero quantity was accepted and would produce an infinite rate",
  );
});

check("refuses to coerce a storage meter into a compute unit", () => {
  assert(
    normalizeQuantity("1 GB/Month", 10, "vcpu-hour") === null,
    "a GB-month meter was accepted as vCPU-hours",
  );
});

check("reads plural and abbreviated time spellings", () => {
  // A missed plural does not fail loudly: the row falls through to whichever
  // family is defined by the *absence* of a time dimension, and the archetype
  // silently reports no data.
  for (const unit of ["GB-Months", "GB Mos", "1 GB/Month"]) {
    const result = normalizeQuantity(unit, 10, "gib-month");
    assert(result !== null, `"${unit}" was not recognised as a GB-month meter`);
  }
  for (const unit of ["Hours", "Hrs", "1 Hour"]) {
    assert(
      normalizeQuantity(unit, 10, "vcpu-hour") !== null,
      `"${unit}" was not recognised as an hour meter`,
    );
  }
});

check("reads a spelled-out batch multiplier", () => {
  const spelled = normalizeQuantity("1 Million tokens", 3, "thousand-tokens");
  assert(
    spelled !== null && spelled.quantity === 3_000,
    `expected 3000 thousand-tokens, got ${spelled?.quantity}`,
  );
});

check("reads the byte magnitude, not merely byte-ness", () => {
  // Treating a TB meter as GB overstates the derived rate by three orders of
  // magnitude — large enough to invert a ranking, small enough in the code to
  // miss. The scale is binary throughout (1 TB meter = 1024 GiB), matching the
  // GiB-denominated canonical units; what matters here is the magnitude.
  const gb = normalizeQuantity("1 GB", 1_024, "gb-egress");
  const tb = normalizeQuantity("1 TB", 1, "gb-egress");
  assert(gb !== null && tb !== null, "byte egress meters were not recognised");
  assert(
    Math.abs(tb!.quantity - gb!.quantity) < 1e-6,
    `1 TB (${tb!.quantity}) did not equal 1024 GB (${gb!.quantity})`,
  );

  const mb = normalizeQuantity("1 MB", 1_024, "gb-egress");
  assert(
    mb !== null && Math.abs(mb.quantity - 1) < 1e-9,
    `1024 MB should be 1 GiB, got ${mb?.quantity}`,
  );
});

check("distinguishes scanned bytes from egressed bytes by archetype", () => {
  // The unit text is identical; only the workload tells them apart.
  const scanned = normalizeQuantity("1 TB", 2, "tb-scanned");
  assert(
    scanned !== null && Math.abs(scanned.quantity - 2) < 1e-6,
    `expected 2 TB scanned, got ${scanned?.quantity}`,
  );
});

// ── Classification ───────────────────────────────────────────────────────
console.log("\nClassification");

check("classifies each vendor's compute into one archetype", () => {
  const cases: Array<[CloudProvider, string, string]> = [
    ["Azure", "Virtual Machines", "Virtual Machines"],
    ["AWS", "Amazon Elastic Compute Cloud", "AmazonEC2"],
    ["GCP", "Compute Engine", "Compute Engine"],
  ];
  for (const [providerName, serviceName, meter] of cases) {
    const id = classifyRow({
      providerName,
      serviceName,
      serviceCategory: "Compute",
      skuMeterCategory: meter,
      skuMeterSubcategory: "",
      resourceType: "",
    });
    assert(
      id === "general-purpose-compute",
      `${providerName} compute classified as ${id}`,
    );
  }
});

check("keeps attached storage out of the compute archetype", () => {
  // Without this exclusion the disk cost is divided by vCPU-hours and the
  // compute rate is inflated by storage the archetype does not price.
  const id = classifyRow({
    providerName: "Azure",
    serviceName: "Virtual Machines",
    serviceCategory: "Compute",
    skuMeterCategory: "Virtual Machines",
    skuMeterSubcategory: "Premium SSD Managed Disk",
    resourceType: "microsoft.compute/disks",
  });
  assert(id !== "general-purpose-compute", "a managed disk priced as compute");
});

check("classifies nothing for support and tax rows", () => {
  const id = classifyRow({
    providerName: "AWS",
    serviceName: "AWS Support (Business)",
    serviceCategory: "Other",
    skuMeterCategory: "AWSSupportBusiness",
    skuMeterSubcategory: "",
    resourceType: "",
  });
  assert(id === null, `a support charge classified as ${id}`);
});

// ── Purchase terms ───────────────────────────────────────────────────────
console.log("\nPurchase terms");

function row(overrides: Partial<ComparableRow>): ComparableRow {
  return {
    providerName: "Azure",
    serviceName: "Virtual Machines",
    serviceCategory: "Compute",
    skuMeterCategory: "Virtual Machines",
    skuMeterSubcategory: "",
    resourceType: "",
    chargePeriodStart: "2026-01-01",
    chargePeriodEnd: "2026-02-01",
    chargeCategory: "Usage",
    pricingCategory: "Standard",
    pricingUnit: "1 Hour",
    consumedQuantity: 100,
    cost: 100,
    baselineCost: 100,
    skuTerm: "",
    ...overrides,
  };
}

check("maps committed terms by month count", () => {
  assert(
    termOf(row({ pricingCategory: "Committed", skuTerm: "12" })) === "1-year",
    "12 months did not map to a 1-year term",
  );
  assert(
    termOf(row({ pricingCategory: "Committed", skuTerm: "36" })) === "3-year",
    "36 months did not map to a 3-year term",
  );
});

check("excludes spot capacity from the on-demand rate", () => {
  // Spot is a market rate for interruptible capacity. Averaging it into
  // on-demand would make a provider look cheap for durable workloads.
  assert(
    termOf(row({ pricingCategory: "Dynamic" })) === null,
    "spot capacity was counted as a purchase term",
  );
});

check("excludes non-usage rows", () => {
  assert(
    termOf(row({ chargeCategory: "Purchase" })) === null,
    "a purchase row was given a term",
  );
  assert(termOf(row({ chargeCategory: "Tax" })) === null, "tax was given a term");
});

check("drops a committed row whose term cannot be read", () => {
  assert(
    termOf(row({ pricingCategory: "Committed", skuTerm: "" })) === null,
    "an unreadable commitment term was guessed rather than dropped",
  );
});

check("reads both spellings of the commitment category", () => {
  // The repo emits "Committed" and "Commitment" for the same FOCUS concept.
  // A catch-all default over PricingCategory pours committed rows — already
  // discounted — into the on-demand cell and understates list pricing.
  for (const spelling of ["Committed", "Commitment"]) {
    assert(
      termOf(row({ pricingCategory: spelling, skuTerm: "36" })) === "3-year",
      `"${spelling}" with a 36-month term did not map to 3-year`,
    );
  }
});

check("reads both spellings of the on-demand category", () => {
  for (const spelling of ["Standard", "On-Demand", "OnDemand"]) {
    assert(
      termOf(row({ pricingCategory: spelling })) === "on-demand",
      `"${spelling}" was not read as on-demand`,
    );
  }
});

check("drops an unrecognised pricing category rather than assuming on-demand", () => {
  assert(
    termOf(row({ pricingCategory: "SomeFuturePricingModel" })) === null,
    "an unknown pricing category defaulted into the on-demand rate",
  );
});

// ── Comparison window ────────────────────────────────────────────────────
console.log("\nComparison window");

check("clips to the period every provider covers", () => {
  const window = commonWindow([
    { provider: "Azure", from: "2025-01-01", toExclusive: "2026-01-01" },
    { provider: "AWS", from: "2025-10-01", toExclusive: "2026-01-01" },
  ]);
  assert(window.from === "2025-10-01", `window started at ${window.from}`);
  assert(window.clipped, "clipping was not reported");
});

check("does not report clipping when spans align", () => {
  const window = commonWindow([
    { provider: "Azure", from: "2026-01-01", toExclusive: "2026-02-01" },
    { provider: "AWS", from: "2026-01-01", toExclusive: "2026-02-01" },
  ]);
  assert(!window.clipped, "aligned spans were reported as clipped");
});

// ── Rates ────────────────────────────────────────────────────────────────
console.log("\nRates");

check("derives a rate as cost divided by normalized quantity", () => {
  const observations = toObservations([
    row({ cost: 1_000, consumedQuantity: 500, pricingUnit: "1 Hour" }),
  ]);
  assert(observations.length === 1, "expected exactly one observation");
  assert(
    observations[0].quantity === 500,
    `quantity was ${observations[0].quantity}`,
  );
});

check("a batched unit does not change the derived rate", () => {
  // 500 hours billed as "1 Hour" x500 and as "100 Hours" x5 are the same
  // purchase and must produce the same rate.
  const perHour = toObservations([
    row({ cost: 1_000, consumedQuantity: 500, pricingUnit: "1 Hour" }),
  ])[0];
  const batched = toObservations([
    row({ cost: 1_000, consumedQuantity: 5, pricingUnit: "100 Hours" }),
  ])[0];
  assert(
    perHour.cost / perHour.quantity === batched.cost / batched.quantity,
    "batched and per-hour meters produced different rates",
  );
});

check("names the cheapest provider on compute in the demo estate", () => {
  const compute = facts.archetypes.find(
    (a) => a.archetypeId === "general-purpose-compute",
  )!;
  const azure = compute.cells.Azure?.["on-demand"];
  const gcp = compute.cells.GCP?.["on-demand"];
  assert(azure?.observed === true, "Azure compute was not observed");
  assert(gcp?.observed === true, "GCP compute was not observed");
  assert(
    compute.cheapestProvider !== null,
    "no cheapest provider with three observed",
  );
  assert(
    compute.spread !== null && compute.spread > 0,
    "spread was not computed",
  );
});

// ── Weights and scoring ──────────────────────────────────────────────────
console.log("\nWeights and scoring");

check("weights always sum to one", () => {
  const w = normalizeWeights({ price: 2, performance: 1, sla: 1, egress: 0 });
  const total = w.price + w.performance + w.sla + w.egress;
  assert(Math.abs(total - 1) < 1e-9, `weights summed to ${total}`);
  assert(w.egress === 0, "a zero weight was resurrected");
});

check("falls back to defaults when all weights are zero", () => {
  const w = normalizeWeights({ price: 0, performance: 0, sla: 0, egress: 0 });
  assert(w.price === DEFAULT_WEIGHTS.price, "all-zero weights were not reset");
});

check("applied weights of participating indices sum to one", () => {
  // This is the renormalization invariant. If an index drops out for lack of
  // data, the rest must absorb its weight — otherwise every score is silently
  // scaled down and the ranking compresses toward zero.
  for (const score of facts.scores) {
    const applied = score.components.reduce((a, c) => a + c.weightApplied, 0);
    assert(
      Math.abs(applied - 1) < 1e-9,
      `${score.provider} applied weights summed to ${applied}`,
    );
  }
});

check("an omitted index carries a reason and no value", () => {
  for (const score of facts.scores) {
    for (const component of score.components) {
      if (component.value === null) {
        assert(
          Boolean(component.omittedReason),
          `${score.provider}/${component.indexId} was omitted without a reason`,
        );
        assert(
          component.contribution === 0,
          `${score.provider}/${component.indexId} contributed while omitted`,
        );
      }
    }
  }
});

check("scores are ordered best first", () => {
  for (let i = 1; i < facts.scores.length; i += 1) {
    assert(
      facts.scores[i - 1].score >= facts.scores[i].score,
      "scores were not sorted descending",
    );
  }
});

/** Two providers running the same archetype at the given hourly rates. */
function twoProviderCompute(azureRate: number, awsRate: number) {
  return buildMulticloudFacts({
    rows: [
      row({
        providerName: "Azure",
        serviceName: "Virtual Machines",
        consumedQuantity: 1_000,
        cost: azureRate * 1_000,
        baselineCost: azureRate * 1_000,
      }),
      row({
        providerName: "AWS",
        serviceName: "Amazon Elastic Compute Cloud",
        skuMeterCategory: "AmazonEC2",
        consumedQuantity: 1_000,
        cost: awsRate * 1_000,
        baselineCost: awsRate * 1_000,
      }),
    ],
    currency: "USD",
    providersPresent: ["Azure", "AWS"],
  });
}

function priceComponent(f: typeof facts, provider: string) {
  const score = f.scores.find((s) => s.provider === provider);
  return score?.components.find((c) => c.indexId === "price") ?? null;
}

check("a near tie does not score as a rout", () => {
  // Min-max normalization over two providers always awards 100 and 0 whatever
  // the gap. A 0.5% difference then reads on screen as a total defeat, which
  // is the single most misleading thing this view could do.
  const tie = twoProviderCompute(1.0, 1.005);
  const winner = priceComponent(tie, "Azure");
  const loser = priceComponent(tie, "AWS");
  assert(
    winner?.value != null && loser?.value != null,
    "the price index did not participate for both providers",
  );
  assert(
    Math.abs(winner!.value! - loser!.value!) < 5,
    `a 0.5% price gap produced a ${Math.abs(
      winner!.value! - loser!.value!,
    ).toFixed(1)}-point spread`,
  );
});

check("a rout does not score as a near tie", () => {
  // The converse: the scale must still separate genuinely different prices.
  const rout = twoProviderCompute(1.0, 5.0);
  const winner = priceComponent(rout, "Azure")!.value!;
  const loser = priceComponent(rout, "AWS")!.value!;
  assert(
    winner - loser > 40,
    `a 5x price gap produced only a ${(winner - loser).toFixed(1)}-point spread`,
  );
});

check("identical rates score identically regardless of what else runs", () => {  // Averaging each provider's own archetypes compares different baskets. A
  // provider that also runs an intrinsically dearer service then ranks last on
  // price at literally identical compute rates.
  const both = buildMulticloudFacts({
    rows: [
      row({
        providerName: "Azure",
        serviceName: "Virtual Machines",
        consumedQuantity: 1_000,
        cost: 1_000,
        baselineCost: 1_000,
      }),
      row({
        providerName: "Azure",
        serviceName: "Azure Database for PostgreSQL",
        serviceCategory: "Databases",
        skuMeterCategory: "Azure Database for PostgreSQL",
        consumedQuantity: 1_000,
        cost: 40_000,
        baselineCost: 40_000,
      }),
      row({
        providerName: "AWS",
        serviceName: "Amazon Elastic Compute Cloud",
        skuMeterCategory: "AmazonEC2",
        consumedQuantity: 1_000,
        cost: 1_000,
        baselineCost: 1_000,
      }),
    ],
    currency: "USD",
    providersPresent: ["Azure", "AWS"],
  });

  const azure = priceComponent(both, "Azure")!.value!;
  const aws = priceComponent(both, "AWS")!.value!;
  assert(
    Math.abs(azure - aws) < 1,
    `identical compute rates scored ${azure.toFixed(1)} vs ${aws.toFixed(1)} ` +
      "— an archetype only one provider runs leaked into the comparison",
  );
});

check("the SLA index separates providers by downtime, not by availability", () => {
  // The reference table stores availability as a fraction. Scoring `100 - sla`
  // instead of `1 - sla` yields ~99 for everyone and a ratio of ~1.000004: the
  // index still appears in the breakdown, still consumes its weight, and still
  // reports that it participated — while carrying no information whatsoever.
  //
  // relational-database is the discriminating case in the table: Azure 99.99%
  // against AWS 99.95%, which is a fivefold difference in downtime.
  const dbRow = (provider: "Azure" | "AWS") =>
    row({
      providerName: provider,
      serviceName:
        provider === "Azure"
          ? "Azure Database for PostgreSQL"
          : "Amazon Relational Database Service",
      serviceCategory: "Databases",
      skuMeterCategory:
        provider === "Azure" ? "Azure Database for PostgreSQL" : "AmazonRDS",
      consumedQuantity: 1_000,
      cost: 1_000,
      baselineCost: 1_000,
    });

  const dbOnly = buildMulticloudFacts({
    rows: [dbRow("Azure"), dbRow("AWS")],
    currency: "USD",
    providersPresent: ["Azure", "AWS"],
  });

  const sla = (provider: string) =>
    dbOnly.scores
      .find((s) => s.provider === provider)
      ?.components.find((c) => c.indexId === "sla")?.value ?? null;

  const azure = sla("Azure");
  const aws = sla("AWS");
  assert(
    azure != null && aws != null,
    "the SLA index did not participate for both providers",
  );
  assert(
    azure! > aws! + 40,
    `99.99% scored ${azure!.toFixed(1)} against 99.95% at ${aws!.toFixed(1)} ` +
      "— a fivefold downtime difference was flattened, so the index is inert",
  );
});

check("an unrankable comparison is returned unranked, not as a tie", () => {
  // Two providers that share no archetype cannot be scored on a common basis.
  // Emitting 0.0 for each would render as a podium whose order comes only from
  // input order, and the narrative would then be asked to justify it.
  const disjoint = buildMulticloudFacts({
    rows: [
      row({
        providerName: "Azure",
        serviceName: "Virtual Machines",
        consumedQuantity: 1_000,
        cost: 1_000,
        baselineCost: 1_000,
      }),
      row({
        providerName: "AWS",
        serviceName: "Amazon Simple Storage Service",
        serviceCategory: "Storage",
        skuMeterCategory: "AmazonS3",
        pricingUnit: "1 GB/Month",
        consumedQuantity: 1_000,
        cost: 20,
        baselineCost: 20,
      }),
    ],
    currency: "USD",
    providersPresent: ["Azure", "AWS"],
  });

  assert(
    disjoint.scores.length === 0,
    `an unrankable comparison produced ${disjoint.scores.length} scores ` +
      `(${disjoint.scores.map((s) => s.score.toFixed(1)).join(", ")})`,
  );
  assert(
    Boolean(disjoint.insufficientForRecommendation),
    "an unrankable comparison did not suppress the recommendation",
  );
});

check("a provider outside the taxonomy cannot clip the window", () => {
  // "Other" — where normalizeProvider sends any unrecognised ProviderName —
  // can never produce a cell, but if it joins the window intersection a
  // handful of stray rows will truncate a sound comparison, or empty it and
  // report "no comparable workload" for a dataset full of it.
  const rows = [
    row({
      providerName: "Azure",
      serviceName: "Virtual Machines",
      chargePeriodStart: "2026-01-01",
      chargePeriodEnd: "2026-02-01",
      consumedQuantity: 1_000,
      cost: 1_000,
      baselineCost: 1_000,
    }),
    row({
      providerName: "AWS",
      serviceName: "Amazon Elastic Compute Cloud",
      skuMeterCategory: "AmazonEC2",
      chargePeriodStart: "2026-01-01",
      chargePeriodEnd: "2026-02-01",
      consumedQuantity: 1_000,
      cost: 1_100,
      baselineCost: 1_100,
    }),
  ];

  const clean = buildMulticloudFacts({
    rows,
    currency: "USD",
    providersPresent: ["Azure", "AWS"],
  });

  const polluted = buildMulticloudFacts({
    rows: [
      ...rows,
      row({
        providerName: "Other" as never,
        serviceName: "Some Marketplace Resale",
        chargePeriodStart: "2026-06-01",
        chargePeriodEnd: "2026-07-01",
        consumedQuantity: 1,
        cost: 5,
        baselineCost: 5,
      }),
    ],
    currency: "USD",
    providersPresent: ["Azure", "AWS", "Other" as never],
  });

  assert(
    polluted.window.from === clean.window.from &&
      polluted.window.toExclusive === clean.window.toExclusive,
    `an out-of-taxonomy provider moved the window from ` +
      `${clean.window.from}..${clean.window.toExclusive} to ` +
      `${polluted.window.from}..${polluted.window.toExclusive}`,
  );
  assert(
    polluted.providersCompared.length === 2,
    "the comparison was emptied by a provider that can never be compared",
  );
});

// ── Honest gaps ──────────────────────────────────────────────────────────
console.log("\nHonest gaps");

check("every unobserved cell carries a reason", () => {
  for (const archetype of facts.archetypes) {
    for (const [provider, terms] of Object.entries(archetype.cells)) {
      for (const [term, cell] of Object.entries(terms)) {
        if (cell.observed) continue;
        assert(
          Boolean(cell.reason),
          `${provider}/${archetype.archetypeId}/${term} was empty with no reason`,
        );
      }
    }
  }
});

check("no observed cell carries a non-finite rate", () => {
  for (const archetype of facts.archetypes) {
    for (const terms of Object.values(archetype.cells)) {
      for (const cell of Object.values(terms)) {
        if (!cell.observed) continue;
        assert(
          Number.isFinite(cell.rate) && cell.rate > 0,
          `${archetype.archetypeId} produced a rate of ${cell.rate}`,
        );
      }
    }
  }
});

check("a single-provider dataset suppresses any recommendation", () => {
  const azureOnly = buildMulticloudFacts({
    rows: mockMulticloudRows.filter((r) => r.providerName === "Azure"),
    currency: "USD",
    providersPresent: ["Azure"],
  });
  assert(
    azureOnly.insufficientForRecommendation !== null,
    "a single-provider dataset still offered a recommendation",
  );
  assert(
    azureOnly.archetypes.every((a) => a.cheapestProvider === null),
    "a cheapest provider was named with only one provider present",
  );
  assert(
    coverageNotices(azureOnly).some((n) => n.severity === "warning"),
    "no warning was raised for a single-provider comparison",
  );
});

check("an absent provider is reported as absent, not as zero", () => {
  const noGcp = buildMulticloudFacts({
    rows: mockMulticloudRows.filter((r) => r.providerName !== "GCP"),
    currency: "USD",
    providersPresent: ["Azure", "AWS"],
  });
  const anyGcpCell = noGcp.archetypes.some((a) => a.cells.GCP !== undefined);
  assert(!anyGcpCell, "an absent provider was given cells");
  assert(
    !noGcp.providersCompared.includes("GCP"),
    "an absent provider appeared as compared",
  );
});

check("coverage counts only cells that exist", () => {
  assert(
    facts.coverage.observedCells <= facts.coverage.totalCells,
    "observed cells exceeded total cells",
  );
  assert(
    facts.coverage.ratio >= 0 && facts.coverage.ratio <= 1,
    `coverage ratio out of range: ${facts.coverage.ratio}`,
  );
});

// ── Narrative guardrails ─────────────────────────────────────────────────
console.log("\nNarrative guardrails");

const winner = facts.scores[0];
const runnerUp = facts.scores[1];

/**
 * A narrative quoting only figures that exist in the facts.
 *
 * Deliberately built from `facts` at runtime rather than hardcoded, so the
 * test keeps meaning when the mock estate changes.
 */
function validNarrative() {
  return {
    summary:
      `Across ${facts.providersCompared.length} providers, ` +
      `${winner.provider} ranks highest at ${winner.score.toFixed(1)}.`,
    tradeoffs: ["The cheapest unit rate is not always the cheapest estate."],
    recommendation: `Keep new general-purpose workloads on ${winner.provider}.`,
  };
}

check("a narrative quoting only measured figures passes", () => {
  const violations = validateNarrative(validNarrative(), facts);
  assert(
    violations.length === 0,
    `a clean narrative was rejected: ${violations.map((v) => v.rule).join(", ")}`,
  );
});

check("quoting the comparison window is not treated as invention", () => {
  // Regression: a naive numeric scan reads "2026-01-01" as 2026, -1, -1 and
  // rejects the model for correctly quoting the window it was given.
  const response = validNarrative();
  response.summary = `Measured from ${facts.window.from} to ${facts.window.toExclusive}.`;
  const violations = validateNarrative(response, facts);
  assert(
    violations.length === 0,
    `quoting the window was rejected: ${violations.map((v) => v.detail).join("; ")}`,
  );
});

check("a date the facts do not contain is rejected", () => {
  const response = validNarrative();
  response.summary = "Measured from 1999-01-01 to 1999-12-31.";
  const violations = validateNarrative(response, facts);
  assert(
    violations.some((v) => v.rule === "anchored-numbers"),
    "an invented date was allowed through",
  );
});

check("the anchoring check is restrictive, not vacuous", () => {
  // A guardrail that accepts almost anything passes every targeted test while
  // guarding nothing. If the allowed set has grown dense, this fails.
  let accepted = 0;
  const samples = 400;
  for (let i = 0; i < samples; i += 1) {
    const value = (i + 1) * 0.37 + 0.11;
    const response = validNarrative();
    response.summary = `The figure is ${value.toFixed(2)}.`;
    if (
      !validateNarrative(response, facts).some((v) => v.rule === "anchored-numbers")
    ) {
      accepted += 1;
    }
  }
  const rate = accepted / samples;
  assert(
    rate < 0.1,
    `${Math.round(rate * 100)}% of arbitrary numbers passed anchoring — the check is too permissive`,
  );
});

check("an invented number is rejected", () => {
  const response = validNarrative();
  // A saving nobody measured — the single most likely hallucination for this
  // feature, because a comparison of rates reads like a promise of savings.
  response.recommendation += " This would save 42.7% annually.";
  const violations = validateNarrative(response, facts);
  assert(
    violations.some((v) => v.rule === "anchored-numbers"),
    "a fabricated percentage was allowed through",
  );
});

check("rounding a real figure is not treated as invention", () => {
  const response = validNarrative();
  response.summary = `${winner.provider} scores ${Math.round(winner.score)}.`;
  const violations = validateNarrative(response, facts);
  assert(
    !violations.some((v) => v.rule === "anchored-numbers"),
    "a legitimately rounded figure was rejected as invented",
  );
});

check("a provider with no observed rate cannot be discussed", () => {
  const azureOnly = buildMulticloudFacts({
    rows: mockMulticloudRows.filter((r) => r.providerName === "Azure"),
    currency: "USD",
    providersPresent: ["Azure"],
  });
  const violations = validateNarrative(
    {
      summary: "AWS looks cheaper than Azure here.",
      tradeoffs: ["Egress dominates."],
      recommendation: "Move to AWS.",
    },
    azureOnly,
  );
  assert(
    violations.some((v) => v.rule === "no-unobserved-provider"),
    "a provider absent from the dataset was discussed without objection",
  );
});

check("a single-provider dataset suppresses the recommendation", () => {
  const azureOnly = buildMulticloudFacts({
    rows: mockMulticloudRows.filter((r) => r.providerName === "Azure"),
    currency: "USD",
    providersPresent: ["Azure"],
  });
  assert(
    azureOnly.insufficientForRecommendation !== null,
    "a single-provider comparison did not declare itself insufficient",
  );
  const violations = validateNarrative(validNarrative(), azureOnly);
  assert(
    violations.some((v) => v.rule === "no-unsupported-recommendation"),
    "a recommendation was allowed on a dataset that cannot support one",
  );
});

check("prose may not invert the ranking", () => {
  if (!runnerUp) return;
  const violations = validateNarrative(
    {
      summary: "The providers are close.",
      tradeoffs: ["Commitment terms differ in flexibility."],
      recommendation: `We recommend ${runnerUp.provider} for all new workloads.`,
    },
    facts,
  );
  assert(
    violations.some((v) => v.rule === "consistent-with-ranking"),
    "prose contradicting the computed ranking was allowed",
  );
});

check("claims about things never measured are rejected", () => {
  for (const claim of [
    "Latency is better on this cloud.",
    "The payback period is short.",
    "This option is more sustainable.",
  ]) {
    const response = validNarrative();
    response.tradeoffs = [claim];
    const violations = validateNarrative(response, facts);
    assert(
      violations.some((v) => v.rule === "no-unmeasured-claims"),
      `an unmeasurable claim was allowed: "${claim}"`,
    );
  }
});

check("the model projection carries no raw quantities to divide", () => {
  // The guardrails catch invented numbers after the fact; withholding the
  // ingredients stops them being computed in the first place. Keys, not
  // substrings: "Performance per unit cost" is a label, not a divisor.
  const forbidden = new Set(["quantity", "cost", "rowCount", "consumedQuantity"]);
  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (node === null || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      assert(
        !forbidden.has(key),
        `the projection exposed "${path}.${key}", which the model could divide`,
      );
      walk(value, `${path}.${key}`);
    }
  };
  walk(projectFactsForModel(facts), "payload");
});

// ── Markdown export ──────────────────────────────────────────────────────
console.log("\nMarkdown export");

check("the export never prints a rate for an unobserved cell", () => {
  const markdown = renderMulticloudMarkdown(facts);
  for (const archetype of facts.archetypes) {
    for (const provider of Object.keys(archetype.cells) as CloudProvider[]) {
      const terms = archetype.cells[provider];
      if (!terms) continue;
      for (const cell of Object.values(terms)) {
        if (cell.observed) continue;
        assert(
          markdown.includes(UNOBSERVED_REASON_LABELS[cell.reason]),
          `an unobserved cell (${cell.reason}) lost its reason in the export`,
        );
      }
    }
  }
});

check("the export carries its caveats", () => {
  const markdown = renderMulticloudMarkdown(facts);
  assert(
    markdown.includes("Migration effort"),
    "the export omitted the migration-cost caveat",
  );
  assert(
    markdown.includes("not zero cost"),
    "the export omitted the not-observed caveat",
  );
});

check("every rate in the export exists in the facts", () => {
  const markdown = renderMulticloudMarkdown(facts);
  for (const archetype of facts.archetypes) {
    for (const provider of Object.keys(archetype.cells) as CloudProvider[]) {
      const terms = archetype.cells[provider];
      if (!terms) continue;
      for (const cell of Object.values(terms)) {
        if (!cell.observed) continue;
        assert(
          markdown.includes(cell.rate.toFixed(4)),
          `${provider}/${archetype.archetypeId} rate is missing from the export`,
        );
      }
    }
  }
});

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${passes} passed, ${failures} failed\n`);
if (failures > 0) process.exit(1);
