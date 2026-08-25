// azuredeploy.parameters.example.bicepparam
// Example parameter file for deploying the FinOps Dashboard.
//
// INSTRUCTIONS:
//   1. Copy this file to a local file (e.g., my-params.bicepparam)
//   2. Replace all <PLACEHOLDER_*> values with your actual values
//   3. Never commit files containing real URIs, IDs, or secrets to version control
//
// DEPLOY:
//   az deployment group create \
//     --resource-group <RESOURCE_GROUP> \
//     --template-file infra/bicep/finops-dashboard/main.bicep \
//     --parameters my-params.bicepparam

using './main.bicep'

// ─── Core ─────────────────────────────────────────────────────────────────────
param location = 'eastus'            // Azure region (must match your ADX/Fabric region for low latency)
param projectName = 'finops-dashboard'
param environment = 'prod'           // Options: dev | poc | staging | prod

// ─── Analytics Backend ────────────────────────────────────────────────────────
param analyticsBackend = 'ADX'       // Options: None | ADX | Fabric | Foundry

// ─── ADX Configuration (set when analyticsBackend = 'ADX') ───────────────────
param adxClusterUri = 'https://<ADX_CLUSTER_NAME>.<REGION>.kusto.windows.net'
param adxDatabaseName = '<ADX_DATABASE_NAME>'
param adxQueryTimeoutSeconds = 30

// ─── Fabric RTI Configuration (set when analyticsBackend = 'Fabric') ─────────
// Option A: Single query URI
// param fabricQueryUri = 'https://<FABRIC_CLUSTER>.<REGION>.kusto.fabric.microsoft.com'

// Option B: Workspace + KQL Database
// param fabricWorkspaceId = '<FABRIC_WORKSPACE_ID>'
// param fabricKqlDatabaseName = '<KQL_DATABASE_NAME>'

// ─── Azure AI Foundry Configuration (set when analyticsBackend = 'Foundry') ──
// Projects API
// param foundryProjectEndpoint = 'https://<FOUNDRY_RESOURCE>.services.ai.azure.com/api/projects/<PROJECT_NAME>'

// Inference/Deployments API (optional, for AI-assisted analytics)
// param foundryInferenceEndpoint = 'https://<FOUNDRY_RESOURCE>.services.ai.azure.com'
// param foundryModelDeploymentName = 'gpt-4o'
// param foundryApiVersion = '2025-01-01-preview'

// ─── Authentication Mode ──────────────────────────────────────────────────────
param authMode = 'ManagedIdentity'   // Options: ManagedIdentity | ServicePrincipal | ApiKey
                                     // ManagedIdentity is strongly recommended for production.

// Service Principal (only if authMode = 'ServicePrincipal')
// param spTenantId = '<TENANT_ID>'
// param spClientId = '<SP_CLIENT_ID>'
// param spClientSecret = '<SP_CLIENT_SECRET>'   // NEVER commit this to version control

// API Key (only if authMode = 'ApiKey' — NOT recommended for production)
// param apiKey = '<API_KEY>'                     // NEVER commit this to version control

// ─── Dashboard Access Control (Easy Auth / Microsoft Entra ID) ───────────────
// The Container App has a PUBLIC ingress and the application itself does not
// authenticate callers. Keep this enabled so /api/* is not anonymous.
// Requires an existing Entra ID app registration — see docs/security.md.
param enableEasyAuth = true
param easyAuthClientId = '<ENTRA_APP_CLIENT_ID>'
param easyAuthClientSecret = '<ENTRA_APP_CLIENT_SECRET>'  // NEVER commit this to version control
// param easyAuthTenantId = '<TENANT_ID>'        // Defaults to the deployment tenant
// param easyAuthAllowedAudiences = []
// param authDefaultRole = 'none'                // 'none' denies users with no app role; 'Reader' grants read-only

// ─── Container Sizing ─────────────────────────────────────────────────────────
param containerCpu = '0.5'           // vCPU: 0.25 | 0.5 | 1.0 | 2.0
param containerMemory = '1Gi'        // Memory: 0.5Gi | 1Gi | 2Gi | 4Gi
param minReplicas = 1
param maxReplicas = 3

// ─── ACR & Image ──────────────────────────────────────────────────────────────
param acrSku = 'Basic'              // Options: Basic | Standard | Premium
// Creates the AcrPull role assignment for the Container App identity.
// Requires Owner or User Access Administrator; set to false if you only have
// Contributor and grant AcrPull manually afterwards (see docs/security.md).
param grantAcrPull = true
param dashboardImageName = 'finops-dashboard:latest'
param deployMcp = false              // Set to true to deploy the Azure Pricing MCP Functions server

// ─── Monitoring ───────────────────────────────────────────────────────────────
param logRetentionDays = 30          // Log Analytics retention (30-730 days)

// ─── Tags ─────────────────────────────────────────────────────────────────────
param additionalTags = {
  owner: '<TEAM_OR_OWNER>'
  costCenter: '<COST_CENTER>'
}
