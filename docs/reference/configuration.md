# Configuration Reference

All configuration is passed to the container as **environment variables**. In the Bicep deployment, these are set via the `containerapp.bicep` module parameters. When deploying manually, set them via the Azure Portal or CLI.

---

## Core Variables (always present)

| Variable            | Description             | Example                                           |
| ------------------- | ----------------------- | ------------------------------------------------- |
| `NODE_ENV`          | Node.js environment     | `production`                                      |
| `ANALYTICS_BACKEND` | Which backend is active | `ADX` / `Fabric` / `Foundry` / `None`             |
| `AUTH_MODE`         | Authentication mode     | `ManagedIdentity` / `ServicePrincipal` / `ApiKey` |

---

## ADX Variables (`ANALYTICS_BACKEND=ADX`)

| Variable            | Description              | Example                                        |
| ------------------- | ------------------------ | ---------------------------------------------- |
| `ADX_CLUSTER_URI`   | Full ADX cluster URI     | `https://<CLUSTER>.<REGION>.kusto.windows.net` |
| `ADX_DATABASE`      | Database name            | `Hub`                                          |
| `ADX_QUERY_TIMEOUT_SECONDS` | Seconds a single query may run, applied both client-side and as the Kusto `servertimeout`. Defaults to `30`; clamped to one hour, the maximum Kusto accepts. A malformed value falls back to the default rather than failing every query. | `30` |

---

## Fabric RTI Variables (`ANALYTICS_BACKEND=Fabric`)

| Variable                   | Description                           | Example                                                 |
| -------------------------- | ------------------------------------- | ------------------------------------------------------- |
| `FABRIC_QUERY_URI`         | KQL query URI                         | `https://<CLUSTER>.<REGION>.kusto.fabric.microsoft.com` |
| `FABRIC_WORKSPACE_ID`      | Workspace GUID (if no query URI)      | `<GUID>`                                                |
| `FABRIC_KQL_DATABASE_NAME` | Database name (if using workspace ID) | `FinOpsDB`                                              |

---

## Azure AI Foundry Variables (`ANALYTICS_BACKEND=Foundry`)

| Variable                             | Description                                            | Example                                                           |
| ------------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------------- |
| `FOUNDRY_PROJECT_ENDPOINT`           | Full Foundry project endpoint                          | `https://<RESOURCE>.services.ai.azure.com/api/projects/<PROJECT>` |
| `FOUNDRY_INFERENCE_ENDPOINT`         | Inference endpoint (optional)                          | `https://<RESOURCE>.services.ai.azure.com`                        |
| `FOUNDRY_MODEL_DEPLOYMENT_NAME`      | Model deployment name                                  | `gpt-4o`                                                          |
| `FOUNDRY_API_VERSION`                | API version                                            | `2025-01-01-preview`                                              |
| `AZURE_AI_PROJECT_CONNECTION_STRING` | Connection string (ApiKey mode only, stored as secret) | —                                                                 |

---

## Authentication Variables

### Managed Identity (no secrets required)

When `AUTH_MODE=ManagedIdentity`, no additional variables are needed. The container app uses the attached User-Assigned Managed Identity automatically via the Azure SDK.

### Service Principal (`AUTH_MODE=ServicePrincipal`)

| Variable           | Description                       | Notes                                                      |
| ------------------ | --------------------------------- | ---------------------------------------------------------- |
| `SP_TENANT_ID`     | Azure AD tenant ID                | Non-sensitive, set as env var                              |
| `SP_CLIENT_ID`     | Service principal client (app) ID | Non-sensitive, set as env var                              |
| `SP_CLIENT_SECRET` | Client secret                     | **Stored as Container App secret**, never in env var value |

### API Key (`AUTH_MODE=ApiKey`)

| Variable  | Description         | Notes                                                      |
| --------- | ------------------- | ---------------------------------------------------------- |
| `API_KEY` | API key for backend | **Stored as Container App secret**, never in env var value |

> `AUTH_MODE` above controls how the app authenticates **to Azure data sources**. It is unrelated to how *users* authenticate to the dashboard — see below.

### Dashboard sign-in (users)

| Variable | Description | Notes |
| --- | --- | --- |
| `AUTH_ENABLED` | `true` when Easy Auth is protecting the ingress. The middleware only trusts `X-MS-CLIENT-PRINCIPAL` when this is `true`. | **Injected by Bicep** from `enableEasyAuth`. Never set by hand in a deployed environment. |
| `AUTH_DEFAULT_ROLE` | `none` (default) or `Reader` — access for a signed-in user with no app role assigned. | Set via the `authDefaultRole` deployment parameter. |

Locally (`npm run dev`) `AUTH_ENABLED` is unset: the header is ignored entirely and the app uses a synthetic `Local Dev` principal with the Admin role. See [security.md](../operations/security.md#dashboard-access-control-microsoft-entra-id).

---

## Azure AI Foundry / Azure OpenAI

Powers the chat assistant, the agentic FinOps engine, daily insights and the
Advisor remediation insights. Authentication is Entra ID via
`DefaultAzureCredential` — there is no API key to store. The identity needs the
**Cognitive Services OpenAI User** role on the Foundry resource.

| Variable                   | Required | Description                                                                 |
| -------------------------- | -------- | --------------------------------------------------------------------------- |
| `AZURE_OPENAI_ENDPOINT`    | Yes      | `https://<RESOURCE>.cognitiveservices.azure.com` (or `.openai.azure.com`), with or without the `/openai/v1` suffix |
| `AZURE_OPENAI_DEPLOYMENT`  | Yes      | Deployment name, for example `model-router` or `gpt-4o`. Defaults to `gpt-4o` |
| `AZURE_OPENAI_TENANT_ID`   | Sometimes| Tenant of the Foundry resource, when it differs from your default login      |
| `AZURE_OPENAI_API_VERSION` | No       | Defaults to `2025-04-01-preview`. Ignored on the `/openai/v1` surface        |
| `AZURE_OPENAI_RESOURCE_ID` | No       | Full resource ID, injected by Bicep                                         |

### Endpoint surfaces

Azure OpenAI exposes two incompatible HTTP surfaces, and the Foundry portal
shows the newer one. Both are accepted; the client picks the right dialect from
the value you configure:

| Endpoint ends with | Surface | How the deployment is addressed |
| ------------------ | ------- | ------------------------------- |
| _(nothing)_        | classic | `/openai/deployments/<name>/…?api-version=…` |
| `/openai/v1`       | v1      | OpenAI-compatible; the deployment goes in the `model` field, no `api-version` |

Paste whichever value the portal gives you. Detection is covered by
`npm run openai:test`.

Verify the connection end to end with:

```bash
npm run foundry:test
```

It checks authentication, a small JSON request and tool calling against the real
deployment, and prints which model the router selected.

### Customer POC Narrative IA

`input\collectAzureDashboardData.ps1` gathers the approved customer snapshot,
and `npm run ingest:customer -- "<Customer>"` automatically generates Narrative
IA from the collected output. Use PowerShell 7 plus Azure CLI locally or in
Cloud Shell, pass explicit `SubscriptionIds`, and expect read-only collection.
Cost Details is attempted automatically per subscription and month; if it is
unavailable, the manual FOCUS fallback applies for that scope.

The collector records coverage, freshness, permissions, and skipped scopes in a
collection manifest. The UI surfaces that manifest so partial evidence stays
obvious before a demo.

It uses the same `AZURE_OPENAI_*` Foundry configuration above and Microsoft
Learn MCP grounding; there is no customer-tenant credential or agent setting.

Only allow-listed aggregated and sanitized facts leave the machine for Foundry.
Customer/resource/subscription/resource-group names, IDs, tags, recommendation
IDs, raw exports, and normalized rows remain local. Microsoft Learn MCP receives
only non-identifying resource types and Advisor themes in CAF/WAF documentation
searches, never raw rows or identifiers. The narrative is also persisted
locally.

Generation is fail-closed: the processed dataset is retained for diagnosis, but
the command exits non-zero and records failure status if grounding, sanitization,
generation, or validation fails. Snapshot timestamps and coverage limitations
must be reviewed before a demo. The oldest local source-file modification time is
used as a conservative freshness proxy and is marked stale after seven days; it
is not presented as an authoritative Azure capture timestamp.

Azure Pricing, Cost Simulator, and execution history are not collection-driven;
they still depend on their own pricing, simulator, or app-history inputs.

### Customer POC data location and multicloud exports

| Variable | Purpose | Default |
| --- | --- | --- |
| `CUSTOMER_DATA_DIR` | Input root: raw collector exports, one folder per customer | `input/customer` |
| `CUSTOMER_OUTPUT_DIR` | Output root: processed datasets, one folder per customer | `output/customer` |
| `CUSTOMER_SLUG` | Forces the active customer workspace, bypassing the browser cookie | last ingested customer |
| `AWS_FOCUS_FIXTURE` | Path to an AWS FOCUS export for `npm run customer:aws-test` | auto-discovered under `input/customer` |

Each customer owns `input/customer/<slug>/` for its raw export and
`output/customer/<slug>/` for its normalized dataset. The output tree is derived
data: deleting it and re-running the ingest is always safe. See
[customer-poc.md](../guides/customer-poc.md#workspaces-one-folder-per-customer).

Overriding `CUSTOMER_DATA_DIR` without `CUSTOMER_OUTPUT_DIR` puts the output
inside the input root (`<dir>/.output`), so a scratch folder used by tests stays
removable in one step.

There is no variable that selects the cloud. **AWS Data Exports using the FOCUS
1.0 schema are ingested by the same command as Azure Cost Exports**: drop the
file in that customer's folder and run
`npm run ingest:customer -- "<Customer>"`. The
format is detected from the file's columns and the cloud from the FOCUS
`ProviderName` column, which is normalized to `Azure` or `AWS` on every row.

Consequences worth knowing before a demo:

- Azure and AWS share **one** dataset, with a **Provider** filter that appears
  only when more than one cloud is present.
- Pages backed by Azure-specific evidence — **reservation detail** and **AI
  insights** — show a banner and are filtered to the Azure rows, so their
  totals match the caption.
- A blank `ProviderName` on a file that *has* the column becomes `Other`, not
  Azure, and the ingest warns with the row count.
- Resource Graph and Advisor are marked `not-applicable` rather than `missing`
  for AWS, so an AWS-only dataset does not warn about absent Azure evidence.
- Mixed billing currencies are never converted. The manifest lists every
  currency it saw and the ingest warns.

See [customer-poc.md](../guides/customer-poc.md) for the full multicloud behavior.

### Cross-tenant Foundry resources

A Foundry resource often lives in a different tenant from the one your default
Azure login resolves to — a sandbox or personal tenant versus the corporate one.
When that happens every call fails with:

```
Token tenant <corp-tenant> does not match resource tenant.
```

This reads like a permissions problem, but no RBAC change fixes it. Set
`AZURE_OPENAI_TENANT_ID` to the tenant that owns the Foundry resource. Find it
with:

```bash
az account list --all --query "[?id=='<SUBSCRIPTION-ID>'].tenantId" -o tsv
```

### Using a model router deployment

`model-router` dispatches each request to whichever model it judges best, which
includes **reasoning models** (`gpt-5-mini`, `grok-*-reasoning`, ...). Those
models spend hidden *reasoning tokens* from the same completion budget as the
visible answer, and they reason first.

The dashboard handles this centrally in `src/lib/openai-client.ts`:

- All AI features call `createChatCompletion()`, never
  `client.chat.completions.create` directly.
- Callers declare the budget for the **visible** answer; the wrapper adds
  `REASONING_HEADROOM_TOKENS` (3000) on top and sends it as
  `max_completion_tokens`, the parameter reasoning models accept.
- If a model rejects a sampling parameter, the wrapper retries once without
  `temperature` / `top_p` / `presence_penalty` / `frequency_penalty`.
- `isTruncatedByReasoning()` detects a response that came back empty because the
  budget ran out, so the UI reports the analysis as unavailable instead of
  rendering a blank panel.

Measured on this deployment: 1024–1408 reasoning tokens for a short JSON answer
and 348 for a single tool call. A 400-token budget produced `finish_reason:
"length"` with an **empty string** and HTTP 200 — a success-shaped response with
no content.

Expect **10–13 s** latency for a reasoning-model answer; AI call timeouts are set
to 45 s accordingly.

### Controlling reasoning-token cost

Reasoning tokens are billed as output but are never shown. They scale with
prompt complexity — measured here: ~400 for a short extraction, 2176 for a long
Markdown report — and vary run to run for the *same* prompt (324–525 over six
runs). Three things are worth knowing before trying to tune this.

**1. `reasoning_effort` does not work through the router.** Measured on the same
prompt:

| `reasoning_effort` | reasoning tokens |
| ------------------ | ---------------- |
| (unset)            | 382              |
| `minimal`          | 380              |
| `low`              | 386              |
| `medium`           | 390              |
| `high`             | 397              |

The parameter is accepted without error and changes nothing. Do not rely on it.

**2. Choosing the model per task is the lever that works.** The same
fixed-schema JSON extraction, measured end to end:

| Route                  | Total tokens |
| ---------------------- | ------------ |
| `gpt-4o` direct        | 148          |
| router → grok          | 579          |
| router → `gpt-5`       | 1491         |

4–10x more tokens for an answer that needs no reasoning at all. Set
`AZURE_OPENAI_DEPLOYMENT_FAST` to a non-reasoning deployment (for example
`gpt-4o`) and structured tasks such as remediation insights will use it. Left
unset, everything keeps using `AZURE_OPENAI_DEPLOYMENT`.

**3. Budget generously and retry, rather than trimming.** Unused budget is not
billed, so the wrapper reserves headroom proportional to the requested answer
(`max(3000, 75% of the visible budget)`) and, if a response still comes back
truncated, retries once at 3x. A slower answer beats a blank panel in front of a
customer.

### Token accounting is not consistent between models

Models behind the same router disagree on whether `completion_tokens` includes
`reasoning_tokens`. Measured on one prompt:

| Model  | prompt | completion | reasoning | total | Meaning                     |
| ------ | ------ | ---------- | --------- | ----- | --------------------------- |
| `gpt-5`| 58     | 1433       | 1216      | 1491  | completion **includes** it  |
| grok   | 60     | 102        | 417       | 579   | completion **excludes** it  |

Reporting `completion_tokens` verbatim therefore under-states real consumption
by roughly 4x on one model while being correct on the other. **`total_tokens` is
the only field that means the same thing everywhere.** Use `getTokenUsage()`
from `src/lib/openai-client.ts`, which detects the convention and returns
visible output and reasoning tokens separately.

| Variable                       | Required | Description                                                       |
| ------------------------------ | -------- | ----------------------------------------------------------------- |
| `AZURE_OPENAI_DEPLOYMENT_FAST` | No       | Non-reasoning deployment for structured tasks. Defaults to `AZURE_OPENAI_DEPLOYMENT` |

---

## Legacy Azure OpenAI Variables (optional)

These variables are injected when `azureOpenaiEndpoint` is non-empty in the Bicep parameters. They enable the AI assistant feature if you have a separate Azure OpenAI resource.

| Variable                   | Description           | Example                                                  |
| -------------------------- | --------------------- | -------------------------------------------------------- |
| `AZURE_OPENAI_ENDPOINT`    | Azure OpenAI endpoint | `https://<RESOURCE>.openai.azure.com`                    |
| `AZURE_OPENAI_RESOURCE_ID` | Full resource ID      | `/subscriptions/<SUB>/resourceGroups/<RG>/providers/...` |

---

## Azure SKU Advisor Variables (optional)

These back the `/sku-advisor` view. When `SKU_ADVISOR_API_URL` is empty the view
falls back to an advisor export in the customer workspace, and then to the
bundled sample — it never fails. See [SKU Advisor](../guides/sku-advisor.md).

| Variable              | Required | Description                                                                                   |
| --------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `SKU_ADVISOR_API_URL` | No       | Base URL of an independently deployed Azure SKU Advisor FastAPI service. Set from `skuAdvisorApiUrl` |
| `SKU_ADVISOR_API_KEY` | No       | Sent as `x-api-key`. Required when the advisor service sets its own `SKU_ADVISOR_API_KEY`       |
| `SKU_ADVISOR_LIVE_USAGE` | No    | Ask the advisor to analyze the real VM inventory instead of its bundled sample. Server-side only |

Without `SKU_ADVISOR_LIVE_USAGE`, a live advisor still answers — but from its
sample inventory, priced for real. The view reports that as
`metadata.skuAdvisorInventory: "offline"` and says so in the badge, because
savings computed over a fictional estate must not read as the customer's own.
The advisor must also permit it via `SKU_ADVISOR_ALLOW_LIVE`; if it refuses, the
dashboard retries without the flag and degrades to `offline` rather than failing.

The advisor service itself keeps `SKU_ADVISOR_ALLOW_LIVE` (Managed-Identity reads
of the Azure estate) and `SKU_ADVISOR_ALLOW_AI` (billable Azure OpenAI calls)
off by default. Enable those controls in the independently deployed advisor;
`skuAdvisorLiveUsage` only controls what the dashboard requests.

---

## Viewing & Editing Environment Variables in the Azure Portal

1. Navigate to your Container App in the Azure Portal.
2. Go to **Settings → Environment Variables** (or **Containers → Edit and deploy**).
3. Edit variables and click **Save**. A new revision is created automatically.

---

## Editing via CLI

```bash
# Update a single environment variable
az containerapp update \
  --name ca-<PROJECT_NAME>-<ENV> \
  --resource-group <RESOURCE_GROUP> \
  --set-env-vars ANALYTICS_BACKEND=ADX ADX_DATABASE=<NEW_DB>
```

---

## `.env.local.example`

A local development example file is provided at `apps/finops-dashboard/.env.local.example`. Copy it to `.env.local` (never commit `.env.local`) and fill in your values for local development.

```bash
cd apps/finops-dashboard
cp .env.local.example .env.local
# Edit .env.local with your real values
npm run dev
```
