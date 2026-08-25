# Multicloud Comparison

`/multicloud` answers a question total spend cannot: **for the same unit of work,
which cloud costs less, and is the difference big enough to matter?**

Spend by provider is not that answer. A provider can look cheap simply because it
carries less workload. This view divides cost by observed quantity to produce a
**unit rate per workload archetype**, then places those rates side by side.

---

## The rule that shapes everything else

Prices come from **FOCUS data in the FinOps Hub** — not from public AWS or GCP
pricing APIs. That is a stronger source: it is the rate actually paid, after
negotiation, not a catalogue list price. But it exists only where the workload
actually ran.

> **A cell with no observed consumption is "Not observed". It is never estimated,
> never interpolated, and never filled in by AI.**

Every downstream behaviour follows from this. A blank cell is a gap in the data,
not a zero, not a low price, and not an invitation for a model to guess.

---

## What you get

| Surface | What it is |
| --- | --- |
| Comparison matrix | Unit rate per archetype × provider × term, or the reason there isn't one |
| Composite score | Price, performance, SLA and egress indices, weighted and broken down |
| Weight sliders | Re-rank for your workload — egress-heavy scores differently from batch |
| Markdown export | `GET /api/multicloud/markdown` — forwardable, carries its own caveats |
| AI summary | Optional prose over the finished numbers, validated before it is shown |

---

## Architecture

```
src/lib/multicloud/
  types.ts        MulticloudFacts — the single source of truth
  taxonomy.ts     Archetype ↔ FOCUS matchers, per provider
  normalize.ts    PricingUnit + ConsumedQuantity → canonical unit
  facts.ts        ALL arithmetic
  score.ts        Composite score and weight renormalization
  coverage.ts     Which cells were observed, and what to do about the rest
  projection.ts   Exactly what the model is shown — and all it may quote
  guardrails.ts   Validation of AI prose against the projection
  narrative.ts    Prompt, projection, and the model call
  contract.ts     Zod schema of the model response
  markdown.ts     Export
  index.ts        buildMulticloudComparisonPayload() — shared by all three routes
```

The invariant, inherited from `src/lib/stakeholder/`:

> **The narrative reframes, never recalculates.**

All arithmetic lives in `facts.ts` and `score.ts`. Presentation selects and
formats. A number on screen that disagrees with the table is a bug, not an
opinion.

### The three layers of normalization

The hard part is not the price. It is making rows comparable at all.

1. **Archetype equivalence** (`taxonomy.ts`) — claiming that a D-series VM, an
   `m6i` instance and an `n2-standard` are the same thing is an engineering
   opinion. It is therefore declared explicitly, versioned, and shown in the UI
   under "Taken to mean", so a reader can disagree with it. A language model
   never makes this call.
2. **Canonical unit** (`normalize.ts`) — FOCUS `PricingUnit` is vendor free text:
   `1 Hour`, `Hrs`, `hour`, `100 Hours`, `gibibyte month` all occur. Two rules:
   the leading batch multiplier is always parsed and applied (ignoring the `100`
   in `100 Hours` understates quantity by two orders of magnitude and manufactures
   a spectacular fake price advantage), and an unrecognised unit returns `null`
   rather than a guess.
3. **Capacity** — vCPU and RAM per SKU, so `$/hour` becomes `$/vCPU-hour`. This is
   the one dimension FOCUS does not reliably carry, so it comes from a versioned
   reference table whose capture date and provenance appear in the payload and in
   the export footer.

---

## The composite score

```
score = w_price   × priceIndex        (cost per canonical unit)
      + w_perf    × performanceIndex  (capacity per unit of spend)
      + w_sla     × slaIndex          (published SLA, scored as downtime)
      + w_egress  × egressIndex       (observed egress rate)
```

Every index resolves to a **badness ratio** against the best observed provider
(1.0 = best, 2.0 = twice as expensive/slow/unreliable), and the score is
`100 / ratio`. So 100 means "the best on this index" and 50 means "twice as
costly as the best".

Rules that keep it honest:

- **Ratios, not min-max normalization.** Rescaling each index onto 0–100 across
  the observed providers awards 100 to the cheapest and 0 to the dearest
  regardless of the gap. With two providers that is *always* the outcome, so a
  0.5% difference and a 500% difference render identically. A ratio keeps the
  magnitude of the gap in the number.
- **An index with no data is excluded and the remaining weights renormalize.** It
  is never given a neutral value — that would assert "average" where the truth is
  "unknown", and quietly compress the ranking.
- **An index participates only if every compared provider has a value for it.**
  Otherwise a provider is penalised for a reporting gap rather than for a price.
- **Only archetypes that every compared provider runs are scored.** Averaging
  over each provider's own workloads compares different baskets: a provider that
  also runs an intrinsically dearer service would rank last on price at
  identical compute rates.
- **The price index averages ratios to the cheapest, not raw rates.** Raw rates
  live in incompatible units, so the largest absolute number would dominate.
- **The SLA index scores downtime, not availability.** 99.99% against 99.9% is a
  tenfold difference in outage minutes but a 0.09-point difference in
  availability — invisible in any ratio taken over the published figure.
- Weights are adjustable in the UI and travel in the query string, so the export
  and the screen always agree.

---

## What the AI does and does not do

| Does | Does not |
| --- | --- |
| Summarises the trade-off in executive prose | Produce or adjust any number |
| Names qualitative migration risks | Fill in a "Not observed" cell |
| Orders recommendations by impact | Pick a winner against the score |
| Explains why cheap may not be worth it | Invent an equivalence outside the taxonomy |

The model is not merely told not to compute — it is **not given the ingredients**.
`projectFactsForModel()` (in `projection.ts`) sends rates and labels; costs,
quantities and row counts are stripped. A model holding a cost and a quantity is
a model that can divide, and a divided number is a new number.

That projection is also what the anchoring guardrail checks against: **allowed is
what was shown**. Deriving the permitted number set from the full facts object
instead is wrong twice over — it authorises intermediates the model never saw,
and it makes the permitted set dense enough that an invented figure lands within
tolerance by coincidence. `narrative.ts` and `guardrails.ts` therefore both
import the same function.

Guardrails in `guardrails.ts`, all enforced before the prose reaches the browser:

1. Every number cited traces to a number in the projection (1% tolerance for
   rounding). Dates are extracted before digits, or `2026-01-01` scans as the
   three numbers `2026`, `-1`, `-1`.
2. No provider outside `providersCompared` may be discussed.
3. No recommendation when the dataset cannot support one.
4. The recommendation may not invert the computed ranking.
5. No claims about latency, throughput, IOPS, carbon, compliance, payback or
   migration effort — this pipeline measures none of them.
6. Standing caveats are appended deterministically, never authored by the model.

A narrative that breaches any guardrail is **discarded whole, not patched**. The
deterministic comparison is already a complete deliverable; there is nothing to
gain from shipping prose we could not validate beside a table we could.

---

## Data sources

The standard cascade, identical to every other page:

| Mode | Path |
| --- | --- |
| Customer POC | `src/lib/customer-aggregations/multicloud.ts` |
| Mock | `src/lib/mock-data/multicloud.ts` — billing rows, run through the real pipeline |
| ADX | `src/lib/queries/multicloud.ts` over `Costs()` |

Classification happens in TypeScript, not KQL, on purpose: the taxonomy is the
most contestable logic in the feature, and encoding it in both KQL and TypeScript
would create two implementations free to drift.

### Required: re-ingest for the customer path

`ConsumedQuantity` is the denominator of every rate. It was added to
`CustomerCostRow` for this feature, so `CUSTOMER_DATASET_SCHEMA_VERSION` moved to
**1.7.0** and existing customer datasets must be re-ingested:

```bash
npm run ingest:customer -- "Contoso"
```

Without it the gate in `customer-dataset.ts` rejects the stale dataset rather than
serving rates with no denominator.

---

## Degradation

| Hub state | What the view shows |
| --- | --- |
| FOCUS with 2+ providers | Full comparison |
| FOCUS Azure only | Azure column populated, others "Not observed" plus an ingestion hint; no recommendation |
| Unequal history | Window clipped to the common period, and the clipping is reported |
| Mock mode | Synthetic estate, flagged `isMock` |

Unobserved reasons are distinct because they lead to different next actions:
`provider-absent`, `archetype-absent`, `term-absent`, `quantity-missing`,
`outside-common-window`.

---

## Known limits

- **SKU equivalence is an opinion.** Mitigated by making it explicit and visible,
  never by hiding it.
- **Reservations, Savings Plans and CUDs are not the same instrument.** FOCUS
  reports them under one pricing category, but they differ in scope, flexibility
  and exchange rights. The cheaper rate may be the less valuable instrument, so
  every commitment comparison carries `COMMITMENT_COMPARABILITY_CAVEAT`.
- **Spot capacity is excluded, not folded into on-demand.** It is a market rate
  for interruptible capacity; averaging it in makes a provider look cheap for
  durable workloads.
- **SLA and capacity reference tables are illustrative** and should be validated
  against vendor documentation before customer use. Their capture date is in the
  payload.
- **Rate differences are not a business case.** Migration effort, exit egress,
  retraining and dual-running are all outside this comparison.

---

## Testing

```bash
npm run multicloud:test
```

Covers unit normalization, classification, term mapping, window clipping, rate
derivation, weight renormalization, honest-gap handling, all six guardrails and
the Markdown export. No test calls a model.
