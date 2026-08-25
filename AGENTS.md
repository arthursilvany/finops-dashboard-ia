# AGENTS.md

## Purpose
This file helps AI coding agents work effectively in this repository.
Keep changes scoped, prefer minimal diffs, and link to existing docs instead of restating them.

## Repository Layout
- [README.md](README.md): Project overview and one-click Azure deployment entry point.
- [apps/finops-dashboard](apps/finops-dashboard): Main Next.js 16 dashboard app (TypeScript, Tailwind, SWR, Zod).
- [mcp/azure-pricing-mcp](mcp/azure-pricing-mcp): Python Azure retail pricing MCP server (stdio and HTTP transports), deployed as an internal-only Container App.
- [infra/bicep/finops-dashboard](infra/bicep/finops-dashboard): Bicep source of truth for Azure deployment.
- `infra/arm/azuredeploy.json`: **Compiled artifact** generated from Bicep — never hand-edited.
- [docs/](docs): Project-level and product documentation.

## Working Directories And Commands
Run commands from the target project folder, not repo root.

### Main dashboard
From [apps/finops-dashboard](apps/finops-dashboard):
- `npm install`
- `npm run dev` (port 3000)
- `npm run dev:full` (Next.js + Python pricing MCP service)
- `npm run build`
- `npm start`
- `npm run lint`
- `python _test_all_endpoints.py` (with dev server running)
- `npm run ingest:customer -- "Contoso"` (customer POC mode; reads `input/customer/contoso/`, writes `output/customer/contoso/` — see [docs/customer-poc.md](./docs/guides/customer-poc.md))
- `npm run customer:test` (validates the customer POC aggregators)
- `npm run customer:workspaces-test` (validates isolation between per-customer workspaces, and that input stays separate from output)
- `npm run stakeholder:test` (validates the Stakeholder Cards: deterministic layer + AI guardrails)
- `npm run auth:test` (validates the sign-in layer: client principal parsing + Reader/Admin route policy)
- `npm run adx:test` (validates the ADX query deadline: `ADX_QUERY_TIMEOUT_SECONDS` is read, clamped, sent to Kusto as `servertimeout`, and not multiplied by the retry loop)
- `npm run sku-advisor:test` (validates the SKU Advisor integration: payload contract, selectors, source precedence — see [docs/sku-advisor.md](./docs/guides/sku-advisor.md))
- `npm run foundry:test` (live check of the Azure AI Foundry connection; needs `AZURE_OPENAI_*` set)
- `npm run openai:test`, `npm run multicloud:test`
- `npm run api:docs` (regenerates the route table in [docs/reference/api.md](./docs/reference/api.md)) and `npm run api:docs:check` (fails if it is stale — this runs in CI)

> Every `:test` script above runs in CI except `foundry:test`, which needs live Azure OpenAI
> credentials. They are offline and cheap — run the relevant ones before finalizing a change.

### Azure Pricing MCP server (Python)
From [mcp/azure-pricing-mcp](mcp/azure-pricing-mcp):
- `pip install -e .`
- `python -m azure_pricing_mcp --transport http --host 0.0.0.0 --port 8080`
- `pytest`
- Keep `mcp` pinned below 2.0.0: it removed the low-level `Server.list_tools()` decorator this server is built on.

### Infrastructure
From the repository root:
- `az bicep build --file infra/bicep/finops-dashboard/main.bicep --outfile infra/arm/azuredeploy.json`

## Invariants
These are enforced by CI or have already caused an incident. Do not break them.
- **`infra/arm/azuredeploy.json` is compiled output.** Any change under `infra/bicep/` must be followed by a recompile, committed in the same change. The `infra` CI job recompiles and fails on drift. Never edit the JSON by hand.
- **The anonymous path list is duplicated by design** — see the guardrails below. Changing one side without the other creates a route that one layer allows and the other denies.
- **Easy Auth requires `enableIdTokenIssuance` on the app registration.** Container Apps Easy Auth uses the hybrid OIDC flow (`response_type=code+id_token`). Without that flag, Entra ID never issues an `id_token` and Easy Auth rejects the callback locally with HTTP 401 (substatus 73), without any outbound network call. This is set by [setup-entra-app.ps1](apps/finops-dashboard/scripts/setup-entra-app.ps1).

## Conventions
- TypeScript strict mode and path aliases are configured in [apps/finops-dashboard/tsconfig.json](apps/finops-dashboard/tsconfig.json).
- ESLint uses Next core web vitals in [apps/finops-dashboard/eslint.config.mjs](apps/finops-dashboard/eslint.config.mjs).
- Tailwind theme tokens live in [apps/finops-dashboard/tailwind.config.ts](apps/finops-dashboard/tailwind.config.ts).
- Prefer `@/` imports within the main app where applicable.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/). Common scopes: `infra`, `app`, `mcp`, `auth`, `customer-poc`.
- All code, comments, commit messages, and documentation are written in **English**.
- See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contributor workflow.

## Security And Config Guardrails
- Never hardcode secrets.
- Use [.env.local.example](apps/finops-dashboard/.env.local.example) as local template.
- Application secrets live in Azure Key Vault and reach the Container App through Key Vault references.
- Customer cost exports and lab data belong in `input/customer/`, which is gitignored. Never commit them, and never commit real customer names.
- Prefer Managed Identity over API keys when integrating with Azure services.
- Dashboard sign-in is enforced in two layers (Easy Auth + `src/proxy.ts`). The anonymous path list exists twice — `excludedPaths` in [containerapp.bicep](infra/bicep/finops-dashboard/modules/containerapp.bicep) and `ANONYMOUS_PATHS` in [auth-policy.ts](apps/finops-dashboard/src/lib/auth-policy.ts) — and must be kept in sync.
- Any new non-GET API route requires the Admin role by default. Add it to `READ_ONLY_WRITE_METHOD_PATHS` only if it truly has no side effects.
- For production deployment and RBAC steps, follow [apps/finops-dashboard/DEPLOY.md](apps/finops-dashboard/DEPLOY.md) and [docs/operations/security.md](./docs/operations/security.md).

## Common Pitfalls
- Running npm commands from repo root fails because each app has its own `package.json`.
- The `dev:full` scripts rely on a Python MCP service path; verify local path availability before using them.
- ADX/OpenAI access failures are often RBAC issues, not code issues. Being Owner of a subscription does **not** grant Key Vault data-plane access when the vault uses RBAC authorization, and an Azure RBAC role on an ADX cluster does **not** grant Kusto data-plane read — that needs a database principal assignment.
- Mock/real data behavior depends on environment variables documented in [docs/reference/configuration.md](./docs/reference/configuration.md).
- Running `npm run build` while `npm run dev` is up overwrites the shared `.next/` directory: pages then return 200 but render blank, because their JS/CSS chunks 404. Stop the dev server before building, and `rm -rf .next` to recover. See [troubleshooting.md](./docs/operations/troubleshooting.md).

## Authoritative Documentation
Use links below as source of truth and avoid duplicating these details in code comments or new instruction files.
- [docs/README.md](./docs/README.md) — the documentation index
- [docs/getting-started.md](./docs/getting-started.md)
- [docs/architecture/overview.md](./docs/architecture/overview.md)
- [docs/architecture/data-model.md](./docs/architecture/data-model.md) — the ADX schema the queries depend on
- [docs/adr/README.md](./docs/adr/README.md) — architecture decision records
- [docs/reference/api.md](./docs/reference/api.md) — generated from the route handlers; run `npm run api:docs` after adding a route
- [docs/reference/configuration.md](./docs/reference/configuration.md)
- [docs/reference/infrastructure.md](./docs/reference/infrastructure.md)
- [docs/reference/glossary.md](./docs/reference/glossary.md)
- [docs/guides/customer-poc.md](./docs/guides/customer-poc.md)
- [docs/guides/stakeholder-cards.md](./docs/guides/stakeholder-cards.md)
- [docs/guides/sku-advisor.md](./docs/guides/sku-advisor.md)
- [docs/operations/deployment.md](./docs/operations/deployment.md)
- [docs/operations/runbook.md](./docs/operations/runbook.md)
- [docs/operations/testing.md](./docs/operations/testing.md)
- [docs/operations/troubleshooting.md](./docs/operations/troubleshooting.md)

## Change Discipline
- Keep patches focused and minimal.
- Do not refactor unrelated areas in the same change.
- When editing infra, avoid mixing app code changes unless explicitly requested.
- Validate with nearest relevant checks (lint, typecheck, targeted run) before finalizing.
