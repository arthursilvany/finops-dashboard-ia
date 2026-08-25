# Customer POC mode — unified collector → dashboard and Narrative IA

A pre-sales workflow: show a prospect the FinOps dashboard and a grounded
Narrative IA assessment using the approved customer collector, without
installing anything in their environment or obtaining tenant access.

If they approve, only then do you deploy the full solution into their tenant
(see [deployment.md](../operations/deployment.md)).

---

## Executive summary

| | |
| --- | --- |
| **Customer effort** | Approve a read-only collection run and provide explicit `SubscriptionIds`. No agent, deployment, credentials, or tenant access. |
| **Your effort** | Run `input\collectAzureDashboardData.ps1`, validate the manifest and coverage, and open the dashboard. |
| **Data handling** | Raw and identifiable data stays local under `input\customer\`. Only allow-listed aggregated, sanitized facts are sent to Foundry; non-identifying CAF/WAF searches go to Microsoft Learn MCP. |
| **Coverage** | Cost, inventory, Advisor, policy, security, health, patch, operations, budgets, commitments, and bounded metrics are collected best-effort. Missing scope or permissions are reported, never inferred. |
| **Time to first insight** | Minutes, versus days for a full FinOps Hub deployment. |

---

## Architecture

The dashboard resolves its data in a strict precedence order:

```
ADX / FinOps Hub  >  collected customer snapshot  >  static sample data
   (production)           (this POC mode)             (demo)
```

```
input\customer\<slug>\          <- INPUT: raw collector output
  <export files>
  collection-manifest.json  <- coverage, freshness, permissions, warnings

output\customer\<slug>\         <- OUTPUT: what the dashboard reads
  rows.ndjson               <- normalized cost rows
  manifest.json             <- dataset coverage, period, row counts
  resource-graph.json       <- normalized local inventory evidence
  advisor.json              <- normalized local Advisor evidence
  narrative.json            <- persisted Narrative IA
  narrative-status.json     <- ready/failed generation status
```

- **Collection** (`input\collectAzureDashboardData.ps1`) gathers the supported
  snapshots in read-only mode and keeps everything under `input\customer\<slug>`.
- **Ingestion** (`scripts/ingest-customer.ts`) normalizes the collected export,
  detects FOCUS vs legacy, and writes NDJSON into `output\customer\<slug>`.
  Streaming matters: enterprise exports routinely reach hundreds of MB.
- **Runtime** (`src/lib/customer-dataset.ts`) loads the NDJSON once per process
  and caches it at module level.
- **Aggregators** (`src/lib/customer-aggregations/`) reimplement each KQL query
  in TypeScript, returning the exact same types the ADX path returns, so no
  route or component needed reworking. Every aggregator names the KQL function
  it mirrors.
- **Routes** call the customer dataset from inside their existing
  `isMockMode()` branch. **Production behaviour is unchanged**: whenever ADX is
  configured, it always wins.
- **Narrative IA** runs after successful ingestion. It aggregates and sanitizes
  the three snapshots, retrieves CAF/WAF grounding from Microsoft Learn MCP,
  sends only the allow-listed fact contract to Foundry, validates the response,
  and persists it locally.
- **Azure Pricing, Cost Simulator, and execution history** are not collection
  driven; they still depend on their own pricing, simulator, or app history
  inputs.

---

## Workspaces: one folder per customer

A POC laptop accumulates customers. Each one owns an isolated folder in each
tree, and input is kept separate from output:

```
input/customer/          collected evidence, expensive to reproduce
  contoso/               raw export + evidence for Contoso
  fabrikam/

output/customer/         derived data, safe to delete and rebuild
  registry.json          which customers exist, and which was ingested last
  contoso/               normalized dataset the dashboard reads
  fabrikam/
```

The slug (`contoso`) is derived from `-CustomerName` / the ingest argument:
lowercase, diacritics stripped, non-alphanumerics collapsed into dashes. The
collector and the ingest derive it the same way, so they always agree on the
folder.

**Why the split:** the two halves have different lifecycles. A dataset is
rebuilt whenever the normalization changes, while the collected evidence
requires Azure access, permissions, and time. Keeping them apart means
`rm -rf output/` is a routine operation instead of a data loss.

**Why this matters:** the ingest merges every export it finds under the folder
it is given. Before workspaces, collecting two customers into the same root
produced a single dataset carrying both customers' costs, under one name, with
no error. The ingest now refuses that case explicitly:

```
Found export files loose in input/customer while these customer folders also
exist: contoso, fabrikam.
Ingesting the root would merge different customers into a single dataset.
```

### Switching customers

The sidebar shows the active customer under the `POC:` badge, with a picker when
more than one has been ingested. The selection is a **cookie**, so it belongs to
that browser: two tabs can show two customers side by side, and no restart is
needed. Scripts and CI use `CUSTOMER_SLUG` instead.

### The legacy layout still works

An export sitting loose in `input/customer/` (the pre-workspace layout) is still
ingested and still readable, and appears in the picker as *root folder*. That
compatibility ends the moment per-customer folders exist, because at that point
the root is ambiguous.

---

## Step by step

### 1. Run the approved collector

Use PowerShell 7 and Azure CLI from `apps/finops-dashboard`:

```powershell
pwsh -File .\input\collectAzureDashboardData.ps1 `
  -SubscriptionIds "<sub-id-1>","<sub-id-2>" `
  -CustomerName "Contoso"
```

That writes to `input\customer\contoso\`. Pass `-OutputDirectory` to override the
folder explicitly.

Cloud Shell works too:

```powershell
pwsh -File .\input\collectAzureDashboardData.ps1 `
  -SubscriptionIds "<sub-id-1>","<sub-id-2>" `
  -CustomerName "Contoso"
```

The collector is read-only. It asks interactively before installing the Azure
Resource Graph extension; in `-NonInteractive`, it fails with install guidance
instead of prompting. Cost Details is attempted automatically per subscription
and month; when it is unavailable, use the manual FOCUS fallback for that
scope.

### 2. Review what was collected

The collector writes its output under `input\customer\<slug>\` and keeps raw
evidence local. It captures inventory, Advisor, policy, security, health, patch,
operations, bounded metrics, budgets, and commitments, plus a collection
manifest that records best-effort states, permissions, and skipped scopes.

### 3. Process it

From `apps/finops-dashboard`:

```bash
npm run ingest:customer -- "Contoso"
```

The name resolves to `input/customer/contoso/`, and the normalized dataset lands
in `output/customer/contoso/`. Both paths are printed as `Input:` and `Output:`
in the summary. Use `--dir <path>` to ingest an explicit folder instead of the
slug convention.

After ingestion, the same command generates Narrative IA automatically. It uses
Microsoft Learn MCP to ground actions in CAF/WAF and Foundry to structure the
assessment. Success persists the narrative next to the dataset, under
`output/customer/<slug>/`.

If grounding, sanitization, model generation, or response validation fails, the
normalized dataset remains available for diagnosis, but the command exits
non-zero and records failed narrative status. Do not open the demo until the
command completes successfully. Resource Graph and Advisor evidence are both
required for narrative generation.

Each action follows the Challenger sequence — insight (`evidence`), impact
(`businessImpact` plus `businessImpactDimension`), implication (`inactionImpact`),
recommendation (`recommendedChange`), and commitment. `nextAction` stays the
internal execution task; `commitment` is the decision, validation, or working
session asked of the customer, and `executiveCommitment` closes the narrative
with a single ask.

Two guardrails reject the response and trigger one retry before failing:
any figure in `businessImpact` that is not traceable to the sanitized fact
contract, and any commitment written in non-committal language. Narratives
persisted under schema `1.0.0` are no longer valid — re-run ingestion.

#### Warnings about short exports

An export that is too short does not fail, but the ingest says exactly which
panels will read zero, so you are never surprised in front of the customer:

```
  ! The export covers a single calendar month (2026-08). Month-over-month KPIs
    (last month, previous month, change %) will read 0 because there is no
    earlier month to compare against. Ask for 3 months.
  ! The export spans only 1 day(s). Anomaly detection needs a baseline of at
    least 14 days, and trend charts will show 1 point(s).
```

These are honest zeros, not bugs: month-over-month mirrors the ADX query, which
compares against the last **complete** calendar month. If you see these
warnings, ask the customer to re-run collection with the missing subscriptions
or a longer time window.

### 4. Open the dashboard

```bash
npm run dev
```

The sidebar shows `POC: Contoso` with the covered period, and every page carries
a banner stating whether it is showing real customer data or sample data. The
UI also shows coverage and freshness from the collection manifest so gaps are
visible before the demo. With more than one customer ingested, the badge turns
into a picker.

### 5. Clean up after the demo

Remove a single customer, leaving the others untouched:

```powershell
Remove-Item -Recurse -Force ..\..\input\customer\contoso
```

Or wipe everything:

```powershell
Remove-Item -Recurse -Force ..\..\input\customer\* -Exclude .gitkeep,README.md
```

---

## Coverage

### Real customer data (25 endpoints)

| Page | What it shows |
| --- | --- |
| **Cost Summary** | KPIs, month-over-month, cost by service / subscription / pricing model, daily and monthly trends, category split, service trend |
| **Rate Optimization** | Commitment gap, savings opportunity, top actions, idle resources, effective savings rate (summary and monthly breakdown) |
| **Governance** | Tag compliance KPI, per-subscription compliance, actual spend per subscription |
| **Chargeback** | Allocation KPI, cost per business unit, monthly trend per BU |
| **Anomalies** | Daily timeline with baseline, anomaly summary, top resources on an anomalous day |

### Real customer data with a documented gap (15 endpoints)

Every cost figure on these pages is the customer's own. Some individual fields
cannot exist in a Cost Export, so they are shown as zero or blank rather than
estimated — and the banner on each page states exactly which ones.

| Page | Real | Not derivable from an export |
| --- | --- | --- |
| **AI Costs** | AI service spend, daily trend, per-resource cost, allocation by tag, AI anomalies | Model breakdown is *inferred from meter names* (there is no model column); token counts and quota are not billed data |
| **Budgets** | Daily and cumulative actuals, spend per subscription, burn rate, run-rate projection | Budget targets, variance and percent-consumed — budgets live in Azure Cost Management. Status reports `NO_BUDGET` rather than a misleading "on track" |
| **Reservations** | Used vs unused commitment cost, utilization, monthly trend, filter values | Commitment term and upfront payment (absent from an amortized export); purchase *recommendations* need Azure Advisor |
| **AI Insights** | Rule-based insights plus persisted Narrative IA actions grounded in CAF/WAF | It is a snapshot assessment; it does not validate runtime configuration, telemetry, or remediation completion |

Insights are emitted only when the data supports them — an empty list is a valid,
honest result, and no insight carries a savings estimate that was not measured.

### Sample data (clearly labelled)

| Page | Why a Cost Export cannot feed it |
| --- | --- |
| Workload / rightsizing | Needs Azure Advisor recommendations and CPU telemetry |
| Cost Simulator, Azure Pricing | Needs the price sheet / retail price API; not collection-driven |
| Agentic FinOps execution | Needs live tenant integration; manual exports cannot execute or validate remediation |

The UI never presents these as the customer's own numbers.

---

## File formats

Azure writes Cost Exports in two shapes, and both are supported end to end;
AWS Data Exports (FOCUS 1.0) arrive as Snappy Parquet and read through the same
path:

| Export format | Compression Azure uses | Supported |
| --- | --- | --- |
| CSV | none | yes |
| CSV | gzip (`.csv.gz`) | yes |
| Parquet | **Snappy** | yes |

Snappy is Azure's codec for Parquet — gzip is not offered for Parquet, and
Parquet files that carry gzip/zstd/brotli column chunks from other tooling are
read too, because every codec is registered.

**You never declare the format.** The reader identifies each file by its magic
bytes (`PAR1` for Parquet, `1f 8b` for gzip), not by its extension, because
files get renamed and re-compressed in transit and Azure's own Parquet parts
are named `part_0_0001.parquet` while other tools emit `.snappy.parquet`. A
Parquet file someone saved as `.csv` still reads correctly.

Compression inside a Parquet file is recorded per column chunk in the file's own
metadata, so the codec is self-describing — there is nothing for the customer to
tell you and nothing to configure.

Parquet is read **row group by row group** rather than all at once. Parquet is
columnar, so loading a whole file materializes all of it in memory; walking the
row groups keeps the footprint bounded the same way the CSV stream does.

`scripts/test-customer-parquet.ts` asserts the guarantee that matters: the same
data ingested as CSV and as Parquet produces **byte-identical** `rows.ndjson`.

---

## Multicloud: AWS FOCUS exports

The dashboard is not Azure-only. **AWS Data Exports** configured with the FOCUS
1.0 schema are ingested by the same pipeline, into the same `rows.ndjson`, and
land alongside Azure rows in one dataset. Drop the export inside that customer's
folder — `input/customer/<slug>/`, a per-cloud or per-account subfolder is fine,
the customer's tree is walked recursively — and run
`npm run ingest:customer -- "<Customer>"` as usual.

A customer's Azure and AWS exports belong in the same folder: that is how one
customer ends up with one multicloud dataset. Two *different* customers must
never share a folder, or their spend merges into a single total.

Nothing is declared: FOCUS is FOCUS, so the format detector accepts the AWS file
on the strength of its columns, and the cloud is read from the FOCUS
`ProviderName` column. That column is free text — Azure writes `Microsoft`, AWS
writes `AWS` — so it is normalized to a `providerName` of `Azure` or `AWS` on
every row.

A blank provider is treated by where the blank comes from, because the two cases
mean opposite things:

| Case | Read as | Why |
| --- | --- | --- |
| No `ProviderName` column in the file | `Azure` | A legacy Cost Management export predates the column; it can only be Azure |
| Column present, value blank or unmapped vendor | `Other` | The export declined to say. Guessing Azure would annex an unknown vendor's spend into Azure totals and the Azure-only pages |

`Other` rows still count toward dataset totals, and the ingest warns with the
row count so a mislabelled export is caught before a meeting rather than after.

### The Provider filter

`providerName` is a first-class filter dimension, next to subscription, service
and region, and it applies on the ADX path too. The **Provider** control in the
filter bar **disappears when the dataset holds a single cloud**, so an
Azure-only POC looks exactly as it did before.

### Pages that are genuinely Azure-only

Two pages render real customer money from Azure-specific concepts that have no
AWS counterpart in this pipeline:

| Page | Why it cannot cover AWS |
| --- | --- |
| `reservation-detail` | Azure reservation / commitment evidence |
| `ai-insights` | Resource Graph + Advisor grounding |

On a multicloud dataset these pages show a banner saying so **and the routes
behind them pin the provider filter to Azure**, so the figures match the
caption. This matters more than it sounds: an AWS Savings Plan satisfies the
generic FOCUS commitment predicate (`ChargeCategory = Usage`,
`PricingCategory = Committed`) exactly as an Azure reservation does, so without
that pin the reservation page would sum both clouds while captioning the total
"Azure only" — on a real AWS-heavy customer dataset, 90% of that "Azure"
commitment spend would actually have been AWS.

`azure-pricing`, `cost-simulator`, `workload` and `agentic-finops` are **sample
only** — they show no customer rows at all, so they carry the stronger "sample
data" banner instead.

Every FOCUS-native page — cost summary, chargeback, governance, anomalies, rate
optimization, budgets, AI costs — sums both clouds, and the cost summary gains a
**Cost by Cloud Provider** breakdown whenever more than one provider is present.

### What AWS does not carry, and what is shown instead

| Field | On AWS | Displayed as |
| --- | --- | --- |
| `resourceGroupName` | does not exist — ARNs have no resource group | `N/A (AWS)` |
| `RegionName` | empty on tax rows, `Any` on global services | `Global` |
| `ResourceName` | usually null | derived from the ARN's last segment |
| Resource Graph / Advisor | no equivalent | evidence status `not-applicable` |

The resource group is left **empty**, not invented. AWS spend is grouped by
sub-account and tags instead — which is how AWS itself allocates cost.

Because Resource Graph and Advisor evidence is meaningless for AWS, an AWS-only
dataset records those collectors as `not-applicable` rather than `missing`, and
the ingest suppresses the "evidence was not provided" warnings that would
otherwise read as a collection failure.

### Export both clouds over the same period

Relative windows — "last 30 days", month to date, anomaly baselines — anchor to
the newest charge date in the **whole** dataset, not per cloud. If the AWS
export ends in May and the Azure export runs through July, every one of those
panels reads **0 for AWS**, which looks like "AWS costs nothing" rather than
"the AWS export ends before the window". The ingest detects this and warns:

```
AWS data ends on 2026-05-31, before the dataset's 30-day window
(2026-07-02 to 2026-07-31) which is anchored to the newest charge across all
clouds. Relative-window panels will read 0 for AWS.
```

Fix it at the source by requesting both exports over the same months. Also keep
**one customer per dataset** — mixing two customers' folders under
`input/customer/` merges their spend and anchors the windows to whichever
export happens to run latest.

### Tags come from a Parquet MAP

AWS emits `Tags` as a Parquet **MAP**, not a string — a group whose leaf columns
are the generic `key`/`value` pair. A reader that walks only leaf columns never
sees a column called `Tags` at all, and every tag is dropped in silence: tag
coverage then reads 0% on a dataset that is partly tagged, which is worse than
an error because it looks like a finding. The Parquet reader therefore selects
**top-level** schema children, so `Tags` (and `x_Discounts`, `SkuPriceDetails`)
arrive as nested objects. `scripts/test-customer-aws-ingest.ts` asserts the tag
count directly to keep it that way.

### Currency

FOCUS carries `BillingCurrency` per row, and AWS typically bills USD while an
Azure enrollment may bill BRL or EUR. Mixed currencies are **not** converted;
the manifest records every currency it saw and the ingest warns. Read
provider-level totals per currency rather than summing across them.

---

## Data contract

Only the FOCUS columns the KQL actually uses are kept (26 columns plus one
derived flag); everything else in the export is discarded at ingestion, which
minimizes the customer data held on disk.

Required: `ChargePeriodStart`, `EffectiveCost`. Everything else degrades
gracefully — a missing optional column disables the insights that depend on it
rather than failing the import.

### Prices, savings and what the export cannot tell you

Two questions look alike and are not:

| Question | Answer source |
| --- | --- |
| How much is the customer **already** saving? (ESR) | The export alone. No price sheet needed. |
| How much **could** they save by committing? | Not in the export, and not reliably in the Retail Prices API either. |

**Baseline cascade (already saving).** The savings rate compares each row's
effective cost against what it would have cost without a discount. That baseline
is resolved in order:

1. `ListCost`, when populated — the public list price.
2. `ContractedCost`, when `ListCost` is 0 — the negotiated price before the
   commitment discount.
3. Otherwise the row has **no baseline** and is excluded from both sides of the
   rate.

Step 2 matters more than it looks: Azure emits `ListCost` = 0 and
`ListUnitPrice` = 0 on *every* commitment-covered line, and puts the on-demand
equivalent in `ContractedCost`. Cross-checked against the Retail Prices API by
`meterId`, those `ContractedUnitPrice` values match the public on-demand price
exactly. So the price you would go looking for externally is already in the file.

Step 3 covers unused commitment charges: nothing ran, so "would have cost" is
undefined. Those rows are waste, reported on their own KPI (*Unused Commitment*)
and in the monthly ESR table, and never folded into the rate. Letting them into
the effective cost alone would push the rate negative.

> Datasets ingested before schema `1.1.0` do not carry these fields and are
> **refused at load** with a console error rather than rendered with the old,
> wrong baseline. Re-run `npm run ingest:customer`.

**The commitment gap is modeled, not measured.** *Commitment Gap (modeled)* on
Rate Optimization, the commitment entries in *Top Optimization Actions*, and the
commitment paragraph in AI Insights all come from on-demand spend × a flat 30%
assumed discount. A cost export contains no reservation prices, and the Retail
Prices API does not return reservation prices for many common SKUs, so this
figure cannot be confirmed from either source. It is labelled as modeled
everywhere it appears and deliberately carries no "savings estimate" headline.
Confirming it needs the customer's price sheet. Say so in the meeting — a
plausible wrong number costs more credibility than an honest gap.

### Legacy → FOCUS mapping

| Legacy export | FOCUS |
| --- | --- |
| `Date` | `ChargePeriodStart` |
| `CostInBillingCurrency` | `EffectiveCost` |
| `CostInUsd` | `x_EffectiveCostInUsd` |
| `SubscriptionName` | `SubAccountName` |
| `ResourceGroup` | `x_ResourceGroupName` |
| `ResourceLocation` | `RegionName` |
| `ChargeType` | `ChargeCategory` |
| `PricingModel` | `PricingCategory` (`OnDemand`→`Standard`, `Reservation`/`SavingsPlan`→`Committed`, `Spot`→`Dynamic`) |
| `ConsumedService` / `MeterCategory` | `ServiceName` |
| _(derived from service and meter names)_ | `ServiceCategory` |

### Tag matching

Chargeback, governance compliance and AI cost allocation all look up *logical*
tag keys (`cost-center`, `env`, `owner`, `ai-app`, `ai-model`). Real tenants
never agree on how to spell those, so lookups are **case- and
separator-insensitive** and follow a small synonym list:

| Logical key | Also matches |
| --- | --- |
| `cost-center` | `costcenter`, `cost_center`, `Cost Center`, `cost-centre`, `costcode`, `chargecode`, `billingcode`, `business-unit`, `bu`, `department` |
| `env` | `environment`, `envt`, `stage`, `tier` |
| `owner` | `ownedby`, `owner-email`, `contact`, `responsible` |

This is not cosmetic. A real customer export tagged with `costcenter` was
reported as **100% unallocated** while 84% of its spend was in fact tagged,
because the code hardcoded `cost-center`. In a commercial meeting that reads as
a finding about the customer's governance when it is actually a bug in the tool.
`scripts/test-customer-aggregations.ts` now guards every spelling, and the
sample generator rotates through them so the regression cannot come back.

The KQL used against a live FinOps Hub had the same defect — it read
`Tags['cost-center']` literally — so `src/lib/queries/governance.ts` now expands
each logical key into its separator and casing variants and matches with
`set_intersect` over `bag_keys`. Set operations are used deliberately instead of
`mv-apply`: `mv-apply` drops records whose tag bag is empty, which would remove
untagged rows from the denominator and *inflate* compliance.

### Tag compliance is reported per tag

Compliance demanding `env` **and** `owner` **and** `cost-center` at once is
all-or-nothing, so a single tag the customer never adopted takes every
subscription to zero. Measured on a real 225k-row export:

| Tag | Rows | Cost |
| --- | --- | --- |
| `env` | 75.9% | 75.1% |
| `cost-center` | 74.7% | 84.5% |
| `owner` | 0.8% | 0.7% |
| **all three** | **0.8%** | — |

Presented as "0% compliance" that reads as "you govern nothing", when in fact
84.5% of spend carries a cost center and one subscription is at 100%. So
`TagComplianceBar` and `GovernanceKpi` carry a `tagCoverage` breakdown (rows and
cost, per tag) alongside the strict all-tags figure, and the Governance page
charts the tags separately. The strict number is still shown — the point is to
name the gap, not to soften it.

### Month boundaries on a snapshot

Relative windows anchor to the latest charge date in the dataset, not the wall
clock (`datasetAnchor`). For monthly KPIs that needs one extra step: a Cost
Export usually ends exactly on a month boundary, so applying
`startofmonth(now())` literally treats a *finished* month as in-progress and
reports the month before it. `lastCompleteMonthStart()` restores the intent — if
the anchor is the last day of its month, that month is complete. Without it, an
export through 31 July headlined June's spend and June's trend.

Legacy exports have no `ServiceCategory` column, but the AI cost views filter on
it, so it is derived from the service and meter names. Legacy exports also
rarely carry a list price, so `ListCost` falls back to `EffectiveCost` — that
yields a 0% savings rate, which is honest, rather than an invented discount.

Full definitions: `src/lib/customer-data/contract.ts`.

---

## Known differences from the ADX path

Be upfront about these in a customer conversation:

1. **Relative time windows are anchored to the data, not the clock.** The KQL
   uses `ago(30d)` because the Hub is refreshed daily. An export is a historical
   snapshot, so "last 30 days" means the 30 days ending on the latest charge
   date in the file. Without this every panel would be empty a month after the
   export was taken.
2. **Anomaly detection is an approximation.** ADX runs
   `series_decompose_anomalies` inside the engine. The POC uses a centred 7-day
   moving average with a MAD-based robust z-score and the same 1.5 threshold.
   The chart looks the same; anomaly counts may differ slightly.
3. **Advisor findings reflect the supplied export.** Missing, filtered, or stale
   Advisor data is reported as an assessment limitation, not treated as proof
   that no recommendations exist.
4. **Budgets are zero** in Governance → budget vs actual because budgets are not
   included in these three exports.
5. **Reservation term and commitment name are real data when the export carries
   them.** FOCUS exports do include `x_SkuTerm` and `CommitmentDiscountName`, so
   the term shown ("1 Year", "3 Years") and the commitment name come straight
   from the customer's file; they only fall back to blank/`CommitmentDiscountId`
   on legacy exports that lack those columns. Upfront payment is still blank —
   an amortized export has no Purchase rows. Utilization, used and unused cost
   are real. For legacy exports the unused portion is recovered from the
   `UnusedReservation` / `UnusedSavingsPlan` charge types — without that mapping
   every commitment would falsely report 100% utilization.
6. **Reservation *recommendations* from Cost Management remain separate.**
   Advisor exports add Advisor evidence but do not replace the dedicated
   reservation-recommendation dataset or a contract price sheet.
7. **The AI model breakdown is inferred from meter names.** Billing happens at
   the meter level, so deployments whose meter does not name a model are grouped
   under a catch-all rather than guessed at.
8. **Month-over-month KPIs need two calendar months.** "Last month" means the
   last *complete* calendar month before the newest charge date, mirroring the
   KQL. A one-month export therefore reports 0 for last month and "N/A" for the
   change — correct, but it looks broken next to a non-zero current month, so
   the ingest warns you about it explicitly.
9. **The commitment gap is a 30% assumption, the ESR is measured.** See
   [Prices, savings and what the export cannot tell you](#prices-savings-and-what-the-export-cannot-tell-you).
   The savings rate and the unused-commitment waste are read from the file; the
   "you could save X by committing" figure is a model that needs a price sheet
   to confirm.
10. **All evidence is a snapshot.** The UI marks narrative evidence older than
    the oldest source-file modification time as a conservative proxy and marks
    it stale after seven days. It is not treated as the Azure capture time;
    source-file and generation timestamps remain visible;
    changes after export,
    resources outside the query scope, runtime health, policy effectiveness,
    and completed remediation are not observed. Re-export and re-ingest before
    relying on the narrative for a customer decision.

---

## AI features in POC mode

The assistant and the daily report were built against ADX, so in POC mode every
tool call used to fail with "ADX cluster URI is not configured" — the chat
answered nothing and asked the presenter to configure a cluster mid-demo. Both
paths now read the ingested dataset instead.

**Chat (`/api/chat`, `agent-engine.ts`).** When a dataset is loaded the agent
gets two extra tools and `execute_kql` is removed from its toolset:

| Tool | Returns |
| --- | --- |
| `get_customer_dataset_info` | Customer, period, row count, currency, anchor date, ingest warnings. |
| `get_customer_metric` | One of the metrics in `CUSTOMER_METRICS` — the *same* aggregator the matching dashboard panel calls. |

Routing through the aggregators rather than interpreting queries over the rows
is deliberate: every figure the agent quotes can be pointed at on screen, so it
cannot contradict the dashboard in front of the customer.

POC mode also swaps in a **compact standalone system prompt**
(`customerModeSystemPrompt()`) instead of appending to `FINOPS_SYSTEM_PROMPT`.
That prompt is ~5k tokens of KQL catalog which is unreachable here and actively
tempts the model to emit queries. Measured on a ~226k-row customer dataset:

| | Prompt tokens | Latency |
| --- | --- | --- |
| Appended to the ADX prompt | 5,729 | 52.9 s |
| Standalone POC prompt | 2,364 | 24.3 s |

The route budget is `maxDuration = 60`, so the original approach was one slow
model call away from timing out.

**Daily report (`/api/daily-insights/generate`).** Its five raw KQL sections are
replaced by `customerSectionResults()`, which returns the equivalent aggregator
output in the same `{columns, rows}` shape. Two guards matter:

- **Budget is returned as an explicit error, not a number.** A Cost Export
  contains no budget, and the prompt otherwise applied a hardcoded $10,000
  against a customer spending ~$44k/month. The report now states that budget
  tracking requires Azure Cost Management.
- **The report is dated by the snapshot period, not by today**, and the prompt
  forbids extrapolating to the current month.

Advisor and inventory evidence comes from their supplied Resource Graph and
Advisor snapshots. Anything outside those snapshots — including resource
telemetry and live configuration validation — is named as unavailable rather
than estimated.

### Narrative IA privacy boundary

Raw exports, normalized rows, identifiable values, and the generated narrative
are persisted locally. The outbound Foundry payload is a schema-validated,
allow-listed set of aggregate facts only. It excludes customer, resource,
subscription, and resource-group names; all IDs; tags; and recommendation IDs.
Microsoft Learn MCP receives CAF/WAF searches containing non-identifying
resource types and Advisor themes, never raw rows or identifiers. This is why
the correct claim is **raw and identifiable data remains local**, not “nothing
leaves the machine.”

---

## Configuration

| Variable | Purpose |
| --- | --- |
| `CUSTOMER_DATA_DIR` | Overrides the input root (raw exports). Defaults to `<repo>/input/customer`. |
| `CUSTOMER_OUTPUT_DIR` | Overrides the output root (processed datasets). Defaults to `<repo>/output/customer`, or `<CUSTOMER_DATA_DIR>/.output` when the input root is overridden, so a scratch folder stays self-contained. |
| `CUSTOMER_SLUG` | Forces which customer workspace is served, bypassing the browser cookie. Used by scripts, tests and CI. |
| `CUSTOMER_MAX_ROWS` | Ingestion row cap (default 3,000,000). Exceeding it truncates the dataset and emits a warning rather than exhausting memory. |
| `AZURE_OPENAI_*` | Foundry endpoint, deployment, tenant and API version used for Narrative IA; see [configuration.md](../reference/configuration.md). |

Setting `ADX_CLUSTER_URI`, or connecting a cluster at runtime, disables POC mode
entirely — ADX always takes precedence.

---

## Testing

Generate a synthetic export and run the aggregator checks (no real customer data
required):

```bash
npx tsx scripts/generate-sample-export.ts --format focus --out ../../input/customer/sample.csv
npm run ingest:customer -- "Sample Co"
npm run customer:test
```

Add `--parquet` to emit the same fixture as Parquet/Snappy instead:

```bash
npx tsx scripts/generate-sample-export.ts --format focus --parquet --out ../../input/customer/sample.parquet
```

`npm run customer:test` runs all suites (~195 checks) against whatever
dataset is currently loaded. Two of them are dataset-independent:
`test-customer-esr.ts` builds synthetic rows in the exact shape Azure emits for
reservation-covered lines, so a regression in the baseline cascade fails
deterministically instead of hiding behind whichever export is on disk; and
`test-customer-workspaces.ts` (also `npm run customer:workspaces-test`) ingests
two customers into a scratch root and asserts that neither dataset can reach the
other, including through the module cache, and that a customer's output never
lands inside its input folder.

Re-run the suite with `--format legacy` to exercise the legacy-export mapping
path, which is where most bugs hide — the sample generator deliberately emits
unused-commitment rows in both formats so utilization can never silently read
100%.

Use `CUSTOMER_DATA_DIR` to point the scripts at a scratch folder instead of
`input/customer` when you do not want to disturb a loaded dataset. The scratch
folder keeps its own output inside itself (`<scratch>/.output`), so removing the
folder removes the whole run.

### AWS ingestion checks

`scripts/test-customer-aws-ingest.ts` (also run by `npm run customer:aws-test`)
ingests a real AWS FOCUS export in isolation and asserts the row count, the
`AWS` provider, the tag count recovered from the Parquet MAP, the UTC charge
period, and the effective/list cost totals. Customer data never enters the
repository, so the script **skips itself** when the export is absent. Point it
at your own file with `AWS_FOCUS_FIXTURE=/path/to/export.parquet`.

---

## Security

- `input/customer/**` is git-ignored, with narrow exceptions for `.gitkeep` and
  `README.md`. Verify with `git check-ignore -v input/customer/<file>.csv`
  before any demo.
- A Cost Export contains real spend, resource IDs and tags. Treat it as
  customer-confidential: keep it local, do not attach it to issues or chats, and
  delete it after the demo.
- Ingestion keeps only the 23 columns the dashboard uses; everything else in the
  export is dropped.
