# Security Baseline

## Principle of Least Privilege

This deployment follows the principle of least privilege. All components use only the minimum permissions required.

---

## Post-Deployment RBAC Checklist

After running the Bicep/ARM deployment, assign the following roles.

> **AcrPull is the only role the template can create for you.** It is controlled by the `grantAcrPull` parameter (default `true`), which requires **Owner** or **User Access Administrator** on the resource group. If you deploy with **Contributor** only, set `grantAcrPull` to `false` (uncheck "Grant AcrPull to the Container App identity" in the portal) — otherwise the deployment fails with `AuthorizationFailed` — and grant AcrPull manually using the commands below. All other role assignments (ADX, Azure OpenAI, Cost Management) must always be done manually.

### 1. ACR — AcrPull (required)

The Container App's Managed Identity must be able to pull images from ACR. Skip this step if the deployment ran with `grantAcrPull = true`.

```bash
# Get deployment outputs
RESOURCE_GROUP="<RESOURCE_GROUP>"
DEPLOYMENT_NAME="main"

IDENTITY_PRINCIPAL=$(az deployment group show \
  -g "$RESOURCE_GROUP" -n "$DEPLOYMENT_NAME" \
  --query "properties.outputs.managedIdentityPrincipalId.value" -o tsv)

ACR_ID=$(az deployment group show \
  -g "$RESOURCE_GROUP" -n "$DEPLOYMENT_NAME" \
  --query "properties.outputs.acrId.value" -o tsv)

az role assignment create \
  --assignee "$IDENTITY_PRINCIPAL" \
  --role AcrPull \
  --scope "$ACR_ID"
```

### 2. ADX — Database Viewer (if `analyticsBackend=ADX`)

Grant the Managed Identity read access to the ADX database. Use the ADX web UI or the KQL command:

```kql
.add database <DATABASE_NAME> viewers ('aadapp=<IDENTITY_PRINCIPAL_ID>')
```

Or with the Azure CLI (requires Kusto cluster Contributor):

```bash
az kusto database-principal-assignment create \
  --cluster-name <CLUSTER_NAME> \
  --database-name <DATABASE_NAME> \
  --resource-group <CLUSTER_RESOURCE_GROUP> \
  --principal-assignment-name finops-dashboard-viewer \
  --principal-id "$IDENTITY_PRINCIPAL" \
  --principal-type App \
  --role Viewer
```

### 3. Fabric — Workspace Viewer (if `analyticsBackend=Fabric`)

In the Microsoft Fabric portal:

1. Navigate to your workspace → **Manage access**.
2. Add the Managed Identity (search by Client ID or name) with **Viewer** role.

### 4. Azure AI Foundry — Azure AI User (if `analyticsBackend=Foundry`)

```bash
FOUNDRY_RESOURCE_ID="<FOUNDRY_RESOURCE_ID>"

az role assignment create \
  --assignee "$IDENTITY_PRINCIPAL" \
  --role "Azure AI User" \
  --scope "$FOUNDRY_RESOURCE_ID"
```

---

## Secrets Management

### Container App Secrets

Sensitive values (Service Principal client secret, API Key, Foundry connection string) are stored as **Container App secrets** — not in environment variable values. This means:

- Secrets are encrypted at rest.
- Secret values are not visible in deployment history or ARM state.
- Rotating a secret requires updating the Container App secret value (not a full redeployment).

To rotate a secret via CLI:

```bash
az containerapp secret set \
  --name ca-<PROJECT_NAME>-<ENV> \
  --resource-group <RESOURCE_GROUP> \
  --secrets "sp-client-secret=<NEW_VALUE>"

# Restart to pick up the new secret value
az containerapp revision restart \
  --name ca-<PROJECT_NAME>-<ENV> \
  --resource-group <RESOURCE_GROUP>
```

---

## Dashboard Access Control (Microsoft Entra ID)

The Container App is published on a **public ingress**, so authentication is applied in two layers:

| Layer | Where | What it does |
| --- | --- | --- |
| **Platform** | Container Apps built-in authentication (Easy Auth) | Validates the Entra ID token, blocks anonymous traffic, strips inbound `x-ms-client-principal-*` headers and injects its own validated `X-MS-CLIENT-PRINCIPAL`. |
| **Application** | `src/proxy.ts` + `src/lib/auth.ts` | Re-reads the validated principal, applies Reader/Admin authorization per route and method, and exposes the identity to the UI. |

The second layer exists because a misconfigured ingress, a direct call to the container, or an infra regression would otherwise expose cost data and the remediation endpoints.

### Trust contract

The app only trusts `X-MS-CLIENT-PRINCIPAL` when `AUTH_ENABLED=true`. That variable is injected by `containerapp.bicep` **from the same boolean that provisions the `authConfigs` resource**, so "the app trusts the header" and "the platform validates the header" cannot drift apart. Never set `AUTH_ENABLED` by hand in a deployed environment.

### Roles

Two app roles are published on the app registration:

| App role | Grants |
| --- | --- |
| `FinOps.Reader` | Read access to every dashboard and API read endpoint, including the LLM-backed endpoints that only query data. |
| `FinOps.Admin` | Everything a Reader can do, plus writes: `/api/remediation/execute`, `/api/config/save`, `/api/config/connect`, `/api/pricing/upload`, `/api/daily-insights/generate`, `/api/customers/active` and `/api/debug`. |

Authorization **fails closed**: any non-GET request is treated as a write and requires Admin, unless it is on the explicit read-only allowlist in `src/lib/auth-policy.ts`.

A user who signs in with no app role assigned is denied (`/forbidden`). Set `authDefaultRole = Reader` to instead grant read-only access to everyone who can sign in to the tenant.

### 1. Create the app registration (before deploying)

```powershell
# Creates the app, publishes FinOps.Reader / FinOps.Admin, enables ID token
# issuance, requires role assignment, and issues a client secret. Idempotent.
./scripts/setup-entra-app.ps1 -DisplayName "FinOps Dashboard" -AssignAdminToCurrentUser
```

> `-AssignAdminToCurrentUser` matters: with `authDefaultRole = none`, a deployment where nobody holds a role locks everyone out.

> The script sets `web.implicitGrantSettings.enableIdTokenIssuance = true` on the app
> registration. Container Apps Easy Auth drives a hybrid OIDC flow
> (`response_type=code+id_token`), and without this flag Entra ID never returns an
> `id_token` to `/.auth/login/aad/callback`. Every sign-in then fails with
> **HTTP 401, substatus 73**, in under a couple of milliseconds — no network call is
> made, so the container logs show nothing beyond the rejected request. If an app
> registration was created by hand (not through this script), enable it manually:
> `az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications/<objectId>" --body '{"web":{"implicitGrantSettings":{"enableIdTokenIssuance":true}}}'`.


### 2. Deploy

| Parameter | Description |
| --- | --- |
| `enableEasyAuth` | `true` by default. Requires Entra ID sign-in. |
| `easyAuthClientId` | Application (client) ID printed by the setup script. |
| `easyAuthClientSecret` | Client secret. Stored in Key Vault and surfaced to the Container App as the secret `microsoft-provider-authentication-secret` via a Key Vault reference. |
| `easyAuthTenantId` | Optional. Defaults to the deployment tenant. |
| `easyAuthAllowedAudiences` | Optional extra audiences, beyond `api://<clientId>` and `<clientId>`. |
| `authDefaultRole` | `none` (default) or `Reader` — access for a signed-in user with no app role. |

Setting `enableEasyAuth = true` without a client ID and secret **fails the deployment**. It does not silently fall back to an anonymous ingress.

### 3. Register the redirect URI (after deploying)

The Container App FQDN only exists after the deployment:

```powershell
./scripts/finish-entra-app.ps1 -AppId <clientId> `
  -ResourceGroup <RESOURCE_GROUP> -DeploymentName <DEPLOYMENT_NAME>
```

### 4. Assign users

In the enterprise application, assign `FinOps Reader` or `FinOps Admin` to the intended users/groups. `appRoleAssignmentRequired` is already enabled by the setup script, so unassigned users cannot sign in at all.

### Behaviour

- Unauthenticated browser requests are redirected to the Entra ID sign-in page; unauthenticated `/api/*` requests get `401` JSON.
- A signed-in user without the required role gets `403` JSON on `/api/*`, or the `/forbidden` page in the browser.
- `/api/health` is anonymous in **both** layers (`excludedPaths` in `containerapp.bicep` and `ANONYMOUS_PATHS` in `src/lib/auth-policy.ts`) so platform probes keep working. Keep the two lists in sync.
- Denied requests are logged as structured `authz.denied` events with the caller's object id.
- Sign-out is `/.auth/logout` — there is no app-managed session.

### Local development

With `npm run dev`, `AUTH_ENABLED` is unset, so the app never reads the client principal header and uses a synthetic `Local Dev` principal with the Admin role. A forged header cannot elevate anything, because when auth is not enforced the header is ignored entirely.

Validate the auth layer with:

```bash
npm run auth:test
```

### Not covered

Bearer/JWT validation for programmatic (non-browser) API callers and the MCP Functions App are out of scope for this layer. Do not expose those endpoints publicly without an equivalent control.

> If you disable Easy Auth, put an equivalent control in front of the app (Application Gateway/WAF with authentication, Front Door with private ingress, or IP restrictions). Do not expose the dashboard anonymously.

---

## No Admin Credentials in ACR

`adminUserEnabled` is set to `false` in the ACR configuration. The Container App pulls images using the Managed Identity with the **AcrPull** role. This eliminates shared admin passwords.

---

## No Hardcoded Secrets in Code or Templates

- Bicep templates use `@secure()` decorator for all credential parameters.
- The compiled `azuredeploy.json` contains no default values for `@secure()` parameters.
- The `infra/parameters/azuredeploy.parameters.example.bicepparam` file contains only `<PLACEHOLDER_*>` values.
- The `.gitignore` prevents accidental commit of `.env` files, `local.settings.json`, and Azure auth files.

---

## No Real Customer Names in the Repository

Customer *data* is excluded by `.gitignore` (`input/customer/**`, `output/`), and no cost
export has ever been committed. Customer **names** are a separate problem: comments, docs
and test fixtures naturally accumulate them ("measured on the X dataset"), and each one is
a disclosure to every other customer who is later shown this repository.

Use the neutral fixtures — `Contoso`, `fabrikam-br` — in tests, comments and documentation.
When a measurement needs attribution, describe the dataset instead of naming its owner
("a ~226k-row customer dataset", "a real AWS FOCUS export").

> **This convention only protects the current tree.** Git history keeps every name that was
> ever committed, so removing one today does not remove it from the past. Two consequences:
>
> - **Never fork or transfer this repository to a customer.** A fork carries the whole
>   history. Deliver the compiled artifacts instead — a container image and a
>   [Template Spec](../../README.md#publishing-a-template-spec) — which contain no history
>   and no comments.
> - **Making this repository public requires a history rewrite**, or a fresh repository
>   with a squashed initial commit. Auditing only the current tree is not sufficient.

---

## Network Security

By default, the Container App environment uses **public ingress** on HTTPS (443). All HTTP traffic is redirected to HTTPS by the Container Apps platform. Authentication on that public ingress is handled by Easy Auth — see [Dashboard Access Control](#dashboard-access-control-easy-auth-with-microsoft-entra-id).

For stricter network control:

- Enable **VNet integration** on the Container Apps Environment (requires Consumption Workload Profile or Dedicated plan).
- Add a **private endpoint** to the ACR (Premium SKU required).
- Restrict inbound access via **Container App ingress** rules.

---

## Monitoring & Audit

All container logs and platform metrics flow to the **Log Analytics Workspace** created by this deployment. Use KQL queries to investigate access patterns:

```kql
// Failed requests in the last 24 hours
ContainerAppConsoleLogs_CL
| where TimeGenerated > ago(24h)
| where Log contains "error" or Log contains "unauthorized"
| project TimeGenerated, ContainerName_s, Log
| order by TimeGenerated desc
```

---

## Key Vault

Secrets are held in Azure Key Vault, not in the Container App. The template provisions the vault
by default (`deployKeyVault=true`), writes whichever secrets were supplied, and gives the
Container App a **reference** — `keyVaultUrl` plus the identity to read it with — rather than a
literal value.

| Parameter | Default | Description |
| --- | --- | --- |
| `deployKeyVault` | `true` | Create the vault and store the supplied secrets in it. |
| `keyVaultName` | generated | Override the generated name (`kv-<project><env>-<hash>`, ≤ 24 chars). |
| `keyVaultPurgeProtection` | `false` | Enable for production. **Irreversible** once on. |
| `easyAuthClientSecretUri` | `''` | Bring your own vault — a secret URI to reference instead. |

Secrets written by the template: `easy-auth-client-secret`, `sp-client-secret`, `api-key`,
`foundry-connection-string`. Only the ones actually passed to the deployment are created.

### What this does and does not buy you

It removes the secret from the Container App resource, gives you rotation without redeployment,
and puts every read behind an auditable RBAC grant. It does **not** keep the secret out of the
deployment itself: an ARM deployment still carries the value as a `secureString`. The vault is
where the secret comes to rest, not how it gets there.

### Access model

The vault uses `enableRbacAuthorization: true`. Access policies are not used.

- The Managed Identity gets **Key Vault Secrets User** — read only, scoped to this vault.
- Nobody else gets standing access. Being **Owner of the resource group does not grant
  data-plane access**; `az keyvault secret list` returns `ForbiddenByRbac` for a subscription
  Owner. That is the intended behaviour, not a misconfiguration.
- An operator who needs to read or rotate a secret grants themselves **Key Vault Secrets
  Officer** on the vault, does the work, and removes the assignment. See the rotation runbook in
  [../DEPLOY.md](../../apps/finops-dashboard/DEPLOY.md).

The secret URI is deliberately **versionless**, so rotating the value in the vault propagates on
the next replica start without touching the Container App or its revision.

Soft delete is on with a 90-day retention. Purge protection is off by default because enabling it
cannot be undone — a vault name is then unusable for the retention period, which is unforgiving
in a test subscription. Turn it on for production.

### Bringing your own vault

Set `deployKeyVault=false` and pass the secret URIs instead of the values:

```powershell
az deployment group create -g <rg> -f infra/bicep/finops-dashboard/main.bicep --parameters `
  deployKeyVault=false `
  easyAuthClientSecretUri=https://<vault>.vault.azure.net/secrets/easy-auth-client-secret
```

The Managed Identity is created by the template, so grant it `Key Vault Secrets User` on your
vault after the first deployment and restart the revision.
