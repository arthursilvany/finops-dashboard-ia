// main.bicep - FinOps Dashboard Infrastructure Orchestrator
// Deploys: Azure Container Registry, Container Apps Environment, Container App,
//          Log Analytics Workspace, User-Assigned Managed Identity
//
// Supports analytics backends: None | ADX | Fabric | Foundry
// Supports auth modes:         ManagedIdentity | ServicePrincipal | ApiKey

targetScope = 'resourceGroup'

// ============================================================================
// Core Parameters
// ============================================================================

@description('Azure region for all resources. Defaults to the resource group location.')
param location string = resourceGroup().location

@description('Project name used as a prefix for resource names. Lowercase alphanumeric and hyphens only.')
@minLength(3)
@maxLength(20)
param projectName string = 'finops-dashboard'

@description('Deployment environment tag (e.g., dev, staging, prod).')
@allowed(['dev', 'poc', 'staging', 'prod'])
param environment string = 'prod'

// ============================================================================
// Container Image Parameters
// ============================================================================

@description('Dashboard container image name and tag stored in ACR (e.g., finops-dashboard:latest).')
param dashboardImageName string = 'finops-dashboard:latest'

@description('MCP pricing server image name and tag stored in ACR (e.g., azure-pricing-mcp:latest).')
param mcpImageName string = 'azure-pricing-mcp:latest'

@description('Whether to deploy the optional pricing MCP server as an internal Container App.')
param deployMcp bool = false

@description('Azure SKU Advisor API image name and tag stored in ACR (e.g., azure-sku-advisor:latest).')
param skuAdvisorImageName string = 'azure-sku-advisor:latest'

@description('Whether to deploy the optional Azure SKU Advisor API as an internal Container App. It backs the /sku-advisor view; without it that view falls back to a workspace export or sample data.')
param deploySkuAdvisor bool = false

@description('Shared key the dashboard sends to the SKU Advisor API as x-api-key. Leave empty to run key-less behind internal ingress.')
@secure()
param skuAdvisorApiKey string = ''

@description('Allow the SKU Advisor to read the Azure estate live with its Managed Identity (Resource Graph, quota, Advisor, Log Analytics). Off by default.')
param skuAdvisorAllowLiveReads bool = false

@description('Allow the SKU Advisor grounded AI narrative. Billable Azure OpenAI calls plus an egress of estate facts. Off by default.')
param skuAdvisorAllowAiNarrative bool = false

@description('Comma-separated Azure regions the estate runs in, e.g. "uksouth,swedencentral". Live discovery is filtered by region, and when none is given the advisor falls back to its own pricing region list — an estate outside it then reports zero workloads with no error. Leave empty only when the advisor is configured with the right regions itself.')
param skuAdvisorRegions string = ''

@description('Ask the SKU Advisor to source rightsizing telemetry (90-day P99 CPU/memory/IOPS busy-signal) live from Azure Monitor platform metrics. Requires skuAdvisorAllowLiveReads and Reader/Monitoring Reader for the Managed Identity on the estate subscription. Off by default.')
param skuAdvisorLiveTelemetry bool = false

// ============================================================================
// Container App Sizing
// ============================================================================

@description('CPU allocation for the dashboard container (vCPU).')
@allowed(['0.25', '0.5', '1.0', '2.0'])
param containerCpu string = '0.5'

@description('Memory allocation for the dashboard container.')
@allowed(['0.5Gi', '1Gi', '2Gi', '4Gi'])
param containerMemory string = '1Gi'

@description('Minimum number of container replicas (0 = scale to zero when idle).')
@minValue(0)
@maxValue(10)
param minReplicas int = 1

@description('Maximum number of container replicas.')
@minValue(1)
@maxValue(30)
param maxReplicas int = 3

// ============================================================================
// Container Registry Parameters
// ============================================================================

@description('Azure Container Registry SKU.')
@allowed(['Basic', 'Standard', 'Premium'])
param acrSku string = 'Basic'

@description('Create the AcrPull role assignment for the Container App identity. Requires Owner or User Access Administrator on the resource group. Set to false when deploying with Contributor only, and grant AcrPull manually afterwards.')
param grantAcrPull bool = true

// ============================================================================
// Log Analytics Parameters
// ============================================================================

@description('Log Analytics Workspace retention period in days.')
@minValue(30)
@maxValue(730)
param logRetentionDays int = 30

// ============================================================================
// Analytics Backend Selection
// ============================================================================

@description('''
Analytics backend the FinOps Dashboard will query for cost data.
- None: No external backend (mock/demo mode)
- ADX:  Azure Data Explorer / Kusto
- Fabric: Microsoft Fabric Real-Time Intelligence (Eventhouse / KQL Database)
- Foundry: Azure AI Foundry (AI-assisted analytics)
''')
@allowed(['None', 'ADX', 'Fabric', 'Foundry'])
param analyticsBackend string = 'ADX'

// ─── ADX Parameters ──────────────────────────────────────────────────────────

@description('Azure Data Explorer cluster URI (e.g., https://<cluster>.<region>.kusto.windows.net). Required when analyticsBackend=ADX.')
param adxClusterUri string = ''

@description('ADX database name to query. Required when analyticsBackend=ADX.')
param adxDatabaseName string = ''

@description('Optional: ADX query timeout in seconds.')
param adxQueryTimeoutSeconds int = 30

// ─── Agentic FinOps (Azure Advisor via Resource Graph) ────────────────────────

@description('Subscription ID Azure Advisor recommendations are queried from for the Agentic FinOps view. Defaults to the deployment subscription. Falls back to mock data when empty. Grant the Managed Identity Reader on this subscription after deploying.')
param azureSubscriptionId string = subscription().subscriptionId

// ─── Fabric RTI Parameters ───────────────────────────────────────────────────

@description('Microsoft Fabric Eventhouse query URI. Used when analyticsBackend=Fabric.')
param fabricQueryUri string = ''

@description('Microsoft Fabric workspace ID (alternative to fabricQueryUri). Used when analyticsBackend=Fabric.')
param fabricWorkspaceId string = ''

@description('Microsoft Fabric KQL database name. Used with fabricWorkspaceId.')
param fabricKqlDatabaseName string = ''

// ─── Azure AI Foundry Parameters ─────────────────────────────────────────────

@description('Azure AI Foundry project endpoint (Projects API). Used when analyticsBackend=Foundry.')
param foundryProjectEndpoint string = ''

@description('Azure AI Foundry project connection string (optional, used with AIProjectClient).')
@secure()
param foundryProjectConnectionString string = ''

@description('Azure AI Foundry inference endpoint (Inference/Deployments API).')
param foundryInferenceEndpoint string = ''

@description('Azure AI Foundry model deployment name (e.g., gpt-4o).')
param foundryModelDeploymentName string = 'gpt-4o'

@description('Azure AI Foundry API version.')
param foundryApiVersion string = '2025-01-01-preview'

// ─── Legacy OpenAI Parameters (kept for backward compatibility) ───────────────

@description('Azure OpenAI endpoint. Use foundryInferenceEndpoint for new deployments.')
param azureOpenaiEndpoint string = ''

@description('Azure OpenAI model deployment name.')
param azureOpenaiDeployment string = 'gpt-4o'

// ============================================================================
// Authentication Mode
// ============================================================================

@description('''
Authentication mode for connecting to backend services.
- ManagedIdentity: Recommended. Uses the app's User-Assigned Managed Identity.
- ServicePrincipal: Use an Entra ID app registration with client secret.
- ApiKey: Use a static API key. NOT recommended for production.
''')
@allowed(['ManagedIdentity', 'ServicePrincipal', 'ApiKey'])
param authMode string = 'ManagedIdentity'

@description('Service Principal tenant ID. Required when authMode=ServicePrincipal.')
param spTenantId string = ''

@description('Service Principal client ID (application ID). Required when authMode=ServicePrincipal.')
param spClientId string = ''

@description('Service Principal client secret. Required when authMode=ServicePrincipal.')
@secure()
param spClientSecret string = ''

@description('Static API key for backend authentication. Required when authMode=ApiKey.')
@secure()
param apiKey string = ''

// ============================================================================
// Easy Auth (Microsoft Entra ID)
// ============================================================================

@description('Protect the public ingress with Container Apps built-in authentication (Easy Auth) using Microsoft Entra ID. Enabled by default: without it every /api/* route is reachable anonymously. Requires an existing Entra ID app registration (see scripts/setup-entra-app.ps1). Set to false only when an equivalent control (WAF, private ingress) sits in front of the app.')
param enableEasyAuth bool = true

@description('Application (client) ID of the Entra ID app registration used by Easy Auth. Required when enableEasyAuth=true.')
param easyAuthClientId string = ''

@description('Client secret of the Entra ID app registration used by Easy Auth. Required when enableEasyAuth=true.')
@secure()
param easyAuthClientSecret string = ''

@description('Tenant ID that issues the tokens accepted by Easy Auth. Leave empty to use the deployment tenant.')
param easyAuthTenantId string = ''

@description('Additional token audiences accepted by Easy Auth, beyond api://<clientId>.')
param easyAuthAllowedAudiences array = []

@description('Role granted to a signed-in user that has no FinOps.Reader/FinOps.Admin app role assigned. "none" denies access (recommended), "Reader" grants read-only access to every user who can sign in to the tenant.')
@allowed([
  'none'
  'Reader'
])
param authDefaultRole string = 'none'

// ============================================================================
// Key Vault (application secrets)
// ============================================================================

@description('Store application secrets in a Key Vault and have the Container App reference them by URI, instead of holding literal values on the app. Rotating a secret then becomes a vault operation with no redeployment.')
param deployKeyVault bool = true

@description('Key Vault name. Leave empty to derive a deterministic name that fits the 24-character limit.')
param keyVaultName string = ''

@description('Block permanent deletion of the vault and its secrets during the retention window. Irreversible once enabled, so it defaults to false; turn it on for production.')
param keyVaultPurgeProtection bool = false

@description('Versionless Key Vault URI of an Easy Auth client secret that already exists in a vault you manage. When set, the secret is never passed to this deployment and is not written to the vault it creates. You must grant the deployment identity "Key Vault Secrets User" on that vault yourself.')
param easyAuthClientSecretUri string = ''

// ============================================================================
// Tags
// ============================================================================

@description('Additional resource tags to apply to all resources.')
param additionalTags object = {}

var commonTags = union({
  environment: environment
  managedBy: 'bicep'
  project: projectName
  analyticsBackend: analyticsBackend
}, additionalTags)

// ============================================================================
// Module: Managed Identity
// ============================================================================

module identities 'modules/identities.bicep' = {
  name: 'identities-deployment'
  params: {
    location: location
    projectName: projectName
    environment: environment
    tags: commonTags
  }
}

// ============================================================================
// Module: Azure Container Registry
// ============================================================================

module acr 'modules/acr.bicep' = {
  name: 'acr-deployment'
  params: {
    location: location
    projectName: projectName
    environment: environment
    acrSku: acrSku
    pullPrincipalId: grantAcrPull ? identities.outputs.userAssignedIdentityPrincipalId : ''
    tags: commonTags
  }
}

// ============================================================================
// Module: Container App (FinOps Dashboard)
// ============================================================================

// ============================================================================
// Module: Container Apps Environment (shared by the dashboard and the MCP server)
// ============================================================================

module appEnvironment 'modules/environment.bicep' = {
  name: 'environment-deployment'
  params: {
    location: location
    projectName: projectName
    environment: environment
    logRetentionDays: logRetentionDays
    tags: commonTags
  }
}

// ============================================================================
// Module: Azure Pricing MCP Server (optional, internal ingress)
// ============================================================================

module mcpServer 'modules/mcp-containerapp.bicep' = if (deployMcp) {
  name: 'mcp-server-deployment'
  params: {
    location: location
    projectName: projectName
    environment: environment
    containerAppEnvironmentId: appEnvironment.outputs.environmentId
    userAssignedIdentityId: identities.outputs.userAssignedIdentityId
    userAssignedIdentityClientId: identities.outputs.userAssignedIdentityClientId
    containerImageUri: '${acr.outputs.acrLoginServer}/${mcpImageName}'
    acrLoginServer: acr.outputs.acrLoginServer
    tags: commonTags
  }
}

// ============================================================================
// Module: Azure SKU Advisor API (optional, internal ingress)
// ============================================================================

module skuAdvisorServer 'modules/sku-advisor-containerapp.bicep' = if (deploySkuAdvisor) {
  name: 'sku-advisor-deployment'
  params: {
    location: location
    projectName: projectName
    environment: environment
    containerAppEnvironmentId: appEnvironment.outputs.environmentId
    userAssignedIdentityId: identities.outputs.userAssignedIdentityId
    userAssignedIdentityClientId: identities.outputs.userAssignedIdentityClientId
    containerImageUri: '${acr.outputs.acrLoginServer}/${skuAdvisorImageName}'
    acrLoginServer: acr.outputs.acrLoginServer
    apiKey: skuAdvisorApiKey
    allowLiveReads: skuAdvisorAllowLiveReads
    allowAiNarrative: skuAdvisorAllowAiNarrative
    tags: commonTags
  }
}

// ============================================================================
// Module: Key Vault (application secrets)
// ============================================================================

// A secret supplied as a vault URI is never handed to this deployment, so there
// is nothing to write to the vault it creates.
var byoEasyAuthSecret = !empty(easyAuthClientSecretUri)

module keyVault 'modules/keyvault.bicep' = if (deployKeyVault) {
  name: 'keyvault-deployment'
  params: {
    location: location
    projectName: projectName
    environment: environment
    keyVaultName: keyVaultName
    enablePurgeProtection: keyVaultPurgeProtection
    readerPrincipalId: identities.outputs.userAssignedIdentityPrincipalId
    easyAuthClientSecret: byoEasyAuthSecret ? '' : easyAuthClientSecret
    spClientSecret: spClientSecret
    apiKey: apiKey
    foundryProjectConnectionString: foundryProjectConnectionString
    storeEasyAuthClientSecret: !byoEasyAuthSecret && enableEasyAuth && !empty(easyAuthClientSecret)
    storeSpClientSecret: authMode == 'ServicePrincipal' && !empty(spClientSecret)
    storeApiKey: authMode == 'ApiKey' && !empty(apiKey)
    storeFoundryConnectionString: analyticsBackend == 'Foundry' && !empty(foundryProjectConnectionString)
    skuAdvisorApiKey: skuAdvisorApiKey
    storeSkuAdvisorApiKey: !empty(skuAdvisorApiKey)
    tags: commonTags
  }
}

// Effective secret sources for the Container App. An operator-supplied vault URI
// wins; otherwise the vault this template created is used; and with
// deployKeyVault=false the literal values are passed straight through, which
// keeps single-command portal deployments working.
var effectiveEasyAuthSecretUri = byoEasyAuthSecret
  ? easyAuthClientSecretUri
  : (deployKeyVault ? keyVault.outputs.easyAuthClientSecretUri : '')
var effectiveSpClientSecretUri = deployKeyVault ? keyVault.outputs.spClientSecretUri : ''
var effectiveApiKeyUri = deployKeyVault ? keyVault.outputs.apiKeyUri : ''
var effectiveFoundryConnectionStringUri = deployKeyVault ? keyVault.outputs.foundryConnectionStringUri : ''
var effectiveSkuAdvisorApiKeyUri = deployKeyVault ? keyVault.outputs.skuAdvisorApiKeyUri : ''

// ============================================================================
// Module: Container App (FinOps Dashboard)
// ============================================================================

module containerApp 'modules/containerapp.bicep' = {
  name: 'container-app-deployment'
  params: {
    location: location
    projectName: projectName
    environment: environment
    containerAppEnvironmentId: appEnvironment.outputs.environmentId
    userAssignedIdentityId: identities.outputs.userAssignedIdentityId
    userAssignedIdentityClientId: identities.outputs.userAssignedIdentityClientId
    containerImageUri: '${acr.outputs.acrLoginServer}/${dashboardImageName}'
    acrLoginServer: acr.outputs.acrLoginServer
    containerCpu: containerCpu
    containerMemory: containerMemory
    minReplicas: minReplicas
    maxReplicas: maxReplicas
    tags: commonTags
    // Backend selection
    analyticsBackend: analyticsBackend
    authMode: authMode
    // ADX
    adxClusterUri: adxClusterUri
    adxDatabaseName: adxDatabaseName
    adxQueryTimeoutSeconds: adxQueryTimeoutSeconds
    // Agentic FinOps
    azureSubscriptionId: azureSubscriptionId
    // Fabric
    fabricQueryUri: fabricQueryUri
    fabricWorkspaceId: fabricWorkspaceId
    fabricKqlDatabaseName: fabricKqlDatabaseName
    // Foundry
    foundryProjectEndpoint: foundryProjectEndpoint
    foundryProjectConnectionString: foundryProjectConnectionString
    foundryInferenceEndpoint: foundryInferenceEndpoint
    foundryModelDeploymentName: foundryModelDeploymentName
    foundryApiVersion: foundryApiVersion
    // Legacy OpenAI
    azureOpenaiEndpoint: azureOpenaiEndpoint
    azureOpenaiDeployment: azureOpenaiDeployment
    // MCP server URL (internal ingress; unreachable from outside the environment)
    mcpServerUrl: deployMcp ? mcpServer.outputs.mcpServerUrl : 'http://localhost:8080'
    // SKU Advisor API (internal ingress). Empty leaves the /sku-advisor view on
    // its workspace-export / sample fallback rather than failing.
    skuAdvisorApiUrl: deploySkuAdvisor ? skuAdvisorServer.outputs.skuAdvisorUrl : ''
    skuAdvisorApiKey: skuAdvisorApiKey
    skuAdvisorApiKeyUri: effectiveSkuAdvisorApiKeyUri
    // Only ask for live inventory when the advisor is also allowed to serve it,
    // otherwise every call would take the 403 retry path.
    skuAdvisorLiveUsage: deploySkuAdvisor && skuAdvisorAllowLiveReads
    skuAdvisorRegions: skuAdvisorRegions
    skuAdvisorLiveTelemetry: deploySkuAdvisor && skuAdvisorAllowLiveReads && skuAdvisorLiveTelemetry
    // Auth secrets (only passed when needed; Bicep secureString ensures no plain-text logging)
    spTenantId: spTenantId
    spClientId: spClientId
    spClientSecret: spClientSecret
    apiKey: apiKey
    // Key Vault references. When present these replace the literal values above,
    // and the app resolves them at runtime with its Managed Identity.
    easyAuthClientSecretUri: effectiveEasyAuthSecretUri
    spClientSecretUri: effectiveSpClientSecretUri
    apiKeyUri: effectiveApiKeyUri
    foundryConnectionStringUri: effectiveFoundryConnectionStringUri
    // Easy Auth (Entra ID) in front of the ingress
    enableEasyAuth: enableEasyAuth
    easyAuthClientId: easyAuthClientId
    easyAuthClientSecret: easyAuthClientSecret
    easyAuthTenantId: easyAuthTenantId
    easyAuthAllowedAudiences: easyAuthAllowedAudiences
    authDefaultRole: authDefaultRole
  }
}

// ============================================================================
// Outputs
// ============================================================================

@description('Resource group name where resources were deployed.')
output resourceGroupName string = resourceGroup().name

@description('Azure region of the deployment.')
output resourceGroupLocation string = resourceGroup().location

@description('Public URL of the FinOps Dashboard Container App.')
output containerAppUrl string = containerApp.outputs.containerAppUrl

@description('Container App resource name.')
output containerAppName string = containerApp.outputs.containerAppName

@description('Container App Environment resource name.')
output containerAppEnvironmentName string = appEnvironment.outputs.environmentName

@description('ACR resource name.')
output acrName string = acr.outputs.acrName

@description('ACR login server (use this to tag and push images).')
output acrLoginServer string = acr.outputs.acrLoginServer

@description('Log Analytics Workspace resource ID.')
output logAnalyticsWorkspaceId string = appEnvironment.outputs.logAnalyticsWorkspaceId

@description('Log Analytics Workspace name.')
output logAnalyticsWorkspaceName string = appEnvironment.outputs.logAnalyticsWorkspaceName

@description('User-Assigned Managed Identity resource ID.')
output managedIdentityId string = identities.outputs.userAssignedIdentityId

@description('User-Assigned Managed Identity principal ID (use for RBAC role assignments on backend resources).')
output managedIdentityPrincipalId string = identities.outputs.userAssignedIdentityPrincipalId

@description('User-Assigned Managed Identity client ID.')
output managedIdentityClientId string = identities.outputs.userAssignedIdentityClientId

@description('Internal URL of the Azure Pricing MCP server (if deployed). Only reachable from inside the Container Apps Environment.')
output mcpServerUrl string = deployMcp ? mcpServer.outputs.mcpServerUrl : 'Not deployed'

@description('Internal URL of the Azure SKU Advisor API (if deployed). Only reachable from inside the Container Apps Environment.')
output skuAdvisorUrl string = deploySkuAdvisor ? skuAdvisorServer.outputs.skuAdvisorUrl : 'Not deployed'

@description('Key Vault holding the application secrets (if deployed).')
output keyVaultName string = deployKeyVault ? keyVault.outputs.keyVaultName : 'Not deployed'

@description('Key Vault base URI (if deployed). Rotate a secret here to roll it without redeploying.')
output keyVaultUri string = deployKeyVault ? keyVault.outputs.keyVaultUri : 'Not deployed'

@description('Analytics backend configured for this deployment.')
output analyticsBackendConfigured string = analyticsBackend

@description('Authentication mode configured for this deployment.')
output authModeConfigured string = authMode
