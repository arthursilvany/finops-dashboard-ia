# GitHub Copilot instructions

The full, canonical guidance for this repository lives in **[AGENTS.md](../AGENTS.md)** at the
repository root. Read it before making changes — it covers the repository layout, the commands
for each workspace, conventions, and security guardrails.

This file repeats only the hard invariants, because breaking one of them has already caused an
incident or is enforced by CI.

All code, comments, commit messages, and documentation in this repository are written in
**English**.

## Hard invariants

1. **`infra/arm/azuredeploy.json` is compiled output, never hand-edited.** Any change under
   `infra/bicep/` must be followed by a recompile committed in the same change. CI fails on
   drift.

   ```bash
   az bicep build --file infra/bicep/finops-dashboard/main.bicep --outfile infra/arm/azuredeploy.json
   ```

2. **The anonymous path list is duplicated by design.** It exists as `excludedPaths` in
   `infra/bicep/finops-dashboard/modules/containerapp.bicep` and as `ANONYMOUS_PATHS` in
   `apps/finops-dashboard/src/lib/auth-policy.ts`. Changing one without the other creates a
   route that one layer allows and the other denies.

3. **Any new non-`GET` API route requires the Admin role by default.** Only add it to
   `READ_ONLY_WRITE_METHOD_PATHS` if it genuinely has no side effects.

4. **Never run `npm run build` while `npm run dev` is running.** Both write to the same `.next/`
   directory; pages then return HTTP 200 but render blank because their JS and CSS chunks 404.

5. **Easy Auth requires `enableIdTokenIssuance` on the app registration.** Container Apps Easy
   Auth uses the hybrid OIDC flow. Without that flag, Entra ID never issues an `id_token` and
   sign-in fails at the callback with HTTP 401 (substatus 73).

6. **Never hardcode secrets**, and never commit customer cost exports, real customer names, or
   lab data. Secrets belong in Azure Key Vault; cost exports belong in the gitignored
   `input/customer/`.

## Commands, in short

Run these from the workspace directory, never from the repository root.

```bash
# Dashboard — apps/finops-dashboard
npm install && npm run lint && npm run build

# Azure Pricing MCP — mcp/azure-pricing-mcp
pip install -e . && pytest
```

Everything else — the full command list, conventions, pitfalls, and the authoritative
documentation index — is in [AGENTS.md](../AGENTS.md).
