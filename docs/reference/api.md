# API reference

Every dashboard feature is served by a Next.js route handler under
`apps/finops-dashboard/src/app/(dashboard)/api/`. The routes are a
backend-for-frontend: the browser never talks to Azure Data Explorer, Azure OpenAI
or the pricing service directly, so credentials stay server-side.

The table further down is **generated from the source**. Method, path and the role
required to call an endpoint are all derivable from the code, so they are derived
rather than transcribed — `npm run api:docs:check` fails the build when the
document drifts from the routes. The prose is written by hand.

## Conventions

All endpoints share the same shape.

**Response envelope.** Handlers return `ApiResponse<T>`:

```jsonc
{
  "data": { /* endpoint-specific payload */ },
  "metadata": {
    "queriedAt": "2026-01-01T00:00:00.000Z",
    "isMock": false
  }
}
```

`metadata.isMock` tells you whether the response came from Azure Data Explorer or
from the built-in mock dataset. It is worth surfacing in any client you build:
a dashboard full of plausible numbers that are actually mock data is a costly
misunderstanding.

**Filters.** Endpoints marked `Filters: yes` parse their query string with the
shared Zod schema in `src/lib/filter-schema.ts`, so they accept the same filter
parameters (subscription, resource group, service, date range, and so on). An
invalid value is rejected by the schema rather than silently ignored.

**Mock support.** The `Mock` column has three values:

| Value | Meaning |
| --- | --- |
| `yes` | The handler checks `isMockMode()` and falls back to the built-in dataset when Azure Data Explorer is not configured. |
| `always` | The handler returns `isMock: true` unconditionally and **never queries a real source**, whatever your configuration. |
| `—` | No mock path. |

`always` is worth taking literally. Those endpoints are placeholders whose real
query has not been implemented yet, so the view they feed will show sample figures
even in a fully configured production deployment. See [Data model](../architecture/data-model.md)
for how mock mode and customer POC mode interact.

**Caching.** Route handlers set `export const dynamic = "force-dynamic"`; responses
are not cached by Next.js.

## Authorization

Authorization is not declared per route. It is resolved centrally by
`requiredRoleForRequest(pathname, method)` in `src/lib/auth-policy.ts`, and the
rules are deliberately fail-closed:

| Rule | Result |
| --- | --- |
| Path is in `ANONYMOUS_PATHS` (`/api/health`) | No sign-in required |
| Path is in `ADMIN_ONLY_PATHS` (`/api/debug`) | `Admin`, even for `GET` |
| Method is `GET`, `HEAD` or `OPTIONS` | `Reader` |
| Method is anything else, and the path is in `READ_ONLY_WRITE_METHOD_PATHS` | `Reader` |
| Anything else | `Admin` |

The fourth rule exists because several read-only features have to be `POST`: LLM
calls and query bodies that do not fit in a query string. Those endpoints are
listed explicitly rather than being inferred, so **adding a new non-`GET` route
requires `Admin` by default**. Add a route to `READ_ONLY_WRITE_METHOD_PATHS` only
if it genuinely has no side effects.

> `ANONYMOUS_PATHS` must stay in sync with `excludedPaths` in
> `infra/bicep/finops-dashboard/modules/containerapp.bicep`. Easy Auth enforces the
> Bicep list at the edge and the middleware enforces the TypeScript list in the app;
> if they disagree, one of the two layers is wrong. See [AGENTS.md](../../AGENTS.md).

Roles are carried in the Easy Auth client principal header. See
[Security](../operations/security.md) for how they are assigned.

## Endpoints

### What each group serves

| Group | Purpose |
| --- | --- |
| `agentic-finops` | Azure Advisor recommendations staged as agentic remediation actions, graded by risk. Reads Azure Resource Graph rather than ADX. |
| `ai-costs` | Spend on AI workloads: by model, by resource, daily series, allocation, and AI-specific anomalies. |
| `ai-insights` | Generated insights, the FinOps radar, and the cost forecast, built on Advisor recommendations. |
| `anomalies` | Cost anomaly detection: summary, timeline, and the resources driving it. |
| `budgets` | Budget tracking: burn rate, forecast, budget vs. actual, and per-subscription breakdown. |
| `chargeback` | Allocation of cost to business units: KPIs, trend, and by-BU breakdown. |
| `chat` | The conversational assistant over the cost data. `POST`, but read-only. |
| `config` | Runtime connection settings. Reading the current config is `Reader`; testing and saving a connection are `Admin`. |
| `cost-summary` | The core spend views: KPIs, daily and over-time series, and breakdowns by service, subscription, provider, category, and pricing model. |
| `customer-narrative` | The generated narrative for a customer POC dataset. |
| `customers` | Customer workspace listing, and switching the active workspace (`Admin`). |
| `daily-insights` | Stored daily insight documents: fetch one by date, list history, or generate a new one (`Admin`). |
| `debug` | Diagnostic detail. `Admin` even for `GET`, because it exposes configuration state. |
| `executions` | The automation execution log and the savings realised from it. **Always mock** — see the note above. |
| `filters` | The option lists that populate the dashboard's filter controls, including tag values. |
| `governance` | Tag compliance and budget adherence KPIs. |
| `health` | Liveness probe. The only anonymous endpoint, and the only one in `ANONYMOUS_PATHS`. |
| `me` | The signed-in principal and its roles, parsed from the Easy Auth client principal header. |
| `multicloud` | Azure against other providers, plus the Markdown and narrative renderings of that comparison. |
| `pricing` | Retail price queries, reserved-instance comparison, and price sheet upload (`Admin`). |
| `rate-optimization` | Effective Savings Rate, commitment coverage and gap, idle resources, and the savings actions that follow. |
| `remediation` | Executing a remediation action. `Admin`, and the only endpoint here that changes anything outside the dashboard. |
| `remediation-impact` | The quantified impact of remediation actions. |
| `remediation-insight` | An LLM explanation of a remediation. `POST`, but read-only. |
| `remediation-summary` | The rollup across remediation actions. |
| `reservations` | Reservation options, per-reservation detail, and utilisation trend. |
| `simulator` | Cost estimate for a hypothetical change. `POST`, but read-only. |
| `sku-advisor` | Rightsizing and SKU recommendations, with capacity, levers, lifecycle, and headline KPIs. |
| `stakeholder-cards` | Persona cards, their Markdown export, and LLM refinement. |
| `workload` | Utilisation: CPU scatter, rightsizing candidates, and headline KPIs. |

### Route table

<!-- BEGIN GENERATED ROUTES -->

_81 endpoints across 30 groups. Generated by `npm run api:docs` — do not edit by hand._

### `/api/agentic-finops`

| Endpoint | Method | Role | Filters | Mock |
| --- | --- | --- | --- | --- |
| `/api/agentic-finops` | GET | Reader | — | yes |

### `/api/ai-costs`

| Endpoint | Method | Role | Filters | Mock |
| --- | --- | --- | --- | --- |
| `/api/ai-costs/allocation` | GET | Reader | yes | yes |
| `/api/ai-costs/anomalies/timeline` | GET | Reader | yes | yes |
| `/api/ai-costs/anomalies/top-resources` | GET | Reader | yes | yes |
| `/api/ai-costs/by-model` | GET | Reader | yes | yes |
| `/api/ai-costs/by-resource` | GET | Reader | yes | yes |
| `/api/ai-costs/daily` | GET | Reader | yes | yes |
| `/api/ai-costs/kpi` | GET | Reader | yes | yes |

### `/api/ai-insights`

| Endpoint | Method | Role | Filters | Mock |
| --- | --- | --- | --- | --- |
| `/api/ai-insights` | GET | Reader | yes | yes |

### `/api/anomalies`

| Endpoint | Method | Role | Filters | Mock |
| --- | --- | --- | --- | --- |
| `/api/anomalies/summary` | GET | Reader | yes | yes |
| `/api/anomalies/timeline` | GET | Reader | yes | yes |
| `/api/anomalies/top-resources` | GET | Reader | yes | yes |

### `/api/budgets`

| Endpoint | Method | Role | Filters | Mock |
| --- | --- | --- | --- | --- |
| `/api/budgets/burn-rate` | GET | Reader | yes | yes |
| `/api/budgets/by-subscription` | GET | Reader | yes | yes |
| `/api/budgets/forecast` | GET | Reader | yes | yes |
| `/api/budgets/vs-actual` | GET | Reader | yes | yes |

### `/api/chargeback`

| Endpoint | Method | Role | Filters | Mock |
| --- | --- | --- | --- | --- |
| `/api/chargeback/by-bu` | GET | Reader | yes | yes |
| `/api/chargeback/kpi` | GET | Reader | yes | yes |
| `/api/chargeback/trend` | GET | Reader | yes | yes |

### `/api/chat`

| Endpoint | Method | Role | Filters | Mock |
| --- | --- | --- | --- | --- |
| `/api/chat` | POST | Reader | — | — |

### `/api/config`

| Endpoint | Method | Role | Filters | Mock |
| --- | --- | --- | --- | --- |
| `/api/config/connect` | POST | Admin | — | — |
| `/api/config/current` | GET | Reader | — | yes |
| `/api/config/save` | POST | Admin | — | — |

### `/api/cost-summary`

| Endpoint | Method | Role | Filters | Mock |
| --- | --- | --- | --- | --- |
| `/api/cost-summary/by-provider` | GET | Reader | yes | yes |
| `/api/cost-summary/by-service` | GET | Reader | yes | yes |
| `/api/cost-summary/by-subscription` | GET | Reader | yes | yes |
| `/api/cost-summary/daily` | GET | Reader | yes | yes |
| `/api/cost-summary/daily-by-category` | GET | Reader | yes | yes |
| `/api/cost-summary/kpi` | GET | Reader | yes | yes |
| `/api/cost-summary/mini-kpi` | GET | Reader | yes | yes |
| `/api/cost-summary/over-time` | GET | Reader | yes | yes |
| `/api/cost-summary/pricing-model` | GET | Reader | yes | yes |
| `/api/cost-summary/service-trend` | GET | Reader | yes | yes |
| `/api/cost-summary/summary-kpi` | GET | Reader | yes | yes |

### `/api/customer-narrative`

| Endpoint | Method | Role | Filters | Mock |
| --- | --- | --- | --- | --- |
| `/api/customer-narrative` | GET | Reader | — | yes |

### `/api/customers`

| Endpoint | Method | Role | Filters | Mock |
| --- | --- | --- | --- | --- |
| `/api/customers` | GET | Reader | — | — |
| `/api/customers/active` | POST | Admin | — | — |

### `/api/daily-insights`

| Endpoint | Method | Role | Filters | Mock |
| --- | --- | --- | --- | --- |
| `/api/daily-insights/{date}` | GET | Reader | — | yes |
| `/api/daily-insights/generate` | POST | Admin | — | — |
| `/api/daily-insights/history` | GET | Reader | — | yes |

### `/api/debug`

| Endpoint | Method | Role | Filters | Mock |
| --- | --- | --- | --- | --- |
| `/api/debug` | GET | Admin | — | — |

### `/api/executions`

| Endpoint | Method | Role | Filters | Mock |
| --- | --- | --- | --- | --- |
| `/api/executions` | GET | Reader | — | always |
| `/api/executions/savings` | GET | Reader | — | always |

### `/api/filters`

| Endpoint | Method | Role | Filters | Mock |
| --- | --- | --- | --- | --- |
| `/api/filters/options` | GET | Reader | — | yes |
| `/api/filters/tag-values` | GET | Reader | — | yes |

### `/api/governance`

| Endpoint | Method | Role | Filters | Mock |
| --- | --- | --- | --- | --- |
| `/api/governance/budget-vs-actual` | GET | Reader | yes | yes |
| `/api/governance/kpi` | GET | Reader | yes | yes |
| `/api/governance/tag-compliance` | GET | Reader | yes | yes |

### `/api/health`

| Endpoint | Method | Role | Filters | Mock |
| --- | --- | --- | --- | --- |
| `/api/health` | GET | Anonymous | — | yes |

### `/api/me`

| Endpoint | Method | Role | Filters | Mock |
| --- | --- | --- | --- | --- |
| `/api/me` | GET | Reader | — | — |

### `/api/multicloud`

| Endpoint | Method | Role | Filters | Mock |
| --- | --- | --- | --- | --- |
| `/api/multicloud/compare` | GET | Reader | yes | — |
| `/api/multicloud/markdown` | GET | Reader | yes | — |
| `/api/multicloud/narrative` | POST | Reader | yes | — |

### `/api/pricing`

| Endpoint | Method | Role | Filters | Mock |
| --- | --- | --- | --- | --- |
| `/api/pricing/query` | POST | Reader | — | — |
| `/api/pricing/ri-compare` | POST | Reader | — | — |
| `/api/pricing/upload` | POST | Admin | — | — |

### `/api/rate-optimization`

| Endpoint | Method | Role | Filters | Mock |
| --- | --- | --- | --- | --- |
| `/api/rate-optimization/actions` | GET | Reader | yes | yes |
| `/api/rate-optimization/commitment-gap` | GET | Reader | yes | yes |
| `/api/rate-optimization/esr-breakdown` | GET | Reader | yes | yes |
| `/api/rate-optimization/esr-summary` | GET | Reader | yes | yes |
| `/api/rate-optimization/idle` | GET | Reader | yes | yes |
| `/api/rate-optimization/savings` | GET | Reader | yes | yes |

### `/api/remediation`

| Endpoint | Method | Role | Filters | Mock |
| --- | --- | --- | --- | --- |
| `/api/remediation/execute` | GET | Reader | — | yes |
| `/api/remediation/execute` | POST | Admin | — | yes |

### `/api/remediation-impact`

| Endpoint | Method | Role | Filters | Mock |
| --- | --- | --- | --- | --- |
| `/api/remediation-impact` | GET | Reader | — | yes |

### `/api/remediation-insight`

| Endpoint | Method | Role | Filters | Mock |
| --- | --- | --- | --- | --- |
| `/api/remediation-insight` | POST | Reader | — | yes |

### `/api/remediation-summary`

| Endpoint | Method | Role | Filters | Mock |
| --- | --- | --- | --- | --- |
| `/api/remediation-summary` | GET | Reader | — | yes |

### `/api/reservations`

| Endpoint | Method | Role | Filters | Mock |
| --- | --- | --- | --- | --- |
| `/api/reservations/detail` | GET | Reader | yes | yes |
| `/api/reservations/options` | GET | Reader | yes | yes |
| `/api/reservations/trend` | GET | Reader | yes | yes |

### `/api/simulator`

| Endpoint | Method | Role | Filters | Mock |
| --- | --- | --- | --- | --- |
| `/api/simulator/estimate` | POST | Reader | — | yes |

### `/api/sku-advisor`

| Endpoint | Method | Role | Filters | Mock |
| --- | --- | --- | --- | --- |
| `/api/sku-advisor/capacity` | GET | Reader | — | — |
| `/api/sku-advisor/kpi` | GET | Reader | — | — |
| `/api/sku-advisor/levers` | GET | Reader | — | — |
| `/api/sku-advisor/lifecycle` | GET | Reader | — | — |
| `/api/sku-advisor/recommendations` | GET | Reader | — | — |

### `/api/stakeholder-cards`

| Endpoint | Method | Role | Filters | Mock |
| --- | --- | --- | --- | --- |
| `/api/stakeholder-cards` | GET | Reader | yes | — |
| `/api/stakeholder-cards/markdown` | GET | Reader | yes | — |
| `/api/stakeholder-cards/refine` | POST | Reader | yes | — |

### `/api/workload`

| Endpoint | Method | Role | Filters | Mock |
| --- | --- | --- | --- | --- |
| `/api/workload/cpu-scatter` | GET | Reader | yes | yes |
| `/api/workload/kpi` | GET | Reader | yes | yes |
| `/api/workload/rightsizing` | GET | Reader | yes | yes |
<!-- END GENERATED ROUTES -->

## Regenerating this table

```bash
cd apps/finops-dashboard
npm run api:docs         # rewrite the table
npm run api:docs:check   # fail if it is stale (this is what CI runs)
```
