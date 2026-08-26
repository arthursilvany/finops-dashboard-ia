# Infrastructure reference

This document is the authoritative reference for the Bicep infrastructure under
`infra/bicep/finops-dashboard/`. It covers every module, its parameters, its
outputs, and the dependency graph that `main.bicep` composes them into.

For deployment procedures, see [`../operations/deployment.md`](../operations/deployment.md)
and [`../../apps/finops-dashboard/DEPLOY.md`](../../apps/finops-dashboard/DEPLOY.md).  
For RBAC and security baseline, see [`../operations/security.md`](../operations/security.md).

---

## ⚠ Invariants

Two rules that are not visible from any single file. The first is enforced by CI;
the second is not, and has to be held by hand.

> **`infra/arm/azuredeploy.json` is a compiled artifact.** It is generated from
> `main.bicep` and must **never** be edited by hand. After any change to a file
> under `infra/bicep/`, recompile and commit the result in the same change:
>
> ```bash
> az bicep build \
>   --file infra/bicep/finops-dashboard/main.bicep \
>   --outfile infra/arm/azuredeploy.json
> ```
>
> The `infra` CI job recompiles and fails if the committed JSON differs from the
> Bicep source. See [`../../AGENTS.md`](../../AGENTS.md) for the canonical rule.

> **The anonymous path allowlist is duplicated by design.** Dashboard sign-in is
> enforced by two independent layers: Container Apps Easy Auth (platform) and the
> Next.js middleware (application). The list of paths that bypass authentication
> must be kept in sync across **both**:
>
> - `excludedPaths` in [`infra/bicep/finops-dashboard/modules/containerapp.bicep`](../../infra/bicep/finops-dashboard/modules/containerapp.bicep) — controls the platform layer.
> - `ANONYMOUS_PATHS` in [`apps/finops-dashboard/src/lib/auth-policy.ts`](../../apps/finops-dashboard/src/lib/auth-policy.ts) — controls the application layer.
>
> Adding a path to one side without the other creates a route that one layer
> allows and the other denies. **Nothing in CI checks this** — the two lists are
> kept in sync by review. See [`../../AGENTS.md`](../../AGENTS.md).

---

## Overview

A single deployment creates the following Azure resources:

```
main.bicep
├── identities          → User-Assigned Managed Identity
├── appEnvironment      → Container Apps Environment + Log Analytics Workspace
├── keyVault [optional] → Key Vault for application secrets  (depends on identities)
├── mcpServer [optional]→ Azure Pricing MCP Container App (depends on appEnvironment, identities)
└── containerApp        → FinOps Dashboard Container App   (depends on all of the above)
```

`identities` and `appEnvironment` deploy in parallel. The dashboard and optional
MCP Container Apps pull versioned public GHCR images by default. A private
custom registry can be supplied, but it must already contain the selected
images and the identity must already have pull access.

The MCP server is conditional on `deployMcp=true`. Azure SKU Advisor is an
external project and is integrated through `skuAdvisorApiUrl`; the dashboard
falls back to workspace-export or sample data when that URL is empty.

---

## `main.bicep`

**File:** `infra/bicep/finops-dashboard/main.bicep`  
**Target scope:** `resourceGroup`

The orchestrator. Declares all parameters, constructs the `commonTags` object,
wires module outputs into downstream module parameters, resolves the effective
Key Vault secret URIs, and surfaces the most useful resource identifiers as
outputs.

### Deployment order

ARM evaluates module dependencies automatically, but the logical order is:

1. `identities` — no dependencies.
2. `appEnvironment` — no dependencies.
3. `keyVault` — depends on `identities.outputs.userAssignedIdentityPrincipalId`.
4. `mcpServer` — conditional; depends on `appEnvironment` and `identities`.
5. `containerApp` — depends on the shared environment, identity, optional MCP,
   and optional Key Vault.

### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `location` | string | `resourceGroup().location` | Azure region for all resources. |
| `projectName` | string | `'finops-dashboard'` | Prefix for resource names. 3–20 chars, lowercase alphanumeric and hyphens. |
| `environment` | string | `'prod'` | Deployment stage. Allowed: `dev`, `poc`, `staging`, `prod`. |
| `dashboardImageUri` | string | `ghcr.io/...-dashboard:1.0.0` | Full versioned dashboard image URI. |
| `mcpImageUri` | string | `ghcr.io/...-azure-pricing-mcp:1.0.0` | Full versioned Azure Pricing MCP image URI. |
| `deployMcp` | bool | `false` | Deploy the pricing MCP server as an internal Container App. |
| `privateAcrServer` | string | `''` | Private ACR login server for custom images. Empty uses anonymous public pulls. |
| `skuAdvisorApiUrl` | string | `''` | Base URL of an independently deployed SKU Advisor API. |
| `skuAdvisorApiKey` | string (secure) | `''` | Shared key the dashboard sends to the SKU Advisor as `x-api-key`. |
| `skuAdvisorLiveUsage` | bool | `false` | Ask the external advisor to use live inventory. |
| `skuAdvisorRegions` | string | `''` | Comma-separated Azure regions the estate runs in (e.g. `uksouth,swedencentral`). |
| `containerCpu` | string | `'0.5'` | vCPU for the dashboard. Allowed: `0.25`, `0.5`, `1.0`, `2.0`. |
| `containerMemory` | string | `'1Gi'` | Memory for the dashboard. Allowed: `0.5Gi`, `1Gi`, `2Gi`, `4Gi`. |
| `minReplicas` | int | `1` | Minimum replicas. `0` enables scale-to-zero. Range: 0–10. |
| `maxReplicas` | int | `3` | Maximum replicas. Range: 1–30. |
| `logRetentionDays` | int | `30` | Log Analytics retention in days. Range: 30–730. |
| `analyticsBackend` | string | `'ADX'` | Cost data backend. Allowed: `None`, `ADX`, `Fabric`, `Foundry`. |
| `adxClusterUri` | string | `''` | ADX cluster URI. Required when `analyticsBackend=ADX`. |
| `adxDatabaseName` | string | `''` | ADX database name. Required when `analyticsBackend=ADX`. |
| `adxQueryTimeoutSeconds` | int | `30` | ADX query timeout in seconds. |
| `azureSubscriptionId` | string | `subscription().subscriptionId` | Subscription the Agentic FinOps view queries for Azure Advisor recommendations. |
| `fabricQueryUri` | string | `''` | Fabric Eventhouse query URI. Used when `analyticsBackend=Fabric`. |
| `fabricWorkspaceId` | string | `''` | Fabric workspace ID (alternative to `fabricQueryUri`). |
| `fabricKqlDatabaseName` | string | `''` | Fabric KQL database name. Used with `fabricWorkspaceId`. |
| `foundryProjectEndpoint` | string | `''` | Azure AI Foundry project endpoint. Used when `analyticsBackend=Foundry`. |
| `foundryProjectConnectionString` | string (secure) | `''` | Foundry project connection string (optional, `AIProjectClient` path). |
| `foundryInferenceEndpoint` | string | `''` | Foundry inference endpoint. |
| `foundryModelDeploymentName` | string | `'gpt-4o'` | Foundry model deployment name. |
| `foundryApiVersion` | string | `'2025-01-01-preview'` | Foundry API version. |
| `azureOpenaiEndpoint` | string | `''` | Legacy Azure OpenAI endpoint. Use `foundryInferenceEndpoint` for new deployments. |
| `azureOpenaiDeployment` | string | `'gpt-4o'` | Legacy Azure OpenAI model deployment name. |
| `authMode` | string | `'ManagedIdentity'` | Backend auth mode. Allowed: `ManagedIdentity`, `ServicePrincipal`, `ApiKey`. |
| `spTenantId` | string | `''` | SP tenant ID. Required when `authMode=ServicePrincipal`. |
| `spClientId` | string | `''` | SP client (application) ID. Required when `authMode=ServicePrincipal`. |
| `spClientSecret` | string (secure) | `''` | SP client secret. Required when `authMode=ServicePrincipal`. |
| `apiKey` | string (secure) | `''` | Static API key. Required when `authMode=ApiKey`. |
| `enableEasyAuth` | bool | `true` | Protect the public ingress with Container Apps Easy Auth (Microsoft Entra ID). |
| `easyAuthClientId` | string | `''` | Entra ID app registration client ID. Required when `enableEasyAuth=true`. |
| `easyAuthClientSecret` | string (secure) | `''` | Entra ID app registration client secret. Required when `enableEasyAuth=true`. |
| `easyAuthTenantId` | string | `''` | Tenant that issues tokens. Defaults to the deployment tenant. |
| `easyAuthAllowedAudiences` | array | `[]` | Additional token audiences accepted by Easy Auth beyond `api://<clientId>`. |
| `authDefaultRole` | string | `'none'` | Role for a signed-in user with no app role assigned. `none` denies; `Reader` grants read-only. |
| `easyAuthClientSecretUri` | string | `''` | Versionless Key Vault URI of an Easy Auth secret you manage externally. Prevents the secret being passed to this deployment. |
| `deployKeyVault` | bool | `true` | Deploy a Key Vault and store secrets as vault references instead of literal values. |
| `keyVaultName` | string | `''` | Override the generated vault name (must be globally unique, ≤24 chars). |
| `keyVaultPurgeProtection` | bool | `false` | Block permanent deletion. Irreversible once enabled; leave off unless required. |
| `additionalTags` | object | `{}` | Extra tags merged with the standard `environment`, `managedBy`, `project`, `analyticsBackend` tags. |

### Outputs

| Name | Type | Description |
|------|------|-------------|
| `resourceGroupName` | string | Resource group where resources were deployed. |
| `resourceGroupLocation` | string | Azure region of the deployment. |
| `containerAppUrl` | string | Public HTTPS URL of the FinOps Dashboard. |
| `containerAppName` | string | Container App resource name. |
| `containerAppEnvironmentName` | string | Container Apps Environment resource name. |
| `logAnalyticsWorkspaceId` | string | Log Analytics Workspace resource ID. |
| `logAnalyticsWorkspaceName` | string | Log Analytics Workspace name. |
| `managedIdentityId` | string | User-Assigned Managed Identity resource ID. |
| `managedIdentityPrincipalId` | string | Principal ID — use for RBAC assignments on backend resources. |
| `managedIdentityClientId` | string | Client ID injected into containers as `AZURE_CLIENT_ID`. |
| `mcpServerUrl` | string | Internal URL of the pricing MCP server, or `Not deployed`. |
| `skuAdvisorUrl` | string | Configured external SKU Advisor URL, or `Not configured`. |
| `keyVaultName` | string | Key Vault name, or `Not deployed`. |
| `keyVaultUri` | string | Key Vault base URI for secret rotation, or `Not deployed`. |
| `analyticsBackendConfigured` | string | Analytics backend that was configured. |
| `authModeConfigured` | string | Authentication mode that was configured. |

---

## Module: `identities.bicep`

**File:** `infra/bicep/finops-dashboard/modules/identities.bicep`  
**Purpose:** Creates the single User-Assigned Managed Identity shared by every
Container App in the deployment.  
**Depends on:** nothing.

The identity authenticates to Key Vault, ADX, Fabric, and Azure Resource Graph.
It is also used for a private ACR when `privateAcrServer` is
set. Public GHCR defaults require no registry credentials.

Resource naming: `mi-<projectName>-<environment>`

### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `location` | string | _(required)_ | Azure region. |
| `projectName` | string | _(required)_ | Resource name prefix. |
| `environment` | string | _(required)_ | Deployment stage. |
| `tags` | object | `{}` | Resource tags. |

### Outputs

| Name | Type | Description |
|------|------|-------------|
| `userAssignedIdentityId` | string | Resource ID of the identity — used in Container App `identity` blocks. |
| `userAssignedIdentityClientId` | string | Client ID — injected as `AZURE_CLIENT_ID` so `DefaultAzureCredential` resolves it. |
| `userAssignedIdentityPrincipalId` | string | Object ID — used when creating RBAC role assignments. |

---

## Module: `environment.bicep`

**File:** `infra/bicep/finops-dashboard/modules/environment.bicep`  
**Purpose:** Provisions the shared Container Apps Environment and its backing
Log Analytics Workspace.  
**Depends on:** nothing.

This module was extracted from `containerapp.bicep` so that the dashboard and
the MCP server can share a single environment. Sharing the environment is what
enables internal-ingress communication between apps: the MCP server's FQDN is
only resolvable from within the same environment.

Resource naming:
- Container Apps Environment: `env-<projectName>-<environment>`
- Log Analytics Workspace: `log-<projectName>-<environment>`

### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `location` | string | _(required)_ | Azure region. |
| `projectName` | string | _(required)_ | Resource name prefix. |
| `environment` | string | _(required)_ | Deployment stage. |
| `logRetentionDays` | int | `30` | Log Analytics data retention in days. |
| `tags` | object | `{}` | Resource tags. |

### Outputs

| Name | Type | Description |
|------|------|-------------|
| `environmentId` | string | Resource ID passed to every Container App as `managedEnvironmentId`. |
| `environmentName` | string | Resource name of the environment. |
| `defaultDomain` | string | Domain suffix for internal FQDNs (e.g. `<app>.internal.<defaultDomain>`). |
| `logAnalyticsWorkspaceId` | string | Resource ID of the Log Analytics Workspace. |
| `logAnalyticsWorkspaceName` | string | Resource name of the Log Analytics Workspace. |

---

## Module: `containerapp.bicep`

**File:** `infra/bicep/finops-dashboard/modules/containerapp.bicep`  
**Purpose:** Provisions the main FinOps Dashboard Container App with external
HTTPS ingress, and optionally attaches Easy Auth (Microsoft Entra ID) in front
of that ingress.  
**Depends on:** `identities`, `appEnvironment`, and (when used)
`keyVault` and `mcpServer`.

The module wires all analytics backend choices, authentication modes, and
optional Key Vault references into a single `containerApps` resource. Key points:

- Only the `analyticsBackend`-relevant environment variables are injected; unused
  backend variables are dropped via the `union()` pattern.
- A Key Vault URI always takes precedence over a literal secret value. Supplying
  both is safe — the literal is ignored.
- `enableEasyAuth` has a **fail-loud** design: if `easyAuthClientId` or the
  secret are missing when `enableEasyAuth=true`, the deployment fails rather than
  silently dropping the auth layer.
- The `excludedPaths` under Easy Auth currently contains only `/api/health`.
  Any path added here must also be added to `ANONYMOUS_PATHS` in
  `apps/finops-dashboard/src/lib/auth-policy.ts` — see the [invariant](#-invariants)
  above.

Resource naming: `app-<projectName>-<environment>`

### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `location` | string | _(required)_ | Azure region. |
| `projectName` | string | _(required)_ | Resource name prefix. |
| `environment` | string | _(required)_ | Deployment stage. |
| `userAssignedIdentityId` | string | _(required)_ | Resource ID of the managed identity. |
| `userAssignedIdentityClientId` | string | _(required)_ | Client ID injected as `AZURE_CLIENT_ID`. |
| `containerImageUri` | string | _(required)_ | Full image URI. |
| `privateAcrServer` | string | `''` | Private ACR login server. Empty omits registry credentials for public images. |
| `containerAppEnvironmentId` | string | _(required)_ | Resource ID of the Container Apps Environment. |
| `containerCpu` | string | `'0.5'` | vCPU allocation. |
| `containerMemory` | string | `'1Gi'` | Memory allocation. |
| `minReplicas` | int | `1` | Minimum replicas. |
| `maxReplicas` | int | `3` | Maximum replicas. |
| `tags` | object | `{}` | Resource tags. |
| `analyticsBackend` | string | `'ADX'` | Active analytics backend. |
| `authMode` | string | `'ManagedIdentity'` | Backend authentication mode. |
| `adxClusterUri` | string | `''` | ADX cluster URI. Injected as `ADX_CLUSTER_URI`. |
| `adxDatabaseName` | string | `''` | ADX database name. Injected as `ADX_DATABASE`. |
| `adxQueryTimeoutSeconds` | int | `30` | ADX query timeout. Injected as `ADX_QUERY_TIMEOUT_SECONDS`. |
| `fabricQueryUri` | string | `''` | Fabric query URI. Injected as `FABRIC_QUERY_URI`. |
| `fabricWorkspaceId` | string | `''` | Fabric workspace ID. Injected as `FABRIC_WORKSPACE_ID`. |
| `fabricKqlDatabaseName` | string | `''` | Fabric KQL database name. Injected as `FABRIC_KQL_DATABASE_NAME`. |
| `foundryProjectEndpoint` | string | `''` | Foundry project endpoint. Injected as `AZURE_PROJECT_ENDPOINT`. |
| `foundryProjectConnectionString` | string (secure) | `''` | Foundry connection string. Injected as secret `foundry-connection-string`. |
| `foundryInferenceEndpoint` | string | `''` | Foundry inference endpoint. Injected as `AZURE_AI_INFERENCE_ENDPOINT`. |
| `foundryModelDeploymentName` | string | `'gpt-4o'` | Foundry model name. Injected as `AZURE_MODEL_DEPLOYMENT_NAME`. |
| `foundryApiVersion` | string | `'2025-01-01-preview'` | Foundry API version. Injected as `AZURE_API_VERSION`. |
| `azureOpenaiEndpoint` | string | `''` | Legacy OpenAI endpoint. Injected as `AZURE_OPENAI_ENDPOINT`. |
| `azureOpenaiDeployment` | string | `'gpt-4o'` | Legacy OpenAI deployment. Injected as `AZURE_OPENAI_DEPLOYMENT`. |
| `mcpServerUrl` | string | `'http://localhost:8080'` | Internal URL of the pricing MCP server. Injected as `AZURE_PRICING_MCP_URL`. |
| `skuAdvisorApiUrl` | string | `''` | Internal URL of the SKU Advisor API. Injected as `SKU_ADVISOR_API_URL`. |
| `skuAdvisorApiKey` | string (secure) | `''` | Shared API key for the SKU Advisor. Injected as secret `sku-advisor-api-key`. |
| `skuAdvisorLiveUsage` | bool | `false` | Tell the dashboard to request live inventory from the advisor. Injected as `SKU_ADVISOR_LIVE_USAGE`. |
| `skuAdvisorRegions` | string | `''` | Estate regions. Injected as `SKU_ADVISOR_REGIONS`. |
| `spTenantId` | string | `''` | SP tenant ID. Injected as `AZURE_TENANT_ID`. |
| `spClientId` | string | `''` | SP client ID. Injected as `AZURE_CLIENT_ID_SP`. |
| `spClientSecret` | string (secure) | `''` | SP client secret. Injected as secret `sp-client-secret`. |
| `apiKey` | string (secure) | `''` | Static API key. Injected as secret `api-key`. |
| `azureSubscriptionId` | string | `''` | Subscription for the Agentic FinOps view. Injected as `AZURE_SUBSCRIPTION_ID`. |
| `easyAuthClientSecretUri` | string | `''` | Versionless Key Vault URI for the Easy Auth secret. |
| `spClientSecretUri` | string | `''` | Versionless Key Vault URI for the SP client secret. |
| `apiKeyUri` | string | `''` | Versionless Key Vault URI for the static API key. |
| `foundryConnectionStringUri` | string | `''` | Versionless Key Vault URI for the Foundry connection string. |
| `skuAdvisorApiKeyUri` | string | `''` | Versionless Key Vault URI for the SKU Advisor API key. |
| `enableEasyAuth` | bool | `false` | Enable Easy Auth on the container app. _(Note: `main.bicep` defaults this to `true`.)_ |
| `easyAuthClientId` | string | `''` | Entra ID app registration client ID for Easy Auth. |
| `easyAuthClientSecret` | string (secure) | `''` | Entra ID app registration client secret. Ignored when `easyAuthClientSecretUri` is set. |
| `easyAuthTenantId` | string | `''` | Issuing tenant for Easy Auth tokens. |
| `easyAuthAllowedAudiences` | array | `[]` | Additional token audiences. |
| `authDefaultRole` | string | `'none'` | Default role for authenticated users with no app role. |

### Outputs

| Name | Type | Description |
|------|------|-------------|
| `containerAppUrl` | string | Public HTTPS URL (`https://<fqdn>`). |
| `containerAppId` | string | Resource ID of the Container App. |
| `containerAppName` | string | Resource name of the Container App. |

---

## Module: `keyvault.bicep`

**File:** `infra/bicep/finops-dashboard/modules/keyvault.bicep`  
**Purpose:** Provisions a Key Vault for application secrets and stores the
caller-supplied secrets inside it, returning versionless URIs the Container App
uses as secret references.  
**Depends on:** `identities` (for `readerPrincipalId`).

Using Key Vault references means rotating a secret is a vault operation — no
redeployment required. The vault uses RBAC authorization; the managed identity
is granted `Key Vault Secrets User` (read-only) via a role assignment created
in this module.

The caller decides which secrets to write by passing boolean `store*` flags.
This avoids placing a secure parameter in an output expression (which the Bicep
linter treats as a potential leak).

Resource naming (when `keyVaultName` is empty):  
`kv-<truncated projectName>-<truncated environment>-<uniqueString(resourceGroup().id)[:6]>`

### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `location` | string | _(required)_ | Azure region. |
| `projectName` | string | _(required)_ | Resource name prefix (up to 10 chars used after stripping hyphens). |
| `environment` | string | _(required)_ | Deployment stage (up to 4 chars used). |
| `keyVaultName` | string | `''` | Override the generated vault name. |
| `readerPrincipalId` | string | `''` | Principal ID that receives `Key Vault Secrets User`. |
| `enablePurgeProtection` | bool | `false` | Block permanent deletion. Irreversible once enabled. |
| `softDeleteRetentionInDays` | int | `90` | Days a soft-deleted vault or secret remains recoverable. Range: 7–90. |
| `easyAuthClientSecret` | string (secure) | `''` | Easy Auth client secret value to store. |
| `spClientSecret` | string (secure) | `''` | SP client secret value to store. |
| `apiKey` | string (secure) | `''` | Static API key value to store. |
| `foundryProjectConnectionString` | string (secure) | `''` | Foundry connection string value to store. |
| `skuAdvisorApiKey` | string (secure) | `''` | SKU Advisor API key value to store. |
| `storeEasyAuthClientSecret` | bool | `false` | Write `easyAuthClientSecret` to the vault. |
| `storeSpClientSecret` | bool | `false` | Write `spClientSecret` to the vault. |
| `storeApiKey` | bool | `false` | Write `apiKey` to the vault. |
| `storeFoundryConnectionString` | bool | `false` | Write `foundryProjectConnectionString` to the vault. |
| `storeSkuAdvisorApiKey` | bool | `false` | Write `skuAdvisorApiKey` to the vault. |
| `tags` | object | `{}` | Resource tags. |

### Outputs

| Name | Type | Description |
|------|------|-------------|
| `keyVaultId` | string | Resource ID of the vault. |
| `keyVaultName` | string | Vault name. |
| `keyVaultUri` | string | Base URI of the vault (e.g. `https://<name>.vault.azure.net/`). |
| `easyAuthClientSecretUri` | string | Versionless URI of the Easy Auth secret, or `''` when not stored. |
| `spClientSecretUri` | string | Versionless URI of the SP client secret, or `''` when not stored. |
| `apiKeyUri` | string | Versionless URI of the static API key, or `''` when not stored. |
| `foundryConnectionStringUri` | string | Versionless URI of the Foundry connection string, or `''` when not stored. |
| `skuAdvisorApiKeyUri` | string | Versionless URI of the SKU Advisor API key, or `''` when not stored. |

---

## Module: `mcp-containerapp.bicep`

**File:** `infra/bicep/finops-dashboard/modules/mcp-containerapp.bicep`  
**Purpose:** Provisions the Azure Pricing MCP server as an **internal-ingress**
Container App on port 8080.  
**Depends on:** `identities`, `appEnvironment`.

The MCP server has no built-in authentication, which is why its ingress is
internal (`external: false`). It is only reachable from other apps inside the
same Container Apps Environment. The dashboard communicates with it at
`https://<name>.internal.<defaultDomain>`.

`minReplicas` defaults to `1` (not zero) because the MCP client maintains a
session; scaling to zero would add a cold start to every pricing lookup.

Resource naming: `app-<projectName>-mcp-<environment>`

### Parameters

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `location` | string | _(required)_ | Azure region. |
| `projectName` | string | _(required)_ | Resource name prefix. |
| `environment` | string | _(required)_ | Deployment stage. |
| `containerAppEnvironmentId` | string | _(required)_ | Resource ID of the shared environment. |
| `userAssignedIdentityId` | string | _(required)_ | Resource ID of the managed identity. |
| `userAssignedIdentityClientId` | string | _(required)_ | Client ID injected as `AZURE_CLIENT_ID`. |
| `containerImageUri` | string | _(required)_ | Full image URI. |
| `privateAcrServer` | string | `''` | Private ACR login server. Empty omits registry credentials for public images. |
| `containerCpu` | string | `'0.5'` | vCPU allocation. |
| `containerMemory` | string | `'1Gi'` | Memory allocation. |
| `minReplicas` | int | `1` | Minimum replicas. Keep ≥ 1 to avoid session cold-start. |
| `maxReplicas` | int | `2` | Maximum replicas. |
| `tags` | object | `{}` | Resource tags. |

### Outputs

| Name | Type | Description |
|------|------|-------------|
| `mcpServerUrl` | string | Internal HTTPS URL. Only resolvable inside the environment. |
| `containerAppName` | string | Resource name of the Container App. |
| `containerAppId` | string | Resource ID of the Container App. |

---

## Identity and RBAC

`identities.bicep` creates a single User-Assigned Managed Identity. Role
assignments happen in two places:

### Assigned in Bicep (automatic)

| Role | Scope | Module | Condition |
|------|-------|--------|-----------|
| `Key Vault Secrets User` | Key Vault resource | `keyvault.bicep` | `readerPrincipalId` is non-empty |

### Assigned manually after deployment

| Role | Scope | Tool | Notes |
|------|-------|------|-------|
| ADX `Database Viewer` | ADX Hub and Ingestion databases | [`infra/scripts/grant-adx-access.sh`](../../infra/scripts/README.md) | Required when `analyticsBackend=ADX`. The Bicep template cannot reach the external ADX cluster. |
| `Reader` | Subscription | Azure Portal or CLI | Required when `azureSubscriptionId` is set and the Agentic FinOps view needs to query Azure Advisor via Resource Graph. |
| Fabric KQL query permissions | Fabric Workspace | Fabric Admin | Required when `analyticsBackend=Fabric`. |
| Azure AI Foundry contributor | Foundry project | Azure Portal or CLI | Required when `analyticsBackend=Foundry`. |
| `AcrPull` | Private custom ACR | Azure Portal or CLI | Required only when `privateAcrServer` references a private ACR. |

See [`../operations/security.md`](../operations/security.md) for the complete
security baseline, RBAC steps, and Easy Auth setup.

### ADX post-deployment grant

`grant-adx-access.sh` reads the managed identity's principal ID from the
deployment output `managedIdentityPrincipalId` and creates `DatabaseViewer`
principal assignments on the specified databases. The FinOps Hub uses two
databases (`Hub` and `Ingestion`), so both must be granted:

```bash
./infra/scripts/grant-adx-access.sh \
  --resource-group         rg-finops-dashboard \
  --cluster-name           mykustocluster \
  --cluster-resource-group rg-adx
```

See [`../../infra/scripts/README.md`](../../infra/scripts/README.md) for full
usage.

---

## Deploying

See [`../operations/deployment.md`](../operations/deployment.md) for environment
prerequisites, parameter file guidance, and the step-by-step deployment
procedure.

See [`../../apps/finops-dashboard/DEPLOY.md`](../../apps/finops-dashboard/DEPLOY.md)
for the end-to-end production deployment checklist including CI/CD pipeline
setup, image push, and post-deploy smoke tests.
