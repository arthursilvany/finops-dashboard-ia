# PRD — Stakeholder Cards

**Portable document.** Describes a generic product capability, not an Azure SKU Advisor feature. It was
extracted from a production implementation (5 personas, ~660 lines, 42 tests) and is written to be
replicated in any analytical report that currently speaks to "the committee": FinOps dashboards,
resilience assessments, security reviews, cost assessments.

**Reference status:** implemented and validated with a real customer (Vale, 401 workloads, 68
subscriptions).

---

## 1. The problem

An analytical report has a single implicit reader — "the committee", "the customer", "the team". That
reader does not exist. What exists is the CFO, the CIO, the architect, the buyer, and the application
owner, and each of them asks a different question when facing the **same fact**.

When the report does not make that translation, the translation still happens: it is **outsourced to the
hallway**. Someone summarizes the document for the executive on the way to the room, and that is
exactly where the caveat is lost. The number survives the informal translation; the condition that
qualifies it does not.

The observable symptom is familiar to anyone who authors technical reports:

- The executive receives an IOPS ceiling and dismisses the document as "infrastructure stuff".
- The architect receives *Effective Savings Rate* and dismisses it as "finance stuff".
- Each reader dismisses half of the document as "not for me" — and the dismissed half is exactly
  where the constraint was.

### What this PRD **does not** propose

It is not about generating N different reports, nor about "changing the PowerPoint logo". Superficial
personalization duplicates maintenance cost and creates divergence across versions — the worst
possible outcome in a document that must be auditable.

The thesis is the opposite, and cheaper:

> **A single set of assessed facts, N deterministic framings on top of it.**

If two cards disagree on a number, it is a bug — not an opinion. This property is what makes the
feature safe for regulated contexts.

---

## 2. Objective

Deliver, alongside the main report, **one card per decision persona**, containing:

1. The question that person actually asks.
2. Only the metrics that answer that question — and explicitly **not** the others.
3. The caveats that cannot be omitted in that slice.
4. A next action that **that person has authority to approve**.

### Success criteria

| Criterion | How to measure |
|---|---|
| No new number is created | Every card value traces back to an already assessed field. Automated test. |
| Cards do not contradict each other | Same fact, same value, across all cards. Automated test. |
| Each card can be forwarded on its own | Self-contained: metrics + meaning + caveats + action. |
| Real personalization | No metric appears in every persona. If it does, the catalog is wrong. |
| Honest degradation | Missing layer becomes "not assessed", never "no risk". |

### Non-goals

- It does not replace the full report; it is the entry point into it.
- It does not create new content — if a fact is not in the report, it does not enter the card.
- It is not segmentation by customer/industry. It is segmentation by the **role of the decision-maker**.

---

## 3. The central invariant

> ### The card **reframes**, never **recalculates**.

Every metric is *read* from an already assessed block and only **formatted**. No new arithmetic.

This rule looks like an implementation constraint; in reality, it is the value proposition. It is what
allows five different documents to be delivered to five executives without the risk that they meet in a
meeting and discover divergent numbers.

### Five practical consequences (all expensive to learn)

**1. Buckets are never recombined.**
If the pipeline guarantees that each item enters exactly one blocking bucket, adding two buckets to
compose a "prettier" number counts the same money twice.

**2. Persona does not relax the floor.**
The application owner card slices its scope, but security verdicts (quota, capacity, technical limits,
telemetry coverage) are **inherited, never reassessed**. A subset can *describe* a workload; it can
never *loosen* a floor assessed on the worst case. Money allocation is exact when the price is per
unit; a risk verdict cannot be allocated.

**3. A time-bound obligation never becomes an opportunity.**
Retirement/EOL exposure goes into its own metric, **outside** any savings total and outside ESR. It is
debt with a date, not upside. Mixing the two sells false urgency.

**4. "Ready" is not "free".**
Every card that mentions ready savings carries the split *no prerequisite* × *requires engineering
validation*. Presenting the total as drop-in authorizes a committee to approve work that nobody sized
— and the cost appears later as scope overrun.

**5. A missing layer is declared.**
Without review X, the card does not say "low risk": it says "not assessed". Absence of evidence is
not evidence of absence. This is the rule that commercial pressure most often tries to break.

---

## 4. Persona catalog

Five personas, grounded in what the pipeline **can prove**. `question` is what decides which metrics
are primary — and, most importantly, which ones **are not**.

| # | Persona | Question | Focus |
|---|---|---|---|
| 1 | CFO | How much is this worth and when does it enter the budget? | Money: OPEX, ESR, cost of delay |
| 2 | CIO | Is the capacity we purchased aligned with actual usage? | IT efficiency, governance debt, deadlines |
| 3 | Cloud Architect | What do I execute, and what can break? | Technical prerequisite, limits, capacity, telemetry |
| 4 | Procurement | Am I buying discounts on top of waste? | Active commitments, price baseline, prior cleanup |
| 5 | Application Owner | Will this break my application? | Own scope and required validation |

**Order = from money to execution**, which is the sequence in which a decision flows down in an organization.

### Why Sustainability was left out

It would be the obvious sixth persona, and it is the only one the pipeline cannot substantiate: it would
require energy/carbon data that is not measured. A card without numbers would have **the appearance
of analysis without being analysis** — exactly the failure mode the rest of the product treats as a
"lie that looks like fact".

> **Adoption rule:** only add a persona when there is an assessed fact to support it. Persona is a
> consequence of the available data, never of the customer's org chart.

### Adapting the catalog to another domain

Keep the questions, change the metrics. Examples:

- **Resilience/DR:** CFO → cost of downtime; CIO → RTO/RPO coverage; Architect → failover gaps; App
  Owner → what changes in my SLA.
- **Security:** CFO → financial exposure; CISO → posture and compliance; Architect → concrete fixes;
  App Owner → compatibility impact.

---

## 5. Card structure

```jsonc
{
  "persona": "cfo",
  "title": "CFO",
  "question": "How much is this worth and when does it enter the budget?",
  "focus": "Money: OPEX, ESR, and the cost of delay.",
  "headline": "...",            // 1 sentence, AI-refinable
  "why_it_matters": "...",      // 2-3 sentences, AI-refinable
  "next_action": "...",         // action THIS person authorizes, AI-refinable
  "metrics": [                  // IMMUTABLE
    {
      "label": "Identified annual savings",
      "value": "BRL 3.232.994,76",   // already formatted, what the human reads
      "tip": "Recurring savings from already actionable changes...",
      "raw": 3232994.76              // original number, for audit
    }
  ],
  "caveats": ["..."]            // IMMUTABLE
}
```

**`tip` is mandatory.** A metric without an explanation becomes an orphan number on the customer's
table — and an orphan number is always read in the way most favorable to whoever is speaking.

**`raw` exists for audit.** It allows proving mechanically that the card did not invent anything.

---

## 6. AI layer (optional, always with a safety net)

The deterministic card **is already deliverable**. AI only rewrites three fields —
`headline`, `why_it_matters`, `next_action` — so they sound written *for* that person.

`metrics` and `caveats` are **immutable**. The model does not touch them.

### Prompt rules that proved necessary

1. **Reframe, never recalculate.** Use only figures that are already in the card itself.
2. **Write *to* the person, never *about* them.** No "For the CFO, ...". They already know who they
   are; third person makes the card sound like a report *about* them.
3. **Do not import a metric from another card.** A corporate total in the application owner card
   destroys the only reason the card exists.
4. **Never soften a blocker, deadline, or prerequisite.** A card that hides a verdict is worse than
   no card.
5. **Metrics from different scopes must be separate sentences** — never joined with "including".

### Mandatory guardrails (validation per card, not global)

A bad card **must not** bring down the whole narrative. Validate card by card and record which ones
were refined and which ones were rejected, so that one card falling back does not appear arbitrary.

| # | Guardrail | Question it asks |
|---|---|---|
| 1 | Persona exists | Is there a deterministic card behind it? |
| 2 | Non-empty response | — |
| 3 | **Anti-dilution** | Is it still worth reading? |
| 4 | Grounding | Does every number have backing in the facts? |
| 5 | Role of the number | Is what was called savings actually savings? |
| 6 | Entities | Do the referenced identifiers exist? |
| 7 | Claims | Was any capability invented? |
| 8 | **Decomposition** | Do the parts fit within the whole? |

The two in bold are the non-obvious ones, and **both were discovered by reading real output, not by a
synthetic test**. They deserve a section.

#### Guardrail 3 — Dilution is also a failure

All other guardrails ask *"is this true?"*. This one asks *"is this still worth reading?"*.

A model that replies *"blockers must be handled with priority"* where the deterministic text named
the retained value and the largest blocker passes **all** honesty validations — nothing is false,
nothing was invented — and is still strictly worse: it is the corporate filler that the feature exists
to eliminate.

**Mechanical rule:** prose that cited numbers cannot come back without any.

#### Guardrail 8 — False decomposition

All previous guardrails look at each number **in isolation**. But a sentence can pass all of them and
still be false, because the falsehood may live in the **relationship** between two true numbers:

> "You have BRL 65.154,97/month in actionable savings, **including** BRL 187.556,66/month in changes
> with no architecture change and BRL 81.859,57/month requiring validation."

The three values exist in the card and are correctly labeled. But the first is the share of **one
environment** and the other two are **corporate** totals — the word "including" asserts that 269k fits
inside 65k. In a regulated context, this is a material error.

**Mechanical rule:** when a decomposition marker ("including", "of which", "of those") connects
monetary values, the parts cannot exceed the whole (1% tolerance for rounding).

**Be conservative in three points**, because rejecting unnecessarily discards the whole narrative:

1. Only values with an **explicit currency** count — "5 environments, including 3 production" is a
   count, not money arithmetic.
2. The parts clause **ends at the first contrast marker** ("in addition to", "while", "however").
   Without this limit, a value *listed alongside* the whole is read as part of it — which caused a
   real false positive that rejected an honest narrative.
3. Ambiguous tokens across locales (`1.234`) are read in the direction that **makes rejection harder**:
   largest possible whole, smallest possible parts.

### Circularity — the testing trap

If the facts sent to the model include the cards (and they should; otherwise, the model is silently
forbidden from citing the numbers in its own card), then grounding tests must **start by removing the
cards from the payload**. Otherwise they become tautology: the card validates the card.

### Token budget

The ceiling must grow with the number of cards. Without that, the model is asked to write N additional
blocks under a limit sized for none of them: the response truncates in the middle of the JSON, parsing
fails, and the run silently degrades — a failure that **looks** like "the model did not help" when in
reality it was underfunded.

---

## 7. Delivery

Three surfaces, same content:

| Surface | Format | Why |
|---|---|---|
| Payload | `stakeholder_cards` block in JSON | Source of truth; consumable by API/portal |
| Dashboard | Tabs, one per persona | For those who prefer to navigate |
| Markdown | One file per persona | **Forwardable on its own** — this is where the feature wins |

The per-persona file is what changes behavior in practice: you send **one** card to each stakeholder
instead of the full report.

### Rendering requirements

- **Zero external dependency** in the dashboard: no CDN, no fetch. The file must open offline, from an
  email attachment, on a customer's machine without internet access. Tabs with `radio` + `:checked`
  solve this without a single line of JS.
- **A `LEIA-ME` alongside the cards**, explaining that they are five slices of the same fact — without
  this, five files look like five divergent analyses.
- **Visible collection coverage.** If collection was partial, that appears in the package. Missing data
  is never treated as absence of risk.

---

## 8. Implementation plan

| # | Deliverable | Depends on |
|---|---|---|
| 1 | Persona catalog (id, title, question, focus) | — |
| 2 | Deterministic builders, one per persona | 1 |
| 3 | Scope rollup (for the own-scope card) | — |
| 4 | Tests: no new number, no contradiction, no universal metric | 2, 3 |
| 5 | Markdown rendering (one file per persona) | 2 |
| 6 | Dashboard rendering (tabs, zero external JS) | 2 |
| 7 | Projection of cards into facts sent to AI | 2 |
| 8 | AI refinement of 3 fields + guardrail battery per card | 7 |
| 9 | Guardrail tests (incl. dilution and decomposition) | 8 |
| 10 | Card reconstruction in old payloads (replay) | 2 |
| 11 | Customer-configurable titles | 1 |
| 12 | Documentation | all |

**Mandatory order:** deterministic and tested **before** AI. Reversed, you lose the only reference
capable of saying whether the model improved or worsened the text — and start evaluating prose by
taste.

### Configuration

Only **titles** are configurable by customer (`CFO` → `Finance Director`). Ids, questions, and
metrics are not: they are the structure that guarantees the cards do not diverge.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Card becomes a generic summary | A metric that appears in every persona indicates the catalog is wrong — automated test |
| AI dilutes the text | Guardrail 3 (anti-dilution) |
| Persona slice relaxes the risk floor | Inherited verdicts, never reassessed |
| Cards diverge from each other | Invariant "reframes, never recalculates" |
| Persona without data to support it | Do not create the persona (Sustainability case) |
| Commercial pressure for a more palatable card | "Never soften blocker" is a prompt rule **and** a guardrail |

---

## 10. Implementation reference

The paths below belong to the upstream **Azure SKU Advisor** project, not to this
repository. They are listed to show where the original implementation lives; the
equivalent code here is under `apps/finops-dashboard/src/lib/stakeholder/`.

| File (upstream) | Role |
|---|---|
| `src/azure_sku_advisor/stakeholder.py` | Catalog, builders, scope rollup, narrative application |
| `src/azure_sku_advisor/explain.py` | Fact projection, prompt, guardrails per card |
| `src/azure_sku_advisor/markdown_report.py` | One markdown file per persona |
| `src/azure_sku_advisor/report.py` | Tabs in the dashboard |
| `tests/test_stakeholder.py` | 42 tests |
| `docs/ai-narrative.md` | Guardrail details |

---

## Appendix — origin of the idea

The concept comes from the **Challenger Sale** methodology's *Tailor*, and specifically from the
**Solae** case: instead of depending on each seller to improvise the translation, the company created
material that connected each stakeholder's needs to the same central insight.

The adaptation to analytical reports has an advantage that sales does not have: here the facts are
**assessed by a deterministic pipeline**. It is not about adjusting the message to what the stakeholder
wants to hear — it is about answering the question they actually ask, with the same number everyone
else is seeing.

Personalizing **does not** mean agreeing. The CFO card does not promise that the savings are free; it
separates what is ready from what depends on engineering. That separation is what sustains the next
conversation.