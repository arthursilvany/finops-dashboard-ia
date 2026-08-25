# Troubleshooting

## Container App will not start

**Symptom**: Container App shows `Degraded` or `Failed` status, no traffic served.

**Diagnosis**:

```bash
# Check container logs
az containerapp logs show \
  --name ca-<PROJECT_NAME>-<ENV> \
  --resource-group <RESOURCE_GROUP> \
  --tail 100

# Check revision status
az containerapp revision list \
  --name ca-<PROJECT_NAME>-<ENV> \
  --resource-group <RESOURCE_GROUP> \
  --output table
```

**Common causes**:

| Symptom in logs                        | Cause                                            | Fix                                                              |
| -------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------- |
| `Error: image not found` or pull error | Image not pushed to ACR, or AcrPull role missing | Push image to ACR; assign AcrPull role to Managed Identity       |
| `Cannot find module '...'`             | Build failed or wrong image tag                  | Rebuild image and push correct tag                               |
| `PORT must be 3000`                    | App listening on wrong port                      | Ensure Dockerfile exposes 3000 and app listens on `PORT` env var |
| `EADDRINUSE: address already in use`   | Multiple processes in container                  | Fix Dockerfile CMD to run single process                         |

---

## Dashboard loads but analytics data is empty

**Symptom**: Dashboard loads, no query errors in browser, but tables and charts show no data.

**Diagnosis**: Check environment variables and authentication.

```bash
# View current env vars on the Container App
az containerapp show \
  --name ca-<PROJECT_NAME>-<ENV> \
  --resource-group <RESOURCE_GROUP> \
  --query "properties.template.containers[0].env"
```

**Common causes**:

| Cause                                                 | Fix                                                                                                      |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `ANALYTICS_BACKEND=None`                              | Re-deploy with correct `analyticsBackend` parameter                                                      |
| `ADX_CLUSTER_URI` is empty or wrong                   | Check the URI format: `https://<cluster>.<region>.kusto.windows.net`                                     |
| Managed Identity not granted `Database Viewer` on ADX | Follow [security.md](security.md) Step 2                                                                 |
| Wrong `ADX_DATABASE`                             | Verify the database name in ADX web UI                                                                   |
| Query exceeds `ADX_QUERY_TIMEOUT_SECONDS`             | The error names the deadline. Narrow the date range, or raise the value (default `30`, maximum `3600`)   |
| Fabric Workspace ID vs Query URI conflict             | Provide only one: either `FABRIC_QUERY_URI` or the `FABRIC_WORKSPACE_ID`+`FABRIC_KQL_DATABASE_NAME` pair |

---

## Authentication errors (401 / 403)

**Symptom**: Application logs show `401 Unauthorized` or `403 Forbidden` when querying the analytics backend.

**For Managed Identity**:

```bash
# Verify the identity is attached to the Container App
az containerapp show \
  --name ca-<PROJECT_NAME>-<ENV> \
  --resource-group <RESOURCE_GROUP> \
  --query "identity"

# Verify AcrPull role assignment
az role assignment list \
  --assignee <IDENTITY_PRINCIPAL_ID> \
  --role AcrPull \
  --output table

# Verify ADX role assignment
az kusto database-principal-assignment list \
  --cluster-name <CLUSTER_NAME> \
  --database-name <DATABASE_NAME> \
  --resource-group <CLUSTER_RESOURCE_GROUP>
```

**For Service Principal**:

- Verify `SP_TENANT_ID`, `SP_CLIENT_ID` are correct env vars.
- Verify `sp-client-secret` Container App secret has the correct value.
- Check the service principal has not expired: `az ad sp show --id <SP_CLIENT_ID>`.

---

## Cost APIs return 500 while `/api/health` reports `connected: true`

The health check only proves the identity can reach the cluster. The FinOps Hub functions
(`Costs()`, `Prices_v1_2()`, …) are defined in `Hub` but resolve remote entities in `Ingestion`,
so a principal with `Viewer` on `Hub` alone fails with a Kusto **400**, not the 403 the symptom
suggests:

```
General_BadRequest: Request is invalid and cannot be executed.
  innererror SEM0056: Errors occurred while resolving remote entities.
  Database='Ingestion': Access denied
```

The app truncates ADX error bodies to 200 characters, which hides the `innererror`. Grant `Viewer`
on `Ingestion` as well — see [deployment.md](deployment.md#step-3--assign-rbac-roles).

---

## `az acr build` fails with `UnicodeEncodeError` on Windows

The CLI's log streamer cannot encode the Next.js `▲` banner in the console code page, and the
resulting traceback **masks the real build error**:

```
UnicodeEncodeError: 'charmap' codec can't encode character '\u25b2'
```

Setting `PYTHONIOENCODING=utf-8` does not help, because colorama has already wrapped stdout.
Build with `--no-logs` and fetch the log afterwards:

```powershell
az acr build --registry <ACR> --image <image>:latest --file Dockerfile . --no-logs

$link = az rest --method post `
  --url "https://management.azure.com/subscriptions/<SUB>/resourceGroups/<RG>/providers/Microsoft.ContainerRegistry/registries/<ACR>/runs/<RUN_ID>/listLogSasUrl?api-version=2019-06-01-preview" `
  --query logLink -o tsv
(Invoke-WebRequest $link).Content
```

Related: `az acr repository list` is a data-plane call and hangs when the registry has the admin
user disabled. Use `az acr task list-runs -r <ACR>` instead.

---

## MCP server crashes with `'Server' object has no attribute 'list_tools'`

`mcp` 2.0.0 removed the low-level `Server.list_tools()` decorator that `mcp/azure-pricing-mcp` is
built on. The project pins `mcp>=1.0.0,<2.0.0` for this reason — if the container was built
before that pin, rebuild the image and restart the revision.

---

## AI features fail: "Token tenant does not match resource tenant"

**Symptom**: chat, daily insights and remediation insights fail. The error is a
`400` with:

```
Token tenant 72f9... does not match resource tenant.
```

**Cause**: the Azure AI Foundry resource lives in a different tenant from the one
your credential resolves to by default (typically a sandbox or personal tenant
versus the corporate one). It reads like a permissions problem, but granting more
RBAC will not fix it — the token is simply issued for the wrong tenant.

**Fix**: find the tenant that owns the Foundry resource and pin it.

```bash
az cognitiveservices account list --subscription <SUB> -o table   # locate the resource
az account list --all --query "[?id=='<SUB>'].tenantId" -o tsv    # its tenant
```

Then set `AZURE_OPENAI_TENANT_ID` to that value and re-run `npm run foundry:test`.

---

## AI panels render blank, or insights fall back to generic text

**Symptom**: the request succeeds (HTTP 200) but the panel is empty, or a
remediation insight shows generic wording that ignores the recommendation.

**Cause**: the deployment is a **model router** and routed to a reasoning model.
Reasoning models spend hidden reasoning tokens from the same budget as the
visible answer, and reason first. If the budget only covers the visible answer
they exhaust it thinking and return `finish_reason: "length"` with an empty
string — a success-shaped response with no content. Callers that `JSON.parse`
that empty string then silently fall back.

**Fix**: never call `client.chat.completions.create` directly. Use
`createChatCompletion()` from `src/lib/openai-client.ts`, which adds
`REASONING_HEADROOM_TOKENS` on top of the requested budget and sends it as
`max_completion_tokens`. If a specific prompt still truncates, raise its
`max_tokens` — the wrapper treats it as the visible-answer budget only.

Diagnose with `npm run foundry:test`, and inspect
`usage.completion_tokens_details.reasoning_tokens` in the response.

---

## AI requests time out

**Symptom**: AI calls abort after ~15 s and fall back.

**Cause**: reasoning models are slow. Measured 10–13 s for a short JSON answer on
a `model-router` deployment, which leaves no margin under a 15 s timeout.

**Fix**: AI call timeouts are set to 45 s. If you add a new AI call site, do not
copy a short timeout from a non-reasoning example.

---

## ACR image pull errors

**Symptom**: `Failed to pull image` or `unauthorized: authentication required` in container logs.

**Fix**:

```bash
# 1. Confirm ACR admin is disabled (expected)
az acr show \
  --name <ACR_NAME> \
  --query "properties.adminUserEnabled"
# Should return: false

# 2. Assign AcrPull to the Managed Identity
IDENTITY_PRINCIPAL=$(az containerapp show \
  --name ca-<PROJECT_NAME>-<ENV> \
  --resource-group <RESOURCE_GROUP> \
  --query "identity.userAssignedIdentities.*.principalId | [0]" -o tsv)

ACR_ID=$(az acr show --name <ACR_NAME> --query id -o tsv)

az role assignment create \
  --assignee "$IDENTITY_PRINCIPAL" \
  --role AcrPull \
  --scope "$ACR_ID"

# 3. Restart the Container App
az containerapp revision restart \
  --name ca-<PROJECT_NAME>-<ENV> \
  --resource-group <RESOURCE_GROUP>
```

---

## Bicep compilation errors

**Symptom**: `bicep build` fails with errors.

**Common errors**:

| Error                             | Fix                                                                      |
| --------------------------------- | ------------------------------------------------------------------------ |
| `BCP037: property not allowed`    | Check API version — some properties differ across versions               |
| `BCP081: resource type not found` | Verify the resource provider namespace and type name                     |
| `BCP318: value may be null`       | This is a warning, not an error — safe to ignore for conditional modules |
| `BCP334: name too short`          | Ensure `projectName` is at least 4 characters after removing hyphens     |

---

## Deployment fails in Azure Portal

**Symptom**: Portal deployment shows `Conflict` or `BadRequest`.

**Common causes**:

| Error message                                                         | Fix                                                                                             |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `ACR name already taken`                                              | ACR names are globally unique. Change `projectName` to something more unique.                   |
| `Container App name already exists`                                   | Use a different `environment` value (e.g., `prod` → `prod2`) or use an existing resource group. |
| `The subscription is not registered to use namespace 'Microsoft.App'` | Run: `az provider register --namespace Microsoft.App`                                           |
| `Quota exceeded`                                                      | Request a quota increase in the Azure Portal under **Subscriptions → Usage + quotas**.          |

---

## Local Development Issues

**Symptom**: `npm run dev` fails locally.

```bash
# Install dependencies
cd apps/finops-dashboard
npm install

# Check Node.js version (requires 18+)
node --version

# Copy and edit env file
cp .env.local.example .env.local
# Fill in real values

npm run dev
# Open http://localhost:3000
```

**Symptom**: TypeScript errors on build.

```bash
npm run type-check
# Fix reported type errors before pushing
```

**Symptom**: pages return HTTP 200 but render blank, and the browser console
shows 404s for `/_next/static/chunks/main-app.js` or `layout.css`.

The dev server and `npm run build` write to the **same `.next/` directory**.
Running a production build while `npm run dev` is up replaces the dev chunks on
disk, so the running server keeps serving HTML that references files that no
longer exist. The API keeps working — only the browser breaks — which makes it
look like a data problem when it is not.

```bash
# Stop the dev server first, then:
rm -rf .next        # Windows: Remove-Item -Recurse -Force .next
npm run dev
```

Verify the fix by requesting an asset directly rather than trusting the page
status, since the page returns 200 either way:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  'http://localhost:3000/_next/static/chunks/main-app.js'
```

To avoid it entirely, don't run `npm run build`, `npm run lint` or the test
scripts against a directory whose dev server is running — stop it first, or use
a separate checkout.

---

## Getting Support

1. Check this troubleshooting guide first.
2. Search [GitHub Issues](https://github.com/arthursilvany/finops-dashboard-ia/issues) for existing reports.
3. Open a new issue with:
   - Error message (sanitize any real endpoints or IDs)
   - `ANALYTICS_BACKEND` and `AUTH_MODE` values
   - Azure region
   - Container App revision ID
