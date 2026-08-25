# Stakeholder Cards

Five slices of the **same** set of assessed facts, one per decision role.

Product specification: [`docs/prd-stakeholder-cards.md`](../product/prd-stakeholder-cards.md)
at the repository root. This document describes the implementation in this application.

## What it is

An analytical report has a single implicit reader — "the committee". That reader does not exist.
What exists is the CFO, the CIO, the architect, the buyer, and the application owner, and each asks a
different question when facing the **same fact**.

The feature delivers one card per persona, containing the question that person actually asks, only
the metrics that answer it, the caveats that cannot be omitted in that slice, and a next action that
that person has authority to approve.

## The invariant

> **The card reframes, never recalculates.**

Every metric is read from an existing aggregator and only formatted. No new arithmetic in the
builders. That is what allows five documents to be delivered to five executives without the risk that
they meet in a room and discover divergent numbers.

If a card disagrees with the corresponding dashboard page, it is a **bug** — not an opinion.

## Surfaces

| Surface | Address | Why |
|---|---|---|
| Payload | `GET /api/stakeholder-cards` | Source of truth; consumable by API |
| Dashboard | `/stakeholder-cards` | Tabs, one per persona |
| Markdown | `GET /api/stakeholder-cards/markdown` | **Forwardable on its own** — one block per persona + LEIA-ME |
| AI refinement | `POST /api/stakeholder-cards/refine` | Optional; three prose fields, with guardrails |

All of them respect the same `ParsedFilters` as the other pages. `?scope=<subscription>` slices
only the Application Owner card.

## Architecture

```
src/lib/stakeholder/
  types.ts        Types. StakeholderFacts is the single source of truth.
  catalog.ts      Five personas: id, title, question, focus.
  facts.ts        ALL arithmetic lives here. Reads from existing aggregators.
  scope.ts        Rollup by subscription (Application Owner card).
  builders.ts     One builder per persona. Zero arithmetic: only selection and formatting.
  format.ts       pt-BR formatting. Missing layer becomes "Not assessed".
  guardrails.ts   The 8 guardrails, validated card by card.
  narrative.ts    Prompt, projection into facts, and refinement application.
  contract.ts     Zod contract for the model response.
  markdown.ts     One file per persona + LEIA-ME.
  index.ts        buildStakeholderCardsPayload().
```

The `facts.ts` × `builders.ts` separation is what makes the "no new number is created" rule
mechanically verifiable: the test flattens `StakeholderFacts` and requires every `raw` value in every
card to exist in that map, at the path declared in `factPath`.

### Source precedence

The same as the rest of the dashboard: **customer dataset** (presales POC) > **static mock** (demo).
The ADX path does not yet expose an equivalent single aggregator; until then, the route behaves like
the others in the `isMockMode()` branch.

## The five personas

| # | Persona | Question | Primary metrics |
|---|---|---|---|
| 1 | CFO | How much is this worth and when does it enter the budget? | Annualized run rate, MoM variance, annual savings, ESR, cost of delay |
| 2 | CIO | Is the capacity we purchased aligned with actual usage? | Idle resources, stranded cost, commitment coverage, tag compliance, policies |
| 3 | Cloud Architect | What do I execute, and what can break? | Actions under validation, savings subject to validation, largest idle resource, anomalies, largest deviation |
| 4 | Procurement | Am I buying discounts on top of waste? | Eligible on-demand, already under commitment, services below target, unused commitment, waste to clean up |
| 5 | Application Owner | Will this break my application? | Scope cost, share, idle resources in scope, savings under validation, environment scopes |

Order = **from money to execution**, which is the sequence in which a decision flows down in an
organization.

**Sustainability was left out** intentionally: it would require energy and carbon data that the
pipeline does not measure. A card without numbers would have the appearance of analysis without
being analysis.

> Only add a persona when there is an assessed fact to support it. Persona is a consequence
> of the available data, never of the customer's org chart.

## Rules enforced by the code

1. **Buckets are never recombined.** `commitmentGapSavings` and `idleResourceSavings` are not
   added outside `aggregateSavingsSummary`. The CFO card never exposes bucket and total together.
2. **Persona does not relax the floor.** The scope rollup slices cost and idleness — which are
   per-resource. Coverage, compliance, and technical limits are **inherited**, never reassessed
   against the subset. Money allocation is exact when the price is per unit; a risk verdict cannot
   be allocated.
3. **"Ready" is not "free".** Every card that mentions savings carries the split *no prerequisite*
   × *requires engineering validation*.
4. **A missing layer is declared.** Without layer X, the card says **"Not assessed"** — never
   "low risk". Absence of evidence is not evidence of absence.
5. **`tip` is mandatory.** A metric without explanation becomes an orphan number, and an orphan
   number is always read in the way most favorable to whoever is speaking.

## AI layer

The deterministic card **is already deliverable**. AI only rewrites `headline`, `whyItMatters`, and
`nextAction`. `metrics` and `caveats` are immutable — they do not even appear in the response contract.

### The 8 guardrails

| # | Guardrail | Question it asks |
|---|---|---|
| 1 | `persona-existe` | Is there a deterministic card behind it? |
| 2 | `non-empty-response` | — |
| 3 | **`anti-diluicao`** | Is it still worth reading? |
| 4 | `ancoragem` | Does every number have backing in the facts? |
| 5 | `papel-do-numero` | Is what was called savings actually savings? |
| 6 | `entidades` | Do the referenced identifiers exist? |
| 7 | `alegacoes` | Was any capability invented? |
| 8 | **`decomposicao`** | Do the parts fit within the whole? |

Validation is **per card**: a bad card does not bring down the whole narrative. When a guardrail
fails, that card returns to the deterministic text and the reason appears in the UI — without that,
one card falling back would seem arbitrary.

#### Guardrail 3 — dilution is also a failure

It is the only guardrail that fails **true** text. A model that replies *"blockers must be handled
with priority"* where the deterministic text named the retained value passes every honesty validation
and is still strictly worse.

**Mechanical rule:** prose that cited numbers cannot come back without any.

#### Guardrail 8 — false decomposition

The falsehood may live in the **relationship** between two true numbers:

> "BRL 65.154,97/month in actionable savings, **including** BRL 187.556,66/month in changes with
> no architecture change and BRL 81.859,57/month requiring validation."

The three values exist and are correctly labeled — but the first is the share of one environment and
the other two are corporate totals. In a regulated context, this is a material error.

**Mechanical rule:** when a decomposition marker ("including", "of which", "of those") connects
monetary values, the parts cannot exceed the whole (1% tolerance).

Conservative in three points, because rejecting unnecessarily discards the whole narrative:

1. Only values with an **explicit currency** count — "5 environments, including 3 production" is a count.
2. The parts clause **ends at the first contrast marker** ("in addition to", "while", "however").
3. Ambiguous tokens across locales (`1.234`) are read in the direction that **makes rejection harder**:
   largest possible whole, smallest possible parts.

### Circularity

The facts sent to the model **include** the cards — otherwise, the model would be silently forbidden
from citing the numbers in its own card. Therefore, the grounding test validates against the
deterministic card, never against the returned payload: otherwise it becomes tautology, the card
validating the card.

### Token budget

`tokenBudgetFor(n)` grows with the number of cards. Without that, the model is asked to write N
additional blocks under a limit sized for none of them: the response truncates in the middle of the
JSON, parsing fails, and the run silently degrades.

## Rendering

The dashboard tabs use `radio` + `:checked` — **zero JavaScript, zero CDN**. That is what allows the
markup to be reused in an artifact that opens offline, from an email attachment, on a customer's
machine without internet access.

The markdown package includes a mandatory `LEIA-ME`: without it, five files look like five divergent
analyses instead of five slices of the same fact. Collection coverage appears in the package.

The package identifies the source customer — in the LEIA-ME and in the file name
(`stakeholder-cards-contoso.md`). Two packages exported from different customers would be
indistinguishable in the downloads folder, and swapping one for the other in a meeting is the kind of
error nobody notices in time. The cards follow the active customer in the dashboard — see
[customer-poc.md](./customer-poc.md#workspaces-one-folder-per-customer).

## Configuration

Only **titles** are configurable by customer (`CFO` → `Finance Director`), through
`titleOverrides`. Ids, questions, and metrics are not: they are the structure that guarantees the cards
do not diverge.

AI refinement requires `AZURE_OPENAI_ENDPOINT` and `AZURE_OPENAI_DEPLOYMENT`
(see [configuration.md](../reference/configuration.md)). Without them, the page continues delivering the
deterministic cards and the refinement button reports unavailability.

## Tests

```bash
npm run stakeholder:test
```

Runs both batteries:

- `scripts/test-stakeholder.ts` — deterministic layer: no new number, no contradiction, no universal
  metric, honest degradation, scope rollup, title-only configuration.
- `scripts/test-stakeholder-guardrails.ts` — the 8 guardrails, the three conservative points of false
  decomposition, non-circular grounding, token budget, and markdown export.