# Contributing to FinOps Dashboard IA

Thanks for your interest in improving this project. This guide covers how to get a working
local environment, the conventions the repository follows, and what a reviewable pull request
looks like.

All documentation, code comments, and commit messages in this repository are written in
**English**.

---

## Repository layout

This is a monorepo. Each workspace has its own `package.json` or `pyproject.toml`, so
**commands are run from the workspace directory, not from the repository root**.

| Path | What it is |
| --- | --- |
| `apps/finops-dashboard` | The Next.js 16 dashboard (TypeScript, Tailwind, SWR, Zod) |
| `mcp/azure-pricing-mcp` | Python MCP server for Azure retail pricing |
| `infra/bicep/finops-dashboard` | Bicep source of truth for the Azure deployment |
| `infra/arm/azuredeploy.json` | **Compiled artifact** — generated from Bicep, never hand-edited |
| `docs/` | Project-level and product documentation |

---

## Local setup

### Dashboard

```bash
cd apps/finops-dashboard
npm install
cp .env.local.example .env.local   # fill in your own values
npm run dev                        # http://localhost:3000
```

Without a configured analytics backend the dashboard runs in mock mode. See
[docs/configuration.md](./docs/reference/configuration.md) for every environment
variable and what it switches on.

Useful checks:

```bash
npm run lint
npm run build
npm run auth:test          # sign-in layer: principal parsing + route policy
npm run adx:test           # ADX query deadline: read, clamped, sent, not retried
npm run stakeholder:test   # deterministic layer + AI guardrails
npm run customer:test      # customer POC aggregators
```

CI runs all of these, so a green local run is a good predictor of a green pull
request. The full catalogue, and what each script actually proves, is in
[docs/operations/testing.md](./docs/operations/testing.md).

> Do not run `npm run build` while `npm run dev` is running. Both write to the same `.next/`
> directory; the result is pages that return HTTP 200 but render blank because their JS and CSS
> chunks 404. Stop the dev server first, and delete `.next/` to recover.

### Azure Pricing MCP server

```bash
cd mcp/azure-pricing-mcp
pip install -e .
pytest
python -m azure_pricing_mcp --transport http --host 0.0.0.0 --port 8080
```

Keep the `mcp` dependency pinned below `2.0.0`: version 2 removed the low-level
`Server.list_tools()` decorator this server is built on.

### Infrastructure

```bash
az bicep build --file infra/bicep/finops-dashboard/main.bicep --outfile infra/arm/azuredeploy.json
```

---

## The one invariant you must not break

`infra/arm/azuredeploy.json` is **compiled output**. If you change anything under
`infra/bicep/`, you must recompile it and commit the result in the same pull request.

CI enforces this: the `infra` job recompiles the Bicep and fails if the result differs from the
committed JSON. A PR that edits Bicep without recompiling will not pass.

Never edit `azuredeploy.json` by hand. Your change will be silently overwritten on the next
recompile.

---

## Conventions

### Code

- TypeScript runs in strict mode; path aliases are configured in
  [`tsconfig.json`](apps/finops-dashboard/tsconfig.json). Prefer `@/` imports inside the app.
- ESLint uses `next/core-web-vitals`
  ([`eslint.config.mjs`](apps/finops-dashboard/eslint.config.mjs)).
- Tailwind theme tokens live in
  [`tailwind.config.ts`](apps/finops-dashboard/tailwind.config.ts) — use the tokens rather than
  hard-coded colours.
- Comment code that needs clarification. Do not narrate the obvious.

### Commits

This repository follows [Conventional Commits](https://www.conventionalcommits.org/):

```text
feat(infra): store application secrets in Key Vault
fix: enable id token issuance for Easy Auth
docs: translate the stakeholder cards reference to English
ci: validate Bicep drift on pull requests
chore: add community health files
```

Common types: `feat`, `fix`, `docs`, `ci`, `chore`, `refactor`, `test`.
Common scopes: `infra`, `app`, `mcp`, `auth`, `customer-poc`.

Write the subject line in the imperative mood and explain the *why* in the body when the change
is not self-evident.

### Branches

Branch off `main` using a prefix that names the change domain:

| Prefix | Scope |
| --- | --- |
| `feat/` | New functionality |
| `fix/` | Bug fixes |
| `docs/` | Documentation only |
| `infra/` | Bicep, ARM, deployment scripts |
| `ci/` | Workflows and automation |
| `chore/` | Tooling, dependencies, housekeeping |

Example: `infra/add-private-endpoints`, `docs/translate-stakeholder-cards`.

---

## Pull requests

1. **Open an issue first** for anything non-trivial, so the approach can be agreed before you
   invest time.
2. Keep the diff focused. Do not mix an infrastructure change with unrelated application
   refactoring — they have different reviewers and different risk profiles.
3. Fill in the pull request template honestly, especially the testing section.
4. Make sure CI is green. The checks are `app` (lint, API reference, verification scripts,
   build), `infra` (Bicep drift), `mcp` (pytest), `docs` (documentation link check), and
   `secrets` (gitleaks). A final `CI` job aggregates them into a single result.

   The aggregate `CI` check is required by the `main` branch ruleset. It reports correctly when
   path-filtered jobs are skipped, while still failing if change detection or any required job
   fails.
5. Update the documentation that your change makes wrong. A change that silently invalidates a
   doc is an incomplete change.

### Security expectations for every PR

- **No secrets in the diff.** No connection strings, client secrets, keys, tokens, subscription
  IDs belonging to real tenants, or customer names.
- Real cost exports and customer data belong in `input/customer/`, which is gitignored. Never
  commit them.
- Prefer Managed Identity over API keys when integrating with Azure services.
- If you add a non-`GET` API route, it requires the Admin role by default. Only add it to
  `READ_ONLY_WRITE_METHOD_PATHS` if it genuinely has no side effects.
- The anonymous path list is duplicated by design — `excludedPaths` in
  [`containerapp.bicep`](infra/bicep/finops-dashboard/modules/containerapp.bicep) and
  `ANONYMOUS_PATHS` in [`auth-policy.ts`](apps/finops-dashboard/src/lib/auth-policy.ts). If you
  change one, change the other.

---

## Reporting security vulnerabilities

Do **not** open a public issue. Follow [SECURITY.md](SECURITY.md).

---

## Code of Conduct

Participation in this project is governed by the
[Code of Conduct](CODE_OF_CONDUCT.md).
