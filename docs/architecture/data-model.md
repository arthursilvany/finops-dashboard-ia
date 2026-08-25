# Data model

The dashboard is a read-only consumer of an external analytics backend. It never writes to ADX, never
modifies the FinOps Hub schema, and never creates tables or functions.

---

## Overview

Cost data flows from the Azure billing pipeline into a **FinOps Hub** deployment, which normalises
raw cost exports into the [FOCUS](https://focus.finops.org) schema and loads them into an **Azure
Data Explorer (ADX)** cluster. The dashboard connects to that ADX cluster, issues KQL queries, and
renders results. Microsoft Fabric RTI is equally supported because it exposes the same KQL surface —
see the [architecture overview](overview.md) for the full list of supported backends.

```
Azure Billing  →  FinOps Hub ingest  →  ADX / Fabric KQL database
                                                    ▲
                                                    │ KQL (read-only)
                                          finops-dashboard (this app)
```

The dashboard does not expose raw KQL to users. All queries are assembled server-side from the
TypeScript modules described below, parameterised by the active filter state, and executed via
`src/lib/adx-client.ts`.

---

## The `Costs()` function

Every cost query in the dashboard calls `Costs()` — a **KQL stored function**, not a raw table.
FinOps Hub creates this function during its own deployment to wrap its internal ingestion tables
with FOCUS-normalised columns. Pointing the dashboard at a database that does not define `Costs()`
will cause every cost-related query to fail.

The default database the client looks for is **`Hub`** (the `ADX_DATABASE` environment variable,
falling back to the literal string `"Hub"` — see [configuration](../reference/configuration.md)).
The workload rightsizing queries use a second database called **`Ingestion`** (hard-coded, not
configurable at runtime).

> **Note on the env variable name.** The application reads `ADX_DATABASE`
> (`adx-client.ts`), falling back to `Hub`. Earlier revisions of the configuration
> reference documented this as `ADX_DATABASE_NAME`, which the application never
> read — setting that name silently left the database on its default. The
> reference is now correct; if you have an existing deployment, check which name
> your Container App actually sets.

### Columns referenced by the dashboard

The table below lists every column the KQL modules read from `Costs()`. It is derived from
inspecting each query module. **Do not add columns to your FinOps Hub based on this list alone** —
all of these should be present in a standard FinOps Hub deployment that follows FOCUS 1.0.

"Optional (guarded)" means the column is accessed through KQL's `column_ifexists()` built-in.
The query will return a default value rather than fail if the column is absent, but the dashboard
feature that depends on it will show zeros or empty results.

| Column | KQL type | Required / Optional | Description |
|--------|----------|---------------------|-------------|
| `ChargePeriodStart` | `datetime` | Required | Start of the charge period. Used for all date-range filters and time-series aggregations. |
| `ChargePeriodEnd` | `datetime` | Required | End of the charge period. Used in multicloud comparison queries. |
| `EffectiveCost` | `real` | Required | Post-discount cost in the billing currency. The default cost column when no currency override is active. |
| `x_EffectiveCostInUsd` | `real` | Required | Effective cost converted to USD. Selected when the user switches the currency toggle to `usd`. |
| `ListCost` | `real` | Required | Undiscounted on-demand list price in the billing currency. Used to compute the Effective Savings Rate (ESR). |
| `ServiceName` | `string` | Required | Azure service name (e.g., `"Virtual Machines"`, `"Azure OpenAI"`). Used for cost-by-service breakdowns and filter options. |
| `SubAccountName` | `string` | Required | Subscription name. Used for per-subscription breakdowns and the `subscriptions` filter. |
| `ResourceId` | `string` | Required | Full Azure resource ID. Used to count distinct resources in KPI queries. |
| `ResourceName` | `string` | Required | Human-readable resource name. Used in anomaly drill-down and idle-resource queries. |
| `ProviderName` | `string` | Required | Cloud provider as reported in the FOCUS export (e.g., `"Microsoft"`, `"AWS"`, `"Amazon"`). **Not** normalised to `"Azure"` — the filter-builder expands the UI value `"Azure"` to `["Microsoft", "Azure", "Microsoft Azure"]` before sending it to ADX. |
| `RegionName` | `string` | Required | Azure region name. Used for the `regions` filter. |
| `x_ResourceGroupName` | `string` | Required | Resource group name. Used for the `resourceGroups` filter and in AI costs / rate-optimization queries. |
| `Tags` | `dynamic` (JSON bag) | Required | Resource tags as a JSON object (e.g., `{"cost-center":"eng","env":"prod"}`). Parsed with `todynamic()` for chargeback and governance queries. |
| `BillingCurrency` | `string` | Required | Billing currency code (e.g., `"BRL"`, `"USD"`). Listed in the multicloud currency report. |
| `ChargeCategory` | `string` | Required in most modules; optional (guarded) in `cost-summary.ts` | Charge category per FOCUS spec: `"Usage"`, `"Purchase"`, `"Tax"`, etc. Most modules filter hard on `ChargeCategory == "Usage"`. In `cost-summary.ts` the column is accessed via `column_ifexists('ChargeCategory', column_ifexists('ChargeType', 'Usage'))`, accepting `ChargeType` as a fallback spelling from older Hub versions. |
| `PricingCategory` | `string` | Required in `rate-optimization.ts`; optional (guarded) in `cost-summary.ts` | Pricing model per FOCUS spec: `"Standard"` (on-demand), `"Committed"`, `"Dynamic"`. In `cost-summary.ts` the fallback chain is `column_ifexists('PricingCategory', column_ifexists('PricingModel', 'Other'))`, accepting the older `PricingModel` name. |
| `ServiceCategory` | `string` | Required in `ai-costs.ts` and `cost-summary.ts`; optional (guarded) in `multicloud.ts` | FOCUS service category (e.g., `"AI and Machine Learning"`, `"Compute"`, `"Databases"`, `"Storage"`, `"Networking"`). The AI costs module filters exclusively on `ServiceCategory == "AI and Machine Learning"`. In `multicloud.ts` it is wrapped in `column_ifexists('ServiceCategory', '')` because not all Hub deployments populate it. |
| `ConsumedQuantity` | `real` | Required in `multicloud.ts` | Quantity of the resource consumed in the charge period. Used as the denominator in cross-provider rate comparisons. |
| `x_SkuMeterCategory` | `string` | Required in `multicloud.ts` | SKU meter category from the billing export (e.g., `"Virtual Machines"`, `"Storage"`). |
| `x_SkuMeterSubcategory` | `string` | Optional (guarded) | SKU meter subcategory. Accessed via `column_ifexists('x_SkuMeterSubcategory', '')` in `multicloud.ts`. |
| `PricingUnit` | `string` | Required in `multicloud.ts` | Pricing unit for the charge (e.g., `"1 Hour"`, `"1 GB"`). Used to determine the unit-to-month conversion factor in cost comparisons. |
| `x_SkuTerm` | `string` (interpreted as `int`) | Required in `reservations.ts` | SKU term in months: `0` = on-demand, `12` = 1-year, `36` = 3-year reservation. |
| `x_ResourceType` | `string` | Optional (guarded) | Azure resource provider type (e.g., `"microsoft.compute/virtualmachines"`). Used in reservation detail queries. Guarded as `column_ifexists('x_ResourceType', column_ifexists('ResourceType', ''))` in multicloud. |
| `CommitmentDiscountId` | `string` | Required in `reservations.ts` | Unique identifier of the reservation or savings plan. Rows with a non-empty value are commitment charges. |
| `CommitmentDiscountName` | `string` | Required in `reservations.ts` | Human-readable name of the commitment discount. |
| `CommitmentDiscountType` | `string` | Required in `reservations.ts` | Type of the commitment: `"Reservation"` or `"SavingsPlan"`. |
| `CommitmentDiscountStatus` | `string` | Required in `reservations.ts` | Whether the commitment covered actual usage: `"Used"` or `"Unused"`. |
| `CommitmentDiscountCategory` | `string` | Required in `rate-optimization.ts` | Used to distinguish amortised charges from purchase principal rows in ESR calculations. |
| `ContractedCost` | `real` | Optional (guarded) | Negotiated contract cost in billing currency. Used in multicloud comparison when available; defaults to `0.0` via `column_ifexists` when absent. |
| `x_ContractedCostInUsd` | `real` | Optional (guarded) | Contracted cost in USD. Same guard as `ContractedCost`. |
| `x_ListCostInUsd` | `real` | Optional (guarded) | List cost in USD. Same guard as `ContractedCost`. |

---

## Other tables and functions

### `Prices_v1_2()` — stored function

Used exclusively by `src/lib/queries/simulator.ts` to power the Cost Simulator. This is a separate
KQL stored function from `Costs()` and holds the price catalogue rather than actual charges.

| Column | KQL type | Description |
|--------|----------|-------------|
| `ListUnitPrice` | `real` | Published retail unit price. |
| `ContractedUnitPrice` | `real` | Negotiated contract unit price. Selected when the simulator's `priceSource` is set to `"contract"`. |
| `x_SkuDescription` | `string` | Free-text SKU description, matched with `contains` when the user types a SKU name. |
| `x_SkuRegion` | `string` | Region for the price entry. Matched with `tolower(...) contains`. |
| `x_SkuMeterCategory` | `string` | Meter category, used to narrow results by service type (e.g., VM, Storage). |
| `x_SkuMeterSubcategory` | `string` | Meter subcategory, used alongside `x_SkuMeterCategory`. |
| `x_SkuPriceType` | `string` | Price type (e.g., `"consumption"`). Used to identify on-demand entries. |
| `x_SkuTerm` | `int` | Term in months: `0` = on-demand, `12` = 1-year, `36` = 3-year. |
| `PricingUnit` | `string` | Unit of measure for the price (e.g., `"1 Hour"`). Drives the unit-to-month factor (`1 Hour` → × 730). |
| `BillingCurrency` | `string` | Currency of the price entry. |

The simulator queries the database named `Hub` (same as cost queries) unless overridden at runtime.

### `Recommendations_final_v1_2` — table

Used by `src/lib/queries/workload.ts` for rightsizing recommendations. This table is queried
against the **`Ingestion`** database (not `Hub`), which is hard-coded in `finops-radar.ts`:

```typescript
executeQuery(workloadKpiKql(), "Ingestion")
```

| Column | KQL type | Description |
|--------|----------|-------------|
| `x_RecommendationDetails` | `dynamic` (JSON) | Nested JSON with fields including `CommitmentDiscountNormalizedGroup` (resource group name), `CommitmentDiscountNormalizedSize` (current SKU), `SkuSize` (recommended SKU), `RegionName`. |
| `x_EffectiveCostSavings` | `real` | Estimated daily cost savings if the recommendation is applied. Multiplied by 30 to produce a monthly figure. |
| `x_EffectiveCostBefore` | `real` | Daily effective cost before applying the recommendation. |
| `x_EffectiveCostAfter` | `real` | Daily effective cost after applying the recommendation. |
| `x_ResourceGroupName` | `string` | Resource group of the resource to be rightsized. |
| `SubAccountName` | `string` | Subscription name. |

> **Uncertainty.** The `Recommendations_final_v1_2` table name and schema are not part of the
> standard FinOps Hub specification. They appear to be populated by a custom ingest pipeline
> outside FinOps Hub. If you are setting up your own deployment, this table must be created
> separately — the workload rightsizing views will return empty results until it exists.

### `FinOpsExecutionLog` — table

Used by `src/lib/queries/executions.ts` to record the history of automated remediation actions
executed by the Agentic FinOps engine (E1). Queried from the same `Hub` database.

| Column | KQL type | Description |
|--------|----------|-------------|
| `executionId` | `string` | Unique identifier for the execution run. |
| `resourceId` | `string` | Azure resource ID of the target. |
| `resourceName` | `string` | Resource display name. |
| `action` | `string` | The action performed (e.g., `"stop_vm"`, `"resize_vm"`). |
| `beforeCost` | `real` | Daily cost before the action. |
| `afterCost` | `real` | Actual daily cost after the action. |
| `estimatedAfterCost` | `real` | Estimated daily cost before the action was run. |
| `actualAfterCost` | `real` | Measured daily cost post-execution (same as `afterCost`). |
| `status` | `string` | `"success"`, `"failed"`, or `"rolled_back"`. |
| `executedBy` | `string` | Principal that triggered the execution. |
| `timestamp` | `datetime` | When the action ran. |
| `recommendationId` | `string` | ID of the Advisor recommendation that prompted this action. |
| `rollbackStatus` | `string` | `"none"`, `"pending"`, `"completed"`, or `"failed"`. |

> **Uncertainty.** This table is written by the application's own execution engine, not by FinOps
> Hub. A fresh FinOps Hub deployment will not contain it. If the table does not exist the execution
> history views return empty results; they do not error.

---

## The KQL layer

### `filter-builder.ts`

`src/lib/queries/filter-builder.ts` is the single place that translates the UI filter state
(subscription list, date range, service list, etc.) into KQL `| where` clauses. Every query module
imports and calls `buildFilterClauses(filters)`.

**What `buildFilterClauses` produces:**

| Filter field | KQL clause emitted |
|---|---|
| `dateFrom` | `\| where ChargePeriodStart >= datetime('...')` |
| `dateTo` | `\| where ChargePeriodStart <= datetime('...T23:59:59')` |
| `providers` | `\| where ProviderName in~ (...)` — the UI value `"Azure"` expands to `["Microsoft", "Azure", "Microsoft Azure"]`, `"AWS"` expands to `["AWS", "Amazon", "Amazon Web Services"]`, etc. |
| `subscriptions` | `\| where SubAccountName in (...)` |
| `regions` | `\| where RegionName in (...)` |
| `services` | `\| where ServiceName in (...)` |
| `resourceGroups` | `\| where x_ResourceGroupName in (...)` |
| `tags` | `\| where tostring(todynamic(Tags)['<key>']) in (...)` — one clause per tag key |

All user-supplied string values pass through `safeValue()`, which trims whitespace, rejects values
containing characters outside `[a-zA-Z0-9 _.\-:/,@()]`, and escapes single-quotes and
backslashes. This is the injection-prevention boundary.

`costColumn(filters.currency)` returns either `"EffectiveCost"` (billing currency, the default) or
`"x_EffectiveCostInUsd"` (USD mode). Every query module calls this helper to select the cost
column rather than hard-coding it.

When there are no active filters, `buildFilterClauses` returns an empty string and the query
operates on the full dataset.

### Query module conventions

Each of the 17 query modules follows the same pattern:

1. Imports `buildFilterClauses` and `costColumn` from `filter-builder.ts`.
2. Exports one or more functions that accept an optional `ParsedFilters` parameter and return a
   **KQL string** (never an executed result).
3. The calling route handler passes the KQL string to `executeQuery()` in `adx-client.ts`.
4. `executeQuery` decides whether to use the `/v1/rest/query` or `/v1/rest/mgmt` endpoint based on
   whether the query starts with a `.`.

This means the modules are pure functions and can be unit-tested without a live ADX connection.

---

## Query module map

| Module | Dashboard area / views served |
|--------|-------------------------------|
| `cost-summary.ts` | Home — KPI cards, cost over time, cost by service, cost by subscription, cost by provider, daily trend, pricing model breakdown, daily cost by category, service trend |
| `anomalies.ts` | Anomalies — timeline with `series_decompose_anomalies`, anomaly summary KPIs, top anomalous resources on a given day |
| `budgets.ts` | Budgets — burn rate, budget vs actual, cost by subscription, 30-day forecast with confidence bands using `series_decompose_forecast` |
| `chargeback.ts` | Chargeback — allocation KPIs, cost by business unit (via `cost-center` tag), monthly trend by business unit |
| `governance.ts` | Governance — tag compliance KPIs and per-subscription breakdown for `env`, `owner`, and `cost-center` tags; budget vs actual by subscription |
| `rate-optimization.ts` | Rate Optimization — on-demand vs committed cost gap, savings opportunity summary, top optimization actions, idle resource list, Effective Savings Rate (ESR) summary and monthly breakdown |
| `reservations.ts` | Reservations — per-reservation used / unused / utilisation detail, monthly trend, filter option lists |
| `ai-costs.ts` | AI Cost Observability — total AI spend KPIs, cost by AI resource, daily AI cost trend, AI anomaly timeline, AI cost allocation by tag |
| `ai-insights.ts` | AI Insights — 6-month cost history plus 60-day forecast using `series_decompose_forecast` (does not use `buildFilterClauses`; uses bare `Costs()` call) |
| `advisor.ts` | FinOps Radar / AI Insights — pure TypeScript; does not generate KQL. Computes WAF-pillar scores and consolidated recommendations from Azure Resource Graph Advisor data |
| `finops-radar.ts` | FinOps Radar — orchestrates parallel ADX queries from governance, chargeback, rate-optimization, budgets, and workload modules to produce a single radar chart dataset |
| `multicloud.ts` | Multicloud Compare — raw FOCUS-dimension aggregation for cross-provider analysis; provider span query; billing currencies query |
| `workload.ts` | Workload Optimization — rightsizing table, CPU cost scatter, workload KPIs (reads `Recommendations_final_v1_2` in the `Ingestion` database) |
| `simulator.ts` | Cost Simulator — price lookup against `Prices_v1_2()`, on-demand / 1-year / 3-year comparison |
| `executions.ts` | Execution Engine — execution log and savings accuracy report from `FinOpsExecutionLog` |
| `remediation-impact.ts` | Remediation Impact — pure TypeScript; does not generate KQL. Orchestrates Azure Resource Graph, Retail Pricing API, MCP pricing server, and Azure OpenAI to produce remediation cards |
| `filter-builder.ts` | Shared utility — not a view; imported by every other module |

---

## Mock mode

`isMockMode()` in `src/lib/adx-client.ts` returns `true` when neither `ADX_CLUSTER_URI` nor a
runtime-configured cluster URI is present:

```typescript
export function isMockMode(): boolean {
  if (runtimeClusterUri || process.env.ADX_CLUSTER_URI) return false;
  return true;
}
```

When mock mode is active, API routes skip the ADX call entirely and return data from
`src/lib/mock-data/`. Each file in that directory mirrors one query module and exports TypeScript
constants shaped identically to what a live ADX query would return. This is the default first-run
experience: the dashboard starts, looks functional, and clearly labels every panel as mock data via
the `isMock: true` flag in the `ApiResponse<T>` metadata wrapper.

Mock data is intentionally sized to look like a real mid-market Azure estate
(~$4M/month, 12 subscriptions, 1 847 resources) so that UI layouts and chart proportions are
representative.

**Customer POC mode** is a separate layer. When a customer FOCUS Cost Export has been ingested with
`npm run ingest:customer -- "<Customer>"`, the API routes serve the processed customer dataset
instead of either mock data or ADX. The `dataSource` metadata field becomes `"customer"` and a
customer name badge appears in the UI. Neither the mock files nor ADX is consulted when customer
data is active. See [customer-poc.md](../guides/customer-poc.md) for the full ingestion and
workspace isolation details.

---

## Pointing at your own FinOps Hub

### Minimum requirements

| Requirement | Details |
|---|---|
| ADX cluster or Fabric RTI workspace | Any tier. The dashboard sends standard KQL via the REST API. |
| `Costs()` stored function | Must exist in the target database. Created automatically by FinOps Hub during its deployment pipeline. |
| Database Viewer role | The Managed Identity (or Service Principal) attached to the Container App needs at least `Database Viewer` on the target ADX database. |
| `Hub` database (default) | The client looks for a database named `Hub`. Override with the `ADX_DATABASE` environment variable. |

### Optional tables

| Table / function | Required for |
|---|---|
| `Prices_v1_2()` | Cost Simulator price lookups. Without it, simulator queries fail. |
| `Recommendations_final_v1_2` (in `Ingestion` database) | Workload rightsizing views. Without it, those views return empty. |
| `FinOpsExecutionLog` (in `Hub` database) | Execution Engine history. Without it, that view returns empty. |

### Environment variables

The three ADX-specific variables are all you need to connect:

- `ANALYTICS_BACKEND=ADX`
- `ADX_CLUSTER_URI` — full cluster URI, e.g. `https://mycluster.eastus.kusto.windows.net`
- `ADX_DATABASE` — database name, default `Hub`

Optionally, `ADX_QUERY_TIMEOUT_SECONDS` caps how long a single query may run (default `30`,
maximum `3600`). It is enforced client-side and as the Kusto `servertimeout`, so an abandoned
query is actually cancelled on the cluster rather than left running and billing.

Authentication is covered separately in [configuration.md](../reference/configuration.md).
Set `AUTH_MODE=ManagedIdentity` and grant the UAMI the **Database Viewer** role on your ADX
database; no secrets are needed.

For a step-by-step deployment including RBAC assignments see
[deployment.md](../operations/deployment.md).
