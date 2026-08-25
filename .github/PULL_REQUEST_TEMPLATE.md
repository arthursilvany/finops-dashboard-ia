## Description

<!-- What does this PR do, and why is it needed? -->

## Related issue

<!-- e.g. "Fixes #123". Write "N/A" if there is no issue. -->

Fixes #

## Type of change

<!-- Mark all that apply with an "x" -->

- [ ] 🐛 Bug fix
- [ ] ✨ New feature
- [ ] 🏗️ Infrastructure change (`infra/bicep/`, `infra/arm/`)
- [ ] 🔐 Authentication / authorization change
- [ ] 💰 Azure Pricing MCP server (`mcp/azure-pricing-mcp`)
- [ ] 📝 Documentation
- [ ] ⚙️ CI / tooling / dependencies
- [ ] ♻️ Refactoring (no behavior change)

## How was this tested?

<!--
Be specific. "It works" is not testing. Name the commands you ran and what you observed.
Examples:
  - `npm run lint && npm run build` in apps/finops-dashboard
  - `npm run auth:test` — Reader/Admin route policy still enforced
  - `pytest` in mcp/azure-pricing-mcp
  - `az deployment group what-if` against a test resource group — output attached below
-->

## Checklist

- [ ] The change is focused — no unrelated refactoring is mixed in.
- [ ] Documentation that this change makes wrong has been updated.
- [ ] **No secrets in the diff** — no client secrets, keys, tokens, connection strings, real
      tenant or subscription IDs, or customer names.
- [ ] No customer cost data or lab data is committed.

### If `infra/bicep/**` changed

- [ ] `infra/arm/azuredeploy.json` was **recompiled** and the result is committed in this PR.
      CI fails on drift.
      ```bash
      az bicep build --file infra/bicep/finops-dashboard/main.bicep \
        --outfile infra/arm/azuredeploy.json
      ```
- [ ] `az deployment group what-if` was run against a non-production resource group, and the
      output contains no unexpected `Modify` or `Delete`.

### If an API route or the auth layer changed

- [ ] Any new non-`GET` route requires the Admin role, or is justified below for inclusion in
      `READ_ONLY_WRITE_METHOD_PATHS`.
- [ ] The anonymous path list was kept in sync in **both** places — `excludedPaths` in
      `infra/bicep/finops-dashboard/modules/containerapp.bicep` and `ANONYMOUS_PATHS` in
      `apps/finops-dashboard/src/lib/auth-policy.ts`.

## Additional notes

<!-- Screenshots, what-if output, trade-offs, follow-up work. Delete if not needed. -->
