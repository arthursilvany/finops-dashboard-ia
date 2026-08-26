# FinOps Dashboard — Deployment Runbook

Deploys the dashboard to Azure Container Apps, backed by an existing
[FinOps Hub](https://microsoft.github.io/finops-toolkit/hubs) (Azure Data Explorer) and an
existing Azure OpenAI / AI Foundry resource, with Entra ID sign-in via Easy Auth.

The dashboard is designed to be deployed **into the resource group that already hosts the
FinOps Hub**. The template only creates its own resources and never touches the Hub — run
`what-if` (step 5) to prove that before every deployment.

## What gets created

| Resource                  | Name pattern                          | Notes                                   |
| ------------------------- | ------------------------------------- | --------------------------------------- |
| User-assigned identity    | `mi-<project>-<env>`                  | Single identity for ADX and OpenAI      |
| Log Analytics workspace   | `log-<project>-<env>`                 |                                         |
| Container Apps env        | `env-<project>-<env>`                 | Shared by both apps                     |
| Container App (dashboard) | `app-<project>-<env>`                 | External ingress, Easy Auth enabled     |
| Container App (MCP)       | `app-<project>-mcp-<env>`             | **Internal** ingress, port 8080         |

The Azure Pricing MCP server runs as a Container App with `ingress.external: false`. It has no
authentication of its own, so internal-only ingress is a security requirement, not an
optimization. Do not expose it publicly.

## Prerequisites

- An existing FinOps Hub with an ADX cluster, and its cluster URI.
- An existing Azure OpenAI or AI Foundry resource with a chat deployment, **in the same tenant**
  as the Container App — `authMode=ManagedIdentity` cannot issue cross-tenant tokens.
- Contributor on the resource group; backend role assignments may require
  additional permissions on those external resources.
- Azure CLI with the Bicep extension.

---

## 1. Create the Entra ID app registration

```powershell
cd apps/finops-dashboard
./scripts/setup-entra-app.ps1 -DisplayName "FinOps Dashboard - Staging" -AssignAdminToCurrentUser
```

Record `clientId`, `tenantId` and the client secret. **Never commit the secret** — pass it on the
command line in step 6, or keep it in a local `.bicepparam` that git ignores.

`-AssignAdminToCurrentUser` assigns `FinOps.Admin` to you. With `authDefaultRole=none`, skipping
it locks everyone out of the deployed app.

## 2. Confirm the published images

The template uses immutable public GHCR images, so no registry bootstrap is
required:

```powershell
docker manifest inspect ghcr.io/arthursilvany/finops-dashboard-ia-dashboard:1.0.0
docker manifest inspect ghcr.io/arthursilvany/finops-dashboard-ia-azure-pricing-mcp:1.0.0
```

Both commands must succeed anonymously before deployment.

## 3. Assemble the parameters

```powershell
$p = @(
  'location=<location>'
  'projectName=finops-dashboard'
  'environment=staging'
  'analyticsBackend=ADX'
  'authMode=ManagedIdentity'
  'adxClusterUri=https://<hub-cluster>.<region>.kusto.windows.net'
  'adxDatabaseName=Hub'
  'azureOpenaiEndpoint=https://<resource>.openai.azure.com/openai/v1'
  'azureOpenaiDeployment=gpt-4o'
  'deployMcp=true'
  'deployKeyVault=true'
  'enableEasyAuth=true'
  'authDefaultRole=none'
  'easyAuthClientId=<clientId>'
  'easyAuthTenantId=<tenantId>'
  'easyAuthClientSecret=<secret>'
)
```

Both Azure OpenAI endpoint shapes are accepted — the `/openai/v1` surface copied straight from
the Foundry portal, and the classic `https://<resource>.openai.azure.com`. See
[docs/configuration.md](../../docs/reference/configuration.md).

`deployKeyVault=true` (the default) provisions an RBAC-enabled vault, writes every secret you
pass into it, and gives the Container App a **Key Vault reference** instead of a literal value.
The secrets still travel through the deployment — they just do not come to rest in the Container
App. Set `keyVaultPurgeProtection=true` for production; it is irreversible, which is why the
template leaves it off by default. To reuse an existing vault, set `deployKeyVault=false` and
pass `easyAuthClientSecretUri` (and its siblings) instead — see
[docs/security.md](../../docs/operations/security.md).

## 4. Preview with `what-if`

Mandatory when deploying into the Hub's resource group. A resource-group-scoped template can
touch existing resources on a name collision.

```powershell
az deployment group what-if -g <resource-group> -f infra/bicep/finops-dashboard/main.bicep --parameters $p
```

Every Hub resource must appear as `Ignore`. Abort if anything shows as `Modify` or `Delete`.
## 5. Deploy

```powershell
az deployment group create -g <resource-group> -n finops-dashboard-staging `
  -f infra/bicep/finops-dashboard/main.bicep --parameters $p
```

Capture `containerAppUrl` and `managedIdentityPrincipalId` from the outputs.

## 6. Grant data-plane permissions

Azure RBAC on the Kusto cluster does **not** grant the right to read data. Each database needs
its own principal assignment:

```powershell
$mi = '<managedIdentityPrincipalId>'

foreach ($db in @('Hub', 'Ingestion')) {
  az kusto database-principal-assignment create `
    --cluster-name <hub-cluster> --database-name $db -g <resource-group> `
    --principal-assignment-name mi-finops-dashboard-staging `
    --principal-id $mi --principal-type App --role Viewer --tenant-id <tenantId>
}
```

`Ingestion` is not optional. The Hub functions (`Costs()`, `Prices_v1_2()`, …) live in `Hub` but
resolve remote entities in `Ingestion`; without it every query fails with a Kusto **400**
(`SEM0056: Errors occurred while resolving remote entities. Database='Ingestion': Access denied`)
— not the 403 the symptom suggests.

Then grant access to the OpenAI resource:

```powershell
az role assignment create --assignee-object-id $mi --assignee-principal-type ServicePrincipal `
  --role "Cognitive Services OpenAI User" `
  --scope "/subscriptions/<sub>/resourceGroups/<openai-rg>/providers/Microsoft.CognitiveServices/accounts/<openai-resource>"
```

Restart the revision so the new permissions take effect:

```powershell
az containerapp revision restart -g <resource-group> -n app-finops-dashboard-staging --revision <revision>
```

## 7. Finish the Easy Auth loop

The reply URL only exists after deployment:

```powershell
./scripts/finish-entra-app.ps1 -AppId <clientId> -AppUrl <containerAppUrl>
```

Then assign `FinOps.Reader` / `FinOps.Admin` to the users or groups that need access.

## 8. Validate

```powershell
$base = '<containerAppUrl>'

# Anonymous: the only excluded path, and it reports the live ADX connection
Invoke-RestMethod "$base/api/health"
# -> {"status":"healthy","mode":"live","adx":{"connected":true,...}}

# Anonymous: every other path returns the Easy Auth redirect interstitial
(Invoke-WebRequest "$base/api/me" -SkipHttpErrorCheck).Content
# -> HTML that redirects to login.microsoftonline.com/<tenant>/oauth2/v2.0/authorize

# The MCP server must NOT answer from the internet
(Invoke-WebRequest "https://app-finops-dashboard-mcp-staging.internal.<domain>/mcp" `
  -Method Post -SkipHttpErrorCheck).StatusCode
# -> 404 "Azure Container App - Unavailable" (the edge refuses to route it)
```

`RedirectToLoginPage` returns **HTTP 200** with a client-side redirect page, not a 302 — a 200 on
a protected path is not a sign that auth is off. Check the body.

Then sign in through a browser and confirm real Hub data (`"isMock": false` in any
`/api/cost-summary/*` response) and a working chat reply.

## 10. Rotating the client secret

The secret lives in Key Vault; the Container App only holds a **versionless** reference, so a
rotation needs no redeployment — the platform re-reads the value on the next replica start.

Being Owner of the resource group is *not* enough to read it. RBAC-enabled vaults separate the
control plane from the data plane, so grant yourself a data-plane role first:

```powershell
$vault = az deployment group show -g <rg> -n <deployment> --query properties.outputs.keyVaultName.value -o tsv
$scope = az keyvault show -n $vault --query id -o tsv

az role assignment create --assignee-object-id (az ad signed-in-user show --query id -o tsv) `
  --assignee-principal-type User --role "Key Vault Secrets Officer" --scope $scope
```

Then mint a new credential and store it:

```powershell
$new = az ad app credential reset --id <clientId> --append --display-name rotation `
  --years 1 --query password -o tsv 2>$null

az keyvault secret set --vault-name $vault --name easy-auth-client-secret --value $new -o none
az containerapp revision restart -g <rg> -n app-finops-dashboard-staging --revision <revision>
```

`--query password -o tsv 2>$null` is not cosmetic. `az ad app credential reset` prints a warning
to stdout ahead of the JSON, so `ConvertFrom-Json` fails *after* the credential already exists —
leaving an orphaned secret whose value nobody captured.

Delete the old credential only once a real browser sign-in has succeeded with the new one:

```powershell
az ad app credential list --id <clientId> -o table
az ad app credential delete --id <clientId> --key-id <old-key-id>
```

Revoke your own data-plane role afterwards — the Managed Identity holds `Key Vault Secrets User`
and is the only principal that needs standing access.

---

## Troubleshooting

**Container App keeps restarting.** Read the system log for the reason and the console log for
the stack trace:

```powershell
az containerapp logs show -g <rg> -n <app> --type system --tail 30
az containerapp logs show -g <rg> -n <app> --type console --tail 60
```

**Sign-in fails at `/.auth/login/aad/callback` with HTTP 401 (substatus 73), in under ~2ms.**
The app registration has `web.implicitGrantSettings.enableIdTokenIssuance = false`. Easy Auth
uses the hybrid OIDC flow (`response_type=code+id_token`); without ID token issuance enabled,
Entra ID never returns an `id_token`, and Easy Auth rejects the callback locally — no useful
error reaches the container. `setup-entra-app.ps1` sets this flag; if the registration predates
that fix, enable it directly:

```powershell
$objId = az ad app show --id <clientId> --query id -o tsv
az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications/$objId" `
  --headers "Content-Type=application/json" `
  --body '{"web":{"implicitGrantSettings":{"enableIdTokenIssuance":true}}}'
```

No redeployment or restart needed — Entra ID reads the flag on the next login attempt.

**`az acr repository list` hangs.** It is a data-plane call and blocks when the registry has admin
disabled. Use the control plane instead: `az acr task list-runs -r <acr>`.

**Cost APIs return 500 while `/api/health` reports `connected: true`.** Missing `Viewer` on the
`Ingestion` database — see step 7.

**MCP fails with `'Server' object has no attribute 'list_tools'`.** `mcp` 2.0.0 removed the
low-level decorator the server is built on. `mcp/azure-pricing-mcp` pins `mcp<2.0.0` for that
reason; rebuild the image if the pin was lost.

More in [docs/troubleshooting.md](../../docs/operations/troubleshooting.md).

## Beyond this runbook

- CI/CD with GitHub Actions instead of manual `az acr build`
- VNet integration and private endpoints for ADX and OpenAI
- Custom domain and certificate
