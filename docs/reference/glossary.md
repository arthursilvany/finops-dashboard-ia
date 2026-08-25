# Glossary

This glossary defines FinOps terminology **as this dashboard uses it**. Where a term has an established
meaning from the [FinOps Foundation](https://www.finops.org/framework/), this project uses that meaning
unless otherwise noted. Definitions are grounded in the actual queries, types, and UI of the dashboard;
where the implementation detail was not verified from source code, that is stated explicitly.

---

## Amortised Cost vs Actual Cost

**Actual cost** records the full up-front or monthly charge for a commitment (Reserved Instance or
Savings Plan) in the period it was paid. **Amortised cost** spreads that charge evenly across the
coverage period.

In this dashboard, the ESR query (`effectiveSavingsRateSummary` in
`src/lib/queries/rate-optimization.ts`) excludes rows where
`ChargeCategory == "Purchase" AND CommitmentDiscountCategory IS NOT EMPTY` (the up-front principal
payment) and sums `EffectiveCost` instead. `EffectiveCost` in the FOCUS-aligned `Costs()` function
represents the amortised effective price — on-demand cost minus the benefit of any applied commitment.

---

## Anomaly

A cost data point that deviates significantly from the expected baseline for that resource or service.

The dashboard's Anomalies page (`/anomalies`) surfaces anomalies via three API routes
(`/api/anomalies/timeline`, `/api/anomalies/summary`, `/api/anomalies/top-resources`). Each
`AnomalyPoint` carries `actualCost`, `baseline`, `anomalyFlag` (0 or 1), and `anomalyScore`. The
detection logic lives in `src/lib/queries/anomalies.ts`. How the baseline is computed (statistical
model, moving average, or ADX's native anomaly detection) was not verified from the query source for
this glossary entry.

---

## Blended Rate

A unit price calculated by mixing on-demand and committed spend, producing an average cost per unit.
Blended rates obscure whether a resource is covered by a commitment or paying list price.

This dashboard uses `EffectiveCost` (amortised, post-discount) rather than a blended rate. The
`PricingCategory` column (`Standard` = on-demand, `Committed` = commitment-covered) lets queries
separate the two populations without blending. See [Commitment Coverage](#commitment-coverage) and
[ESR](#esr-effective-savings-rate).

---

## Budget

A monthly spend target set for a subscription or cost centre. The Budgets page (`/budgets`) tracks
burn rate, actual vs budget, and a forward forecast.

The `BudgetBurnRate` type (`src/lib/types.ts`) tracks: `spentSoFar`, `dailyBurnRate`,
`projectedMonthEnd`, `budget`, `budgetVariance`, `budgetUsedPercent`, and `status`
(`ON_TRACK | AT_RISK | EXCEEDED | NO_BUDGET`). `NO_BUDGET` is set by the customer POC tier when
no budget data is present in the Cost Export.

---

## Chargeback

The practice of allocating cloud costs to the business unit, team, or project that incurred them,
typically for internal billing or P&L accountability.

The dashboard's Chargeback page (`/chargeback`) reads the `cost-center` resource tag from
`todynamic(Tags)['cost-center']` (see `chargebackByBuKql` in `src/lib/queries/chargeback.ts`).
Costs with a non-empty `cost-center` tag are considered **allocated**; costs without it are
**untagged**. The chargeback KPI (`chargebackKpiKql`) reports `TotalAllocated`, `UntaggedCost`, and
`BusinessUnits` (distinct count of cost-centre values).

---

## Commitment Coverage

The percentage of total usage cost that is covered by committed-rate pricing (Reserved Instances or
Savings Plans) rather than on-demand pricing.

Computed as:

```
CommitmentCoverage = CommittedCost / TotalUsageCost × 100
```

where `CommittedCost = sumif(EffectiveCost, PricingCategory == "Committed")` and
`TotalUsageCost = sum(EffectiveCost)` filtered to `ChargeCategory == "Usage"` — see `commitmentGap`
in `src/lib/queries/rate-optimization.ts`.

Also surfaced as `CommitmentCoverage` in `miniKpiQuery` (`src/lib/queries/cost-summary.ts`), shown
as a KPI gauge on the Cost Summary page (`/cost-summary`).

---

## Commitment Gap

The on-demand spend on a service that is **not** covered by a commitment, and is therefore a candidate
for purchasing a Reserved Instance or Savings Plan.

In the Rate Optimization page (`/rate-optimization`), `commitmentGap` (`rate-optimization.ts`)
groups by `ServiceName` and returns `OnDemandCost`, `CommittedCost`, `CommitmentCoverage`, and
`PotentialSavings`. `PotentialSavings` is modelled as `OnDemandCost × 0.30` — a flat 30 % assumed
discount. This is an estimate, not a measured figure; the actual saving depends on the specific SKU,
term, and commitment type. The `CommitmentGapItem` type in `src/lib/types.ts` documents this as:
_"MODELED, not measured: on-demand spend times a flat 30 % assumed commitment discount."_

---

## ESR (Effective Savings Rate)

The percentage of list (on-demand) cost that the organisation is saving through all discount
mechanisms combined (commitments, negotiated rates, credits).

**Formula used by this dashboard** (from `effectiveSavingsRateSummary` in
`src/lib/queries/rate-optimization.ts`):

```
ESR = (ListCost − EffectiveCost) / ListCost × 100
```

Principal payments (`ChargeCategory == "Purchase" AND CommitmentDiscountCategory IS NOT EMPTY`) are
excluded from both numerator and denominator so the metric is not distorted by up-front commitment
purchases. The Rate Optimization page (`/rate-optimization`) shows ESR as a gauge and provides a
month-by-month breakdown via `effectiveSavingsRateBreakdown`.

The `EffectiveSavingsRateSummary` type (`src/lib/types.ts`) also surfaces `unusedCommitmentCost` —
commitment spend that covered nothing — as a separate signal, because it has no baseline and is
excluded from the rate.

---

## FOCUS

The **FinOps Open Cost and Usage Specification** — a vendor-neutral schema for cloud billing data,
maintained by the FinOps Foundation.

This dashboard reads data from the `Costs()` function in the ADX `Hub` database, which wraps the
`CostsPlus` table — a FOCUS-aligned enriched view from the FinOps Toolkit. Column names used
throughout the queries (`ChargePeriodStart`, `EffectiveCost`, `BilledCost`, `ListCost`,
`PricingCategory`, `ChargeCategory`, `CommitmentDiscountStatus`, `CommitmentDiscountId`, etc.)
follow FOCUS naming conventions. Contract pricing is available via the `Prices_v1_2()` function
(EA/MCA PriceSheet, FOCUS v1.2).

---

## Idle Resources

Resources that are running and generating cost but producing negligible workload, indicating they
can be deallocated or deleted.

In this dashboard (`idleResources` in `src/lib/queries/rate-optimization.ts`), a resource is
classified as idle when:

- `TotalCost > 0` (it is accruing cost), and
- `AvgDailyCost < 1.0` (average daily effective cost is below $1), and
- `DaysActive >= 25` (it has been active for most of the month, so it is not a short-lived job).

The threshold is intentionally conservative; a resource just below $1/day may still be worth
investigating. The Rate Optimization page (`/rate-optimization`) lists idle resources in a table
with `MonthlyCost`, `AvgDailyCost`, and `DaysActive`.

---

## On-Demand / Pay-As-You-Go

The default, uncommitted pricing tier where resources are billed at the full list (retail) rate per
unit of consumption with no upfront commitment.

In the FOCUS schema used by this dashboard, on-demand rows have `PricingCategory == "Standard"`.
The `commitmentGap` query (`rate-optimization.ts`) separates `OnDemandCost` (Standard) from
`CommittedCost` to measure coverage and identify gap savings opportunities.

---

## Reserved Instance (RI)

A one- or three-year commitment to a specific resource configuration (VM family, region, OS) in
exchange for a discounted rate vs on-demand pricing.

In the FOCUS schema, reservation rows have a non-empty `CommitmentDiscountId` and
`CommitmentDiscountType` (e.g. `Reservation`). The Reservation Detail page
(`/reservation-detail`) uses `reservationDetail` and `reservationTrend`
(`src/lib/queries/reservations.ts`) to show per-commitment utilisation:

```
Utilization = Used / (Used + Unused) × 100
```

where `Used = sumif(EffectiveCost, CommitmentDiscountStatus == "Used")` and
`Unused = sumif(EffectiveCost, CommitmentDiscountStatus == "Unused")`.

---

## Rightsizing

The process of matching a resource's provisioned size (CPU, memory, storage tier) to its actual
workload requirements, reducing waste from over-provisioned resources.

The dashboard's Workload page (`/workload`) surfaces rightsizing recommendations from the
`Recommendations_final_v1_2` table in the ADX `Ingestion` database (queried via
`workloadRightsizingKql` in `src/lib/queries/workload.ts`). Each recommendation includes
`CurrentSku`, `RecommendedSku`, `CurrentCost`, `ProjectedCost`, and `MonthlySavings`
(`x_EffectiveCostSavings × 30`). The Agentic FinOps page (`/agentic-finops`) also presents
rightsizing as one of five savings categories alongside idle resources, reservations, SKU
optimisation, and orphaned resources.

---

## Savings Plan

A flexible commitment to a consistent amount of compute spend (in $/hour) for one or three years,
applicable across VM families and regions, in exchange for a discount vs on-demand pricing.

In this dashboard, Savings Plans are represented alongside Reserved Instances through the same
`CommitmentDiscountId` / `CommitmentDiscountStatus` columns. The `CommitmentDiscountType` column
distinguishes them (e.g. `SavingsPlan` vs `Reservation`). The `reservationFilterOptions` query
exposes `CommitmentTypes` as a filter on the Reservation Detail page.

---

## Showback

Providing teams with visibility into their cloud spend without charging them — cost transparency
without internal billing. The Chargeback page can be used in showback mode by simply sharing the
cost-centre breakdown without triggering internal invoices.

This dashboard does not model showback vs chargeback as separate concepts at the data layer; both
use the same tag-based cost allocation queries. The distinction is a business process decision.

---

## Spot (Spot Instances / Spot VMs)

Unused cloud capacity available at deeply discounted prices, but subject to eviction when the
provider needs the capacity back. Appropriate for fault-tolerant, interruptible workloads.

The dashboard does not have a dedicated Spot page. Spot usage would appear in the `Costs()` data
with its own `PricingCategory` value; the implementation detail of how (or whether) the current
queries filter or highlight Spot rows was not verified from the query source for this glossary entry.

---

## Unit Economics

The practice of relating cloud cost to a business-meaningful unit of output (e.g. cost per active
user, cost per API call, cost per transaction) rather than tracking absolute spend alone.

The dashboard's AI Insights page (`/ai-insights`) surfaces unit-economics-style KPI cards (savings,
remediation costs, net impact with currency conversion). The AI Costs page (`/ai-costs`) provides
cost-per-model breakdown which supports unit economics analysis for AI workloads. A formal
unit-economics computation layer is not currently implemented in the query library; the concept is
used in the UI framing.

---

## Unused Commitment

Reserved Instance or Savings Plan capacity that was purchased but not consumed in a given period.
Unused commitment is pure waste: it generates cost without producing any workload benefit.

Tracked in `EffectiveSavingsRateSummary.unusedCommitmentCost` (`src/lib/types.ts`) and
`EffectiveSavingsRateBreakdownItem.unusedCommitmentCost`. In the ADX data path, this value may be
`null` when the data source does not report it separately. The Reservation Detail page surfaces
per-commitment `Unused` cost (in currency units) and `Utilization` percentage.

---

## See Also

- [Architecture Blueprint](../architecture/blueprint.md) — data model, FOCUS schema columns, and
  API route inventory.
- [Rate Optimization queries](../../apps/finops-dashboard/src/lib/queries/rate-optimization.ts) —
  ESR, commitment gap, and idle resource KQL.
- [Reservations queries](../../apps/finops-dashboard/src/lib/queries/reservations.ts) —
  reservation utilisation KQL.
- [Configuration Reference](../reference/configuration.md) — environment variables that control
  data source and mock mode.
- [ADR-0001: BFF Pattern](../adr/0001-bff-api-routes.md) — why queries run server-side.
- [ADR-0005: Simulator Pricing Fallback](../adr/0005-simulator-pricing-fallback.md) — how the
  Cost Simulator handles missing price data.
