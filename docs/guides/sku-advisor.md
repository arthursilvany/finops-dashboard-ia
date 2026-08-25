# SKU Advisor

The `/sku-advisor` view brings the [Azure SKU Advisor](https://github.com/arthursilvany/Azure-SKU-Advisor)
analysis into the dashboard: VM rightsizing candidates, the savings levers around
them, SKU lifecycle exposure, and the quota or capacity blockers that stand
between a recommendation and an actual saving.

## Why it exists

The advisor produces a defensible rightsizing plan — priced from the Azure Retail
Prices API, checked against quota, capacity and SKU retirement dates — but until
now it only surfaced as a CLI run, a JSON file and a standalone HTML report. This
view puts it next to the rest of the FinOps story, in the portal stakeholders
already open.

The dashboard does not reimplement any of the advisor's logic. Every figure on
the page is one the advisor computed; the view selects and labels, it never
re-derives. That is deliberate: the page must never disagree with the advisor's
own report.

## Where the numbers come from

Three sources, in strict precedence order. The one that answered is named on
screen, in the badge next to the page title.

| Order | Source | When it applies |
|---|---|---|
| 1 | `service` | `SKU_ADVISOR_API_URL` is set and the service answers. |
| 2 | `customer` | An advisor export exists in the active customer workspace. |
| 3 | `mock` | Neither of the above — the bundled synthetic sample. |

A configured-but-unreachable service falls through to the next source and the
badge downgrades with it. A failed live call is never labelled as live.

All five panels share a single advisor run (a short in-process memo keyed by
the request parameters). That is not only a performance concern: resolving each
panel separately would let one run answer some panels and time out on others,
leaving live figures beside sample figures under a single badge. Only the
`service` tier is memoized — caching a workspace export would ignore which
customer is active and could serve the previous customer's estate after a
workspace switch.

### "Live service" is not the same as "your estate"

The advisor decides *what it analyzes* separately from *whether it answers*.
With `live_usage` off it builds recommendations from its own bundled sample
inventory and prices them for real, so the savings are real arithmetic over a
fictional estate. Labelling that "live" would be the exact failure this page's
provenance discipline exists to prevent, so the badge reports the inventory
too, and `metadata.skuAdvisorInventory` carries it:

| `skuAdvisorInventory` | Meaning |
|---|---|
| `live` | Resource Graph discovered the customer's real VMs. |
| `offline` | The advisor's bundled sample inventory, priced live. |

Set `SKU_ADVISOR_LIVE_USAGE=true` on the dashboard **and** `SKU_ADVISOR_ALLOW_LIVE=true`
on the advisor to get `live`. If the dashboard asks and the advisor refuses
(HTTP 403), the call is retried without the flag: a stricter advisor degrades
the meaning of the answer rather than taking the view down.

### Workspace export

Run the advisor CLI, then drop its `recommendations.json` into the active
customer workspace at either:

```
output/customer/<slug>/sku-advisor.json          # normalized copy (wins)
input/customer/<slug>/sku-advisor/recommendations.json
```

A corrupt or schema-incompatible file is logged and skipped rather than served,
so a bad export degrades to the sample instead of taking the page down. A
payload that parses but carries none of the expected summary figures — what a
wholesale advisor-side rename would produce — is also rejected, because
rendering it would mean showing a confident "$0 monthly savings" instead of
falling back.

## Configuration

| Variable | Purpose |
|---|---|
| `SKU_ADVISOR_API_URL` | Base URL of the advisor's FastAPI service. Unset disables the live source. |
| `SKU_ADVISOR_API_KEY` | Sent as `x-api-key`. Required when the service sets its own `SKU_ADVISOR_API_KEY`. |
| `SKU_ADVISOR_LIVE_USAGE` | Ask the advisor to analyze the real VM inventory instead of its sample. Server-side only, never from request input. |
| `SKU_ADVISOR_REGIONS` | Comma-separated regions the estate runs in, e.g. `uksouth,swedencentral`. Forwarded as the `region` filter when the caller supplies none. |
| `SKU_ADVISOR_LIVE_TELEMETRY` | Ask the advisor for a live 90-day P99 CPU/memory/IOPS busy-signal (see below) instead of spec-parity sizing alone. Server-side only. Requires `SKU_ADVISOR_ALLOW_LIVE=true` on the advisor and Reader/Monitoring Reader for its identity, or the whole live request (inventory included) is refused and the view retries with every live flag off. |

### Always declare the estate's regions

Live discovery is filtered by region. When neither the caller nor
`SKU_ADVISOR_REGIONS` names one, the advisor falls back to its own
`settings.regions` — a **pricing** scope that defaults to `eastus`. An estate
outside that list comes back as `workloads_evaluated: 0` with HTTP 200, no
error and no warning, which is indistinguishable from a customer who genuinely
runs no VMs. This was observed against a real subscription whose VMs sit in
`uksouth` and `swedencentral`: the same query returned 0 workloads without the
filter and 2 with it.

An explicit `?region=` on the request still wins, so a user narrowing the view
is never widened back to the deployment default.

Locally:

```bash
cd ../Azure-SKU-Advisor
pip install -e ".[api,live]"
uvicorn azure_sku_advisor.api.app:app --reload --port 8081
```

```bash
# apps/finops-dashboard/.env.local
SKU_ADVISOR_API_URL=http://localhost:8081
```

## Deployment

The advisor runs as an **internal-only Container App**, the same pattern as the
pricing MCP server: only the dashboard, from inside the Container Apps
Environment, can reach it. Deploy it by setting `deploySkuAdvisor` to `true` and
pushing the advisor image to the deployment's ACR as `azure-sku-advisor:latest`.

`main.bicep` then wires the internal URL into the dashboard as
`SKU_ADVISOR_API_URL`. The shared key goes to Key Vault as `sku-advisor-api-key`
and reaches both apps as a versionless Key Vault reference, so rotating it is a
vault operation rather than a redeployment. Setting `skuAdvisorAllowLiveReads`
also turns on the dashboard's `SKU_ADVISOR_LIVE_USAGE`, so the opt-in that
permits live reads is the same one that makes the view analyze the real estate.
Pair it with `skuAdvisorRegions`, or the analysis silently covers nothing.

## Collecting 90 days of CPU, memory and IOPS

Turning on live reads makes the advisor source utilization from Azure Monitor
**platform metrics** — `Percentage CPU`, `Available Memory Bytes`, and the
VM-level disk metrics. These are emitted by the host, so no guest agent is
required, and memory is derived rather than measured: the busy-signal is
`(1 - P1(Available Memory Bytes) / total_memory) * 100`, with total memory taken
from the SKU capabilities map.

The alternative path (`SKU_ADVISOR_TELEMETRY_SOURCE=loganalytics`) reads guest
`Perf` counters instead. It needs the Azure Monitor Agent and a DCR collecting
those counters on every VM, its bundled KQL carries a placeholder `VmInventory`
join that must be adapted per estate, and the default 30-day workspace retention
puts a 90-day window behind paid extended retention. Prefer platform metrics
unless the estate already has guest counters.

Three properties of the Metrics API shape how this runs:

- **A single call is clamped to ~31 days.** Asking for a longer window does not
  fail — the API echoes back a truncated `timespan` and returns only the most
  recent slice, at whatever interval was requested. A 90-day lookback is
  therefore issued as three consecutive windows and merged.
- **Only a subset of names is valid at VM scope.** `Disk Read Bytes/sec` exists
  for disks but not for `Microsoft.Compute/virtualMachines`; the VM-level
  spellings are `Disk Read Bytes`/`Disk Write Bytes`, whose hourly `Maximum` is
  bytes *per minute*. One invalid name fails the whole request, taking the valid
  metrics with it.
- **Coverage is sparse by design.** VMs are sampled per workload group and
  reduced to the group `Maximum`, never a median, so one idle VM cannot mask a
  saturated neighbour. VMs with fewer than 24 hourly points are skipped as too
  new or too intermittent to trust, and any sampled group blocks decisions that
  would *relax* a floor.

### Run the collection out of band

Do not drive this through the view. A 90-day sweep is three calls per VM per
metric group across the estate, which will exceed the 120-second timeout in
`sku-advisor-client.ts` long before it finishes, and the result changes daily at
best.

Run it on a schedule instead — a Container App Job is the natural fit — and have
it write a `recommendations.json` into the customer workspace. The dashboard
already prefers that file over the service (see *Where the numbers come from*),
so the view serves a pre-computed estate analysis instantly and the `service`
tier is left for the offline work it answers quickly: catalog, pricing, quota
and capacity.

The job's identity needs **Monitoring Reader** on every target subscription
(plus **Log Analytics Reader** and a workspace id if using the `Perf` path).
Without it, metric calls fail per VM; the advisor now counts those failures and
warns, because absent utilization must never be read as zero utilization.

### The `SKU_ADVISOR_LIVE_TELEMETRY` toggle exists for small estates only

Setting `SKU_ADVISOR_LIVE_TELEMETRY=true` on the dashboard makes the BFF ask
for `live_telemetry` inline, on every page load — the same 90-day, chunked,
per-VM sweep described above, just triggered synchronously instead of by a
scheduled job. On a lab with a handful of VMs this comfortably fits inside the
120-second timeout (a 2-VM lab measured well under 20 seconds end to end); on a
real estate with hundreds of VMs it will not, and the view will silently fall
back to sample data as soon as the request times out. Use the toggle for a lab
or a small proof of concept; for a customer-sized estate, run the collection
out of band as described above and let the dashboard read the resulting
`recommendations.json` from the customer workspace instead.

## Security

The advisor can do two expensive things that this integration keeps switched off
by default:

- **Live Azure reads.** `live_usage`, `live_quota`, `live_capacity`,
  `live_advisor` and friends drive the advisor's Managed Identity into Resource
  Graph, Log Analytics, quota and Advisor. Gated by `SKU_ADVISOR_ALLOW_LIVE`
  (Bicep: `skuAdvisorAllowLiveReads`).
- **The AI narrative.** A billable Azure OpenAI call that egresses the
  customer's estate facts. Gated by `SKU_ADVISOR_ALLOW_AI`
  (Bicep: `skuAdvisorAllowAiNarrative`).

Independently of those server-side gates, the dashboard's BFF forwards a fixed
allowlist of query parameters — `region`, `currency`, `threshold`,
`subscription`, `cross_arch`, `cross_family`, `hybrid_benefit`, `os_type` — and
adds three flags of its own that need no identity: `live_pricing` (public Retail
Prices API) and `quota`/`capacity`, which run off a bundled catalog. Without the
latter two the advisor omits the capacity block entirely and the view cannot
tell "no blockers" from "never checked". A crafted query string cannot ask for
anything else; `live_usage` is settable only from the server environment.

All five API routes are `GET`, so the `Reader` role is enough and no change to
`ANONYMOUS_PATHS` is involved.

## API routes

| Route | Returns |
|---|---|
| `GET /api/sku-advisor/kpi` | Headline savings, ESR, workloads evaluated, pricing basis. |
| `GET /api/sku-advisor/recommendations` | Rightsizing candidates, ordered by monthly saving. |
| `GET /api/sku-advisor/levers` | Per-lever savings: disks, idle, commitment, spot, schedule. |
| `GET /api/sku-advisor/lifecycle` | Retiring and previous-generation SKU exposure. |
| `GET /api/sku-advisor/capacity` | Capacity and quota blockers, with the savings they put at risk. |

Each response carries `metadata.skuAdvisorSource` and `metadata.generatedAt`.

## A note on the levers

A lever can compute a saving and then defer it to another track so the same VM is
never counted twice — a stopped VM that is also a rightsizing candidate belongs
to exactly one of them. The levers table therefore shows both the computed figure
and the one actually counted in the headline total. They are supposed to differ.

## Two summary fields that look scalar but are not

`summary.esr_scope` is an **object** describing how the effective savings rate was
scoped (`estate_esr_pct`, `addressable_esr_pct`, `addressable_share_pct`,
`out_of_scope_workloads`, `gap_pp`, …), not a single percentage.

`summary.lifecycle_exposure` is an **array** with one entry per affected SKU
series — `{ retirement_date, series, status, vms, current_monthly, source,
live_confirmed }` — not a single amount. The view sums `current_monthly` across
the entries to get the headline exposure, and falls back to rebuilding the list
from each recommendation's `lifecycle` block when an older export omits it.

Both were confirmed against the running service; an older `output/recommendations.json`
on disk may show a different shape and is not the contract.

## Tests

```bash
npm run sku-advisor:test
```

Covers the payload contract (including tolerance for advisor-side schema
additions), the selectors, and the source-resolution precedence.
