# Testing

## How tests are run here

There is no Jest or Vitest suite. Verification is a set of standalone TypeScript
scripts in `apps/finops-dashboard/scripts/` that are invoked directly through
`npm` scripts using `tsx`. Each script runs to completion, prints pass/fail
lines, and exits with code 1 if any assertion failed.

To run a script:

```bash
cd apps/finops-dashboard
npm run auth:test
```

No test server is started and no external port is opened unless the script
comment says otherwise.

---

## Verification scripts

The table below covers every verification-related npm script defined in
`apps/finops-dashboard/package.json`. `lint` (ESLint) is omitted; it is a
style check, not a behavioural assertion.

| npm script | File(s) in `scripts/` | What it proves | Live credentials? |
|---|---|---|---|
| `auth:test` | `test-auth.ts` | Easy Auth header (`X-MS-CLIENT-PRINCIPAL`) parsing, role normalisation, and the route → required-role matrix. Does not start the server. | No |
| `adx:test` | `test-adx-timeout.ts` | That `ADX_QUERY_TIMEOUT_SECONDS` is read, clamped to the hour Kusto accepts, sent to the cluster as `servertimeout`, and not multiplied by the retry loop. Stubs `fetch`; reaches no cluster. | No |
| `stakeholder:test` | `test-stakeholder.ts` + `test-stakeholder-guardrails.ts` | Stakeholder Cards deterministic layer (fact building, payload structure, persona IDs) and the guardrail mechanism that decides whether model output is accepted or discarded. No model calls. | No |
| `customer:test` | 13 scripts (see below) | Full customer POC pipeline: Parquet/CSV parity, workspace isolation, AWS FOCUS ingestion, aggregator invariants, ESR baseline, AI-costs aggregator, budget aggregators, reservation aggregators, AI-insights truthfulness, evidence ingestion, collector-runtime contract, runtime integration, narrative pipeline. Six of the thirteen need an ingested dataset and skip without one — see the caveat below. | No |
| `customer:workspaces-test` | `test-customer-workspaces.ts` | Customer data isolation — rows from customer A cannot reach customer B through the module-level cache or the aggregation context. | No |
| `customer:aws-test` | `test-customer-aws-ingest.ts` | AWS FOCUS parquet ingestion end-to-end; validates figures at the field level. Skips cleanly when the fixture file is absent (fresh clone, CI). | No |
| `customer:narrative-test` | `test-customer-narrative.ts` | Narrative generation pipeline against a temporary scratch workspace. | No |
| `foundry:test` | `test-foundry-connection.ts` | Live round-trip to the configured Azure AI Foundry deployment. Catches tenant mismatch (looks like RBAC but is not) and reasoning models that overrun their token budget and return HTTP 200 with an empty body. | **Yes** — needs `AZURE_OPENAI_ENDPOINT` and a valid credential with the **Cognitive Services OpenAI User** role. Costs a few cents per run. |
| `openai:test` | `test-openai-endpoint.ts` | Azure OpenAI endpoint surface detection: correctly identifies the classic (`*.openai.azure.com`) and v1 (`*.../openai/v1`) URL patterns. No live HTTP calls. | No |
| `sku-advisor:test` | `test-sku-advisor.ts` | SKU Advisor payload contract, selector arithmetic, and source-resolution chain (live API → recommendations.json → bundled sample). Uses an in-process mock HTTP server; does not require the real advisor to be running. | No |
| `multicloud:test` | `test-multicloud.ts` | Multicloud comparison deterministic layer: quantity normalisation, cost-window alignment, and the guardrail that decides whether model prose is allowed through. No model calls. | No |
| `api:docs:check` | `generate-api-reference.ts --check` | Verifies that `docs/reference/api.md` is in sync with the actual route handlers. Fails if any route was added or changed without regenerating the reference. **Runs in CI** as part of the `app` job. | No |
| `api:docs` | `generate-api-reference.ts` | Regenerates `docs/reference/api.md` from the route handlers. This is a generator, not a check — run it when the check above fails. | No |

### `customer:test` — individual scripts

`npm run customer:test` chains these 13 scripts in order:

| Script | What it proves |
|---|---|
| `test-customer-parquet.ts` | Parquet and CSV readers produce byte-identical normalised rows from the same synthetic export. |
| `test-customer-workspaces.ts` | Customer workspace isolation (same as `customer:workspaces-test`). |
| `test-customer-aws-ingest.ts` | AWS FOCUS ingestion (same as `customer:aws-test`; skips if fixture absent). |
| `test-customer-aggregations.ts` | Aggregator invariants against the active dataset in `output/customer/`: no empty panels, no negative totals, percentages sum correctly. |
| `test-customer-esr.ts` | Effective Savings Rate baseline on synthetic rows. Guards a specific regression where `ListCost = 0` collapsed the savings rate to near zero. |
| `test-customer-ai-costs.ts` | AI costs aggregator smoke test against the active dataset. |
| `test-customer-budgets.ts` | Four budget aggregators against the active dataset. |
| `test-customer-reservations.ts` | Reservation aggregators against the active dataset. |
| `test-customer-ai-insights.ts` | AI-insights truthfulness: every emitted insight references a real aggregate, no insight fires when its trigger is absent, no crash on empty input. No model calls. |
| `test-customer-evidence-ingestion.ts` | Evidence ingestion pipeline in a scratch workspace. |
| `test-customer-collector-runtime.ts` | Collector-runtime contract against a scratch workspace. |
| `test-customer-runtime-integration.ts` | Runtime integration contract (schema version, processed-directory layout). |
| `test-customer-narrative.ts` | Narrative generation pipeline in a scratch workspace. |

`customer:test` depends on `output/customer/` containing an ingested dataset for
the aggregator scripts. Run `npm run ingest:customer -- "Customer Name"` first,
or use `npm run customer:sample` to generate a synthetic export and ingest that.

> **What this means in CI.** Customer data is git-ignored, so a fresh clone has
> no `output/customer/`. Six of the thirteen scripts — `aws-ingest`,
> `aggregations`, `ai-costs`, `budgets`, `reservations` and `ai-insights` —
> detect the missing dataset, print a notice and exit 0. They are green in CI
> without asserting anything.
>
> That skip is deliberate: failing on a fixture that cannot be committed would
> make the suite unusable for contributors. But it means CI covers the seven
> scripts that build their own synthetic or scratch fixtures (`parquet`,
> `workspaces`, `esr`, `evidence-ingestion`, `collector-runtime`,
> `runtime-integration`, `narrative`) and no more. **Run the aggregator scripts
> locally against a real ingested dataset before trusting a change to them.**

---

## HTTP endpoint smoke test

`apps/finops-dashboard/_test_all_endpoints.py` is a standalone Python script
that exercises every GET endpoint by making real HTTP requests to a running
server. It is a different kind of check from the `tsx` scripts above: it tests
the full request-response path rather than importing modules directly.

**Requires a running dev server.** Start it first, then run the script from the
same directory:

```bash
# Terminal 1
cd apps/finops-dashboard
npm run dev

# Terminal 2
cd apps/finops-dashboard
python _test_all_endpoints.py
```

The script hits all 30 endpoints on `http://localhost:3000/api`. For each
response it checks:

- HTTP 200 (any non-200 is a failure)
- Whether the response carries `metadata.isMock: true` — meaning the route is
  serving mock data rather than live ADX results

Output lines are tagged `REAL`, `MOCK`, or `❌`. The summary line shows counts
for all three. The script exits with code 1 if any endpoint returned an error.

A `MOCK` result is not a failure — it is informational. Running this against a
dev server with no `ADX_CLUSTER_URI` configured will produce all `MOCK` results
and exit 0.

**No Azure credentials are required.** The script works in mock mode and in
live mode equally.

---

## What CI runs

The CI pipeline (`.github/workflows/ci.yml`) uses path filtering to run only the
jobs that are relevant to each change.

| Job | Trigger | What it does |
|---|---|---|
| `app` | `apps/finops-dashboard/**` | `npm ci`, `npm run lint`, `npm run api:docs:check`, the offline verification scripts, then `npm run build` |
| `infra` | `infra/bicep/**` | Compiles the Bicep source and diffs the compiled output against the committed ARM template; fails if they have drifted. |
| `mcp` | `mcp/azure-pricing-mcp/**` | `pip install -e ".[dev]"`, then `pytest` |
| `docs` | Any `*.md` file | `node scripts/check-doc-links.mjs` — resolves every relative link in every tracked Markdown file |
| `secrets` | Always | `gitleaks` secret scan across the commit history introduced by the PR |

**Every verification script in the table above runs in CI**, in the `app` job's
`Verification scripts` step: `auth:test`, `adx:test`, `stakeholder:test`,
`multicloud:test`, `sku-advisor:test`, `openai:test` and `customer:test`. None
of them needs an Azure subscription, a credential, or a network call, so they
add no infrastructure cost.

Read that with the caveat above: `customer:test` runs in CI, but its six
dataset-dependent scripts skip there. Green CI is not a substitute for running
those locally against real ingested data.

`test-customer-runtime-integration.ts` prints a wall of
`CredentialUnavailableError` in CI before reporting success. That is the
expected path — it exercises the fallback when no Azure credential exists — but
it looks alarming in the job log, so do not read those lines as a failure.

The one exception is `foundry:test`, which calls a live Azure OpenAI deployment
and is deliberately kept a local-only check.

Because the step runs the scripts in sequence, the first failure stops it — the
job log names the script that failed.

The `app` job also validates that the build succeeds without any backend
configured (mock mode), which is a baseline regression check, not a behavioural
test.

---

## Python tests

The Python MCP server in `mcp/azure-pricing-mcp` has a `pytest` suite:

```bash
cd mcp/azure-pricing-mcp
pip install -e ".[dev]"
pytest
```

The `dev` extra is required — `pytest`, `pytest-asyncio`, and `pytest-mock` live
there, not in the base install. The suite is run by CI on every change under
`mcp/azure-pricing-mcp/`.

### Dependency caps in the dev extra

Two test dependencies are capped in `pyproject.toml`:

| Package | Cap | Reason |
|---|---|---|
| `mcp` | `<2.0.0` | `mcp` 2.0.0 removed the low-level `Server.list_tools()` decorator the server is built on. The cap stays until the server is ported. |
| `aiohttp` (dev only) | `<3.14` | `aioresponses` (the HTTP-mock library used in tests) has not yet been updated for the `stream_writer` argument that `aiohttp` 3.14 added to `ClientResponse.__init__`. The production server is unconstrained — only the test mock is affected. |

---

## Adding a new check

When adding a verification script, follow the conventions the existing scripts use:

1. **Name it `test-<feature>.ts`** and place it in `apps/finops-dashboard/scripts/`.

2. **Open with a JSDoc comment** that states what the script tests, how to run
   it (`npm run <name>` or `npx tsx scripts/test-<feature>.ts`), and whether it
   needs live credentials or pre-ingested data.

3. **Use the `check(name, fn)` pattern** — a wrapper that catches thrown errors,
   increments a `failures` or `passes` counter, and prints `✓` or `✗`. See
   `test-auth.ts` for a canonical example.

4. **Exit with code 1 on failure:**
   ```ts
   process.exit(failures === 0 ? 0 : 1);
   ```

5. **Load `.env.local` manually** if the script reads environment variables.
   Next.js loads it automatically; a standalone `tsx` invocation does not. See
   `test-foundry-connection.ts` for the pattern.

6. **Register it in `package.json`** under a named `npm` script so it can be
   invoked consistently and discovered from this table.

7. **Keep it offline by default.** If the check genuinely needs a live endpoint,
   document that clearly in the JSDoc comment and in this table.
