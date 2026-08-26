// containerapp.bicep - Azure Container App for FinOps Dashboard
// Provisions: Log Analytics Workspace, Container App Environment, Container App
// Injects analytics backend configuration (ADX / Fabric / Foundry / None) via env vars.

param location string
param projectName string
param environment string

// Identity
param userAssignedIdentityId string
param userAssignedIdentityClientId string

// Container image and optional private registry
param containerImageUri string
param privateAcrServer string = ''

@description('Resource ID of the shared Container Apps Environment (see modules/environment.bicep).')
param containerAppEnvironmentId string

// Sizing
param containerCpu string = '0.5'
param containerMemory string = '1Gi'
param minReplicas int = 1
param maxReplicas int = 3

// Tags
param tags object = {}

// ─── Analytics Backend ────────────────────────────────────────────────────────
param analyticsBackend string = 'ADX'
param authMode string = 'ManagedIdentity'

// ADX
param adxClusterUri string = ''
param adxDatabaseName string = ''
param adxQueryTimeoutSeconds int = 30

// Fabric
param fabricQueryUri string = ''
param fabricWorkspaceId string = ''
param fabricKqlDatabaseName string = ''

// Foundry
param foundryProjectEndpoint string = ''
@secure()
param foundryProjectConnectionString string = ''
param foundryInferenceEndpoint string = ''
param foundryModelDeploymentName string = 'gpt-4o'
param foundryApiVersion string = '2025-01-01-preview'

// Legacy OpenAI
param azureOpenaiEndpoint string = ''
param azureOpenaiDeployment string = 'gpt-4o'

// MCP server URL
param mcpServerUrl string = 'http://localhost:8080'

@description('Internal URL of the Azure SKU Advisor API. Empty leaves the /sku-advisor view on its workspace-export / sample fallback.')
param skuAdvisorApiUrl string = ''

@description('Shared key sent to the SKU Advisor API as x-api-key.')
@secure()
param skuAdvisorApiKey string = ''

// Auth secrets
param spTenantId string = ''
param spClientId string = ''
@secure()
param spClientSecret string = ''
@secure()
param apiKey string = ''

// ─── Agentic FinOps (Azure Advisor via Resource Graph) ────────────────────────
@description('Subscription ID Azure Advisor recommendations are queried from for the Agentic FinOps view. Falls back to mock data when empty. The Managed Identity needs Reader on this subscription.')
param azureSubscriptionId string = ''

// ─── Key Vault secret references ──────────────────────────────────────────────
// When a URI is supplied the Container App stores a reference to the vault
// instead of the literal value, and resolves it at runtime with the
// User-Assigned Managed Identity. The identity needs "Key Vault Secrets User"
// on the vault before the first revision is created.

@description('Versionless Key Vault URI of the Easy Auth client secret. Takes precedence over easyAuthClientSecret.')
param easyAuthClientSecretUri string = ''

@description('Versionless Key Vault URI of the service principal client secret. Takes precedence over spClientSecret.')
param spClientSecretUri string = ''

@description('Versionless Key Vault URI of the backend API key. Takes precedence over apiKey.')
param apiKeyUri string = ''

@description('Versionless Key Vault URI of the Foundry connection string. Takes precedence over foundryProjectConnectionString.')
param foundryConnectionStringUri string = ''

@description('Versionless Key Vault URI of the SKU Advisor API key. When set it replaces the literal value, so the key can be rotated in the vault without a redeployment.')
param skuAdvisorApiKeyUri string = ''

@description('Ask the SKU Advisor to analyze the real VM inventory rather than its bundled sample. Requires the advisor itself to permit live reads.')
param skuAdvisorLiveUsage bool = false

@description('Comma-separated Azure regions the estate runs in. Live discovery is filtered by region; without this the advisor falls back to its own pricing region list and an estate outside it reports zero workloads.')
param skuAdvisorRegions string = ''

@description('Ask the SKU Advisor to source rightsizing telemetry (90-day P99 CPU/memory/IOPS busy-signal) live from Azure Monitor instead of skipping utilization-guided rightsizing. Requires the advisor itself to permit live reads and the Managed Identity to hold Reader/Monitoring Reader on the estate subscription.')
param skuAdvisorLiveTelemetry bool = false

// ─── Easy Auth (Microsoft Entra ID) ───────────────────────────────────────────
@description('Protect the public ingress with Container Apps built-in authentication (Easy Auth) using Microsoft Entra ID. Requires an existing app registration.')
param enableEasyAuth bool = false

@description('Application (client) ID of the Entra ID app registration used by Easy Auth.')
param easyAuthClientId string = ''

@description('Client secret of the Entra ID app registration used by Easy Auth. Ignored when easyAuthClientSecretUri is set.')
@secure()
param easyAuthClientSecret string = ''

@description('Tenant ID that issues the tokens accepted by Easy Auth. Defaults to the deployment tenant.')
param easyAuthTenantId string = ''

@description('Additional token audiences accepted by Easy Auth, beyond api://<clientId>.')
param easyAuthAllowedAudiences array = []

@description('Role granted to a signed-in user with no FinOps.Reader/FinOps.Admin app role assigned. "none" denies access.')
@allowed([
  'none'
  'Reader'
])
param authDefaultRole string = 'none'

// ============================================================================
// Variables
// ============================================================================

var containerAppName = 'app-${projectName}-${environment}'

// Easy Auth is driven solely by `enableEasyAuth`. It deliberately does NOT fall
// back to "disabled" when the app registration is incomplete: silently dropping
// the auth layer would publish an anonymous public ingress while the operator
// believes the dashboard is protected. A missing clientId/clientSecret makes the
// deployment fail instead — see docs/operations/security.md.
var easyAuthEnabled = enableEasyAuth
var easyAuthIssuerTenantId = empty(easyAuthTenantId) ? subscription().tenantId : easyAuthTenantId

// ─── Environment variables: always present ────────────────────────────────────
var baseEnvVars = [
  { name: 'NODE_ENV', value: 'production' }
  { name: 'ANALYTICS_BACKEND', value: analyticsBackend }
  { name: 'AUTH_MODE', value: authMode }
  { name: 'AZURE_PRICING_MCP_URL', value: mcpServerUrl }
  { name: 'SKU_ADVISOR_API_URL', value: skuAdvisorApiUrl }
  // Asks the advisor to discover the real VM inventory instead of using its
  // bundled sample. Without it the view can only ever show sample-derived
  // savings, so it is tied to the same opt-in that permits the advisor's
  // Managed Identity to read the estate.
  { name: 'SKU_ADVISOR_LIVE_USAGE', value: string(skuAdvisorLiveUsage) }
  { name: 'SKU_ADVISOR_REGIONS', value: skuAdvisorRegions }
  // Asks the advisor for a 90-day P99 CPU/memory/IOPS busy-signal from Azure
  // Monitor instead of skipping utilization-guided rightsizing entirely. Tied
  // to the same live-reads opt-in as SKU_ADVISOR_LIVE_USAGE.
  { name: 'SKU_ADVISOR_LIVE_TELEMETRY', value: string(skuAdvisorLiveTelemetry) }
  { name: 'NEXT_PUBLIC_USE_MOCK', value: analyticsBackend == 'None' ? 'true' : 'false' }
  { name: 'NEXT_PUBLIC_DEFAULT_BUDGET', value: '10000' }
  { name: 'NEXT_PUBLIC_DEFAULT_MONTHS', value: '6' }
  { name: 'NEXT_PUBLIC_DEFAULT_DAYS', value: '28' }
  { name: 'AZURE_CLIENT_ID', value: userAssignedIdentityClientId }
  // Single source of truth for the in-app auth layer: the middleware only trusts
  // the X-MS-CLIENT-PRINCIPAL header when the platform is actually validating it.
  // Emitted as an explicit literal because ARM's string(bool) casing is not
  // guaranteed to be lowercase.
  { name: 'AUTH_ENABLED', value: easyAuthEnabled ? 'true' : 'false' }
  { name: 'AUTH_DEFAULT_ROLE', value: authDefaultRole }
]

// ─── ADX env vars ────────────────────────────────────────────────────────────
var adxEnvVars = analyticsBackend == 'ADX' ? [
  { name: 'ADX_CLUSTER_URI', value: adxClusterUri }
  { name: 'ADX_DATABASE', value: adxDatabaseName }
  { name: 'ADX_QUERY_TIMEOUT_SECONDS', value: string(adxQueryTimeoutSeconds) }
] : []

// ─── Fabric env vars ─────────────────────────────────────────────────────────
var fabricEnvVarsWithUri = analyticsBackend == 'Fabric' && !empty(fabricQueryUri) ? [
  { name: 'FABRIC_QUERY_URI', value: fabricQueryUri }
] : []

var fabricEnvVarsWithIds = analyticsBackend == 'Fabric' && empty(fabricQueryUri) ? [
  { name: 'FABRIC_WORKSPACE_ID', value: fabricWorkspaceId }
  { name: 'FABRIC_KQL_DATABASE_NAME', value: fabricKqlDatabaseName }
] : []

// ─── Foundry env vars ────────────────────────────────────────────────────────
var foundryEnvVars = analyticsBackend == 'Foundry' ? [
  { name: 'AZURE_PROJECT_ENDPOINT', value: foundryProjectEndpoint }
  { name: 'AZURE_AI_INFERENCE_ENDPOINT', value: !empty(foundryInferenceEndpoint) ? foundryInferenceEndpoint : azureOpenaiEndpoint }
  { name: 'AZURE_MODEL_DEPLOYMENT_NAME', value: foundryModelDeploymentName }
  { name: 'AZURE_API_VERSION', value: foundryApiVersion }
  { name: 'AZURE_OPENAI_DEPLOYMENT', value: azureOpenaiDeployment }
] : []

// Legacy OpenAI env vars (injected even when analyticsBackend != Foundry, for chat features)
var openaiEnvVars = !empty(azureOpenaiEndpoint) ? [
  { name: 'AZURE_OPENAI_ENDPOINT', value: azureOpenaiEndpoint }
  { name: 'AZURE_OPENAI_DEPLOYMENT', value: azureOpenaiDeployment }
] : []

// ─── Service Principal env vars ───────────────────────────────────────────────
var spEnvVars = authMode == 'ServicePrincipal' ? [
  { name: 'AZURE_TENANT_ID', value: spTenantId }
  { name: 'AZURE_CLIENT_ID_SP', value: spClientId }
] : []

// ─── Agentic FinOps (Azure Advisor via Resource Graph) env vars ──────────────
// Read by src/lib/resource-graph-client.ts. Without it the Agentic FinOps view
// falls back to mock recommendations; the Managed Identity also needs Reader
// on this subscription for the Resource Graph query to return anything.
var agenticEnvVars = !empty(azureSubscriptionId) ? [
  { name: 'AZURE_SUBSCRIPTION_ID', value: azureSubscriptionId }
] : []

// ─── Merge all env vars ───────────────────────────────────────────────────────
var allEnvVars = union(
  baseEnvVars,
  adxEnvVars,
  fabricEnvVarsWithUri,
  fabricEnvVarsWithIds,
  foundryEnvVars,
  openaiEnvVars,
  spEnvVars,
  agenticEnvVars
)

// ─── Secrets (secure params or Key Vault references → Container App secrets) ──
// A Key Vault URI always wins over a literal value, so a deployment that
// supplies both never leaves the plain-text copy on the app.
var spSecretConfigured = authMode == 'ServicePrincipal' && (!empty(spClientSecret) || !empty(spClientSecretUri))
var apiKeyConfigured = authMode == 'ApiKey' && (!empty(apiKey) || !empty(apiKeyUri))
var foundrySecretConfigured = analyticsBackend == 'Foundry' && (!empty(foundryProjectConnectionString) || !empty(foundryConnectionStringUri))
// The advisor key is only useful when there is an advisor to call.
var skuAdvisorSecretConfigured = !empty(skuAdvisorApiUrl) && !empty(skuAdvisorApiKey)

var secretsList = union(
  spSecretConfigured ? [
    empty(spClientSecretUri)
      ? { name: 'sp-client-secret', value: spClientSecret }
      : { name: 'sp-client-secret', keyVaultUrl: spClientSecretUri, identity: userAssignedIdentityId }
  ] : [],
  apiKeyConfigured ? [
    empty(apiKeyUri)
      ? { name: 'api-key', value: apiKey }
      : { name: 'api-key', keyVaultUrl: apiKeyUri, identity: userAssignedIdentityId }
  ] : [],
  foundrySecretConfigured ? [
    empty(foundryConnectionStringUri)
      ? { name: 'foundry-connection-string', value: foundryProjectConnectionString }
      : { name: 'foundry-connection-string', keyVaultUrl: foundryConnectionStringUri, identity: userAssignedIdentityId }
  ] : [],
  easyAuthEnabled ? [
    empty(easyAuthClientSecretUri)
      ? { name: 'microsoft-provider-authentication-secret', value: easyAuthClientSecret }
      : { name: 'microsoft-provider-authentication-secret', keyVaultUrl: easyAuthClientSecretUri, identity: userAssignedIdentityId }
  ] : [],
  skuAdvisorSecretConfigured ? [
    empty(skuAdvisorApiKeyUri)
      ? { name: 'sku-advisor-api-key', value: skuAdvisorApiKey }
      : { name: 'sku-advisor-api-key', keyVaultUrl: skuAdvisorApiKeyUri, identity: userAssignedIdentityId }
  ] : []
)

// ─── Secret env var references ────────────────────────────────────────────────
var secretEnvRefs = union(
  spSecretConfigured ? [
    { name: 'SP_CLIENT_SECRET', secretRef: 'sp-client-secret' }
  ] : [],
  apiKeyConfigured ? [
    { name: 'API_KEY', secretRef: 'api-key' }
  ] : [],
  foundrySecretConfigured ? [
    { name: 'AZURE_AI_PROJECT_CONNECTION_STRING', secretRef: 'foundry-connection-string' }
  ] : [],
  skuAdvisorSecretConfigured ? [
    { name: 'SKU_ADVISOR_API_KEY', secretRef: 'sku-advisor-api-key' }
  ] : []
)

// ============================================================================
// Resources
// ============================================================================

// Container App (FinOps Dashboard)
resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${userAssignedIdentityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppEnvironmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      registries: empty(privateAcrServer) ? [] : [
        {
          server: privateAcrServer
          identity: userAssignedIdentityId
        }
      ]
      secrets: secretsList
    }
    template: {
      containers: [
        {
          name: 'dashboard'
          image: containerImageUri
          resources: {
            cpu: json(containerCpu)
            memory: containerMemory
          }
          env: union(allEnvVars, secretEnvRefs)
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: []
      }
    }
  }
  tags: tags
}

// ─── Easy Auth: Microsoft Entra ID in front of the public ingress ─────────────
// Without this, every /api/* route (cost data, ADX queries, the LLM agent) is
// reachable anonymously because the ingress is external.
resource authConfig 'Microsoft.App/containerApps/authConfigs@2024-03-01' = if (easyAuthEnabled) {
  parent: containerApp
  name: 'current'
  properties: {
    platform: {
      enabled: true
    }
    globalValidation: {
      unauthenticatedClientAction: 'RedirectToLoginPage'
      redirectToProvider: 'azureactivedirectory'
      // Health probes and platform checks must stay anonymous.
      excludedPaths: [
        '/api/health'
      ]
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          openIdIssuer: '${az.environment().authentication.loginEndpoint}${easyAuthIssuerTenantId}/v2.0'
          clientId: easyAuthClientId
          clientSecretSettingName: 'microsoft-provider-authentication-secret'
        }
        validation: {
          allowedAudiences: union([
            'api://${easyAuthClientId}'
            easyAuthClientId
          ], easyAuthAllowedAudiences)
        }
      }
    }
    login: {
      preserveUrlFragmentsForLogins: true
    }
  }
}

// ============================================================================
// Outputs
// ============================================================================

output containerAppUrl string = 'https://${containerApp.properties.configuration.ingress.fqdn}'
output containerAppId string = containerApp.id
output containerAppName string = containerApp.name
