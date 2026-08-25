// keyvault.bicep - Key Vault for the dashboard's application secrets
//
// Container App secrets are stored in the vault and referenced by URI instead of
// being held as literal values on the app. The app resolves them at runtime with
// its User-Assigned Managed Identity, so rotating a secret is a vault operation
// and no longer requires a redeployment.
//
// The vault uses RBAC authorization; the identity is granted "Key Vault Secrets
// User", which allows reading secret values but not listing, writing or deleting.

param location string
param projectName string
param environment string

@description('Vault name. Leave empty to derive a deterministic name that fits the 24-character limit.')
param keyVaultName string = ''

@description('Principal ID of the identity that reads the secrets. When set, a "Key Vault Secrets User" role assignment is created on this vault.')
param readerPrincipalId string = ''

@description('Block permanent deletion of the vault and its secrets during the retention window. Irreversible once enabled.')
param enablePurgeProtection bool = false

@description('Days a soft-deleted vault or secret is recoverable.')
@minValue(7)
@maxValue(90)
param softDeleteRetentionInDays int = 90

@secure()
@description('Entra ID app registration client secret used by Easy Auth. Stored only when storeEasyAuthClientSecret is true.')
param easyAuthClientSecret string = ''

@secure()
@description('Service principal client secret used when authMode=ServicePrincipal. Stored only when storeSpClientSecret is true.')
param spClientSecret string = ''

@secure()
@description('Static backend API key used when authMode=ApiKey. Stored only when storeApiKey is true.')
param apiKey string = ''

@secure()
@description('Azure AI Foundry project connection string. Stored only when storeFoundryConnectionString is true.')
param foundryProjectConnectionString string = ''

@secure()
@description('Shared key the dashboard presents to the SKU Advisor service. Stored only when storeSkuAdvisorApiKey is true.')
param skuAdvisorApiKey string = ''

// Which secrets to store is decided by the caller and passed as plain booleans.
// Deriving it here from `empty(<secure param>)` would put a secure value inside
// the output expressions, which the Bicep linter flags as a possible leak.
@description('Write the Easy Auth client secret to the vault and return its URI.')
param storeEasyAuthClientSecret bool = false

@description('Write the service principal client secret to the vault and return its URI.')
param storeSpClientSecret bool = false

@description('Write the backend API key to the vault and return its URI.')
param storeApiKey bool = false

@description('Write the Foundry connection string to the vault and return its URI.')
param storeFoundryConnectionString bool = false

@description('Write the SKU Advisor API key to the vault and return its URI.')
param storeSkuAdvisorApiKey bool = false

param tags object = {}

// Vault names are globally unique, 3-24 chars, alphanumeric and hyphens only.
// The segments are concatenated without inner separators so that truncating a
// long projectName can never leave a trailing hyphen, which is invalid.
var generatedName = 'kv-${take(replace(projectName, '-', ''), 10)}${take(environment, 4)}-${take(uniqueString(resourceGroup().id), 6)}'
var vaultName = empty(keyVaultName) ? generatedName : keyVaultName

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: vaultName
  location: location
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    // RBAC instead of access policies: role assignments are visible in the same
    // place as every other permission and survive vault recreation.
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: softDeleteRetentionInDays
    enablePurgeProtection: enablePurgeProtection ? true : null
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
  }
  tags: tags
}

// Key Vault Secrets User (built-in): read secret contents. Deliberately not
// "Secrets Officer" — the app never needs to write or delete a secret.
var secretsUserRoleDefinitionId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')

resource secretsUserRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(readerPrincipalId)) {
  name: guid(keyVault.id, readerPrincipalId, secretsUserRoleDefinitionId)
  scope: keyVault
  properties: {
    roleDefinitionId: secretsUserRoleDefinitionId
    principalId: readerPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource easyAuthSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (storeEasyAuthClientSecret) {
  parent: keyVault
  name: 'easy-auth-client-secret'
  properties: {
    value: easyAuthClientSecret
  }
}

resource spSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (storeSpClientSecret) {
  parent: keyVault
  name: 'sp-client-secret'
  properties: {
    value: spClientSecret
  }
}

resource apiKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (storeApiKey) {
  parent: keyVault
  name: 'api-key'
  properties: {
    value: apiKey
  }
}

resource foundrySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (storeFoundryConnectionString) {
  parent: keyVault
  name: 'foundry-connection-string'
  properties: {
    value: foundryProjectConnectionString
  }
}

resource skuAdvisorSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (storeSkuAdvisorApiKey) {
  parent: keyVault
  name: 'sku-advisor-api-key'
  properties: {
    value: skuAdvisorApiKey
  }
}

// Versionless URIs: the Container App re-reads the current version periodically,
// so rotating a secret in the vault does not require a new deployment.
// The role assignment is included in the dependency chain so that a consumer
// waiting on these outputs cannot create a revision before it can read them.
var vaultUri = keyVault.properties.vaultUri

@description('Key Vault resource ID.')
output keyVaultId string = keyVault.id

@description('Key Vault name.')
output keyVaultName string = keyVault.name

@description('Key Vault base URI.')
output keyVaultUri string = vaultUri

@description('Versionless URI of the Easy Auth client secret, or empty when it was not stored.')
output easyAuthClientSecretUri string = !storeEasyAuthClientSecret ? '' : '${vaultUri}secrets/${easyAuthSecret.name}'

@description('Versionless URI of the service principal client secret, or empty when it was not stored.')
output spClientSecretUri string = !storeSpClientSecret ? '' : '${vaultUri}secrets/${spSecret.name}'

@description('Versionless URI of the backend API key, or empty when it was not stored.')
output apiKeyUri string = !storeApiKey ? '' : '${vaultUri}secrets/${apiKeySecret.name}'

@description('Versionless URI of the Foundry connection string, or empty when it was not stored.')
output foundryConnectionStringUri string = !storeFoundryConnectionString ? '' : '${vaultUri}secrets/${foundrySecret.name}'

@description('Versionless URI of the SKU Advisor API key (empty when not stored).')
output skuAdvisorApiKeyUri string = !storeSkuAdvisorApiKey ? '' : '${vaultUri}secrets/${skuAdvisorSecret.name}'
