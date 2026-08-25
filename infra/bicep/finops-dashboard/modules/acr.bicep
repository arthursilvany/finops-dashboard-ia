// acr.bicep - Azure Container Registry for Docker images
// Stores the FinOps Dashboard Docker image.
//
// Security note: adminUserEnabled is false by default.
// The Container App authenticates to ACR using the User-Assigned Managed Identity.
// Assign the "AcrPull" role to the identity after deployment. See docs/operations/security.md.

param location string
param projectName string
param environment string

@description('ACR pricing tier.')
@allowed(['Basic', 'Standard', 'Premium'])
param acrSku string = 'Basic'

@description('Principal ID of the User-Assigned Managed Identity that pulls images. When set, an AcrPull role assignment is created on this registry.')
param pullPrincipalId string = ''

param tags object = {}

// ACR names must be globally unique, 5-50 chars, alphanumeric only
var acrName = 'acr${replace(projectName, '-', '')}${environment}'

resource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  sku: {
    name: acrSku
  }
  properties: {
    // Admin user disabled — Container App pulls via Managed Identity (AcrPull role)
    adminUserEnabled: false
    // publicNetworkAccess is a network feature treated as Premium-only; omit it (default is 'Enabled' on all tiers) to avoid SkuNotSupported on Basic/Standard.
    // retentionPolicy is a Premium-only feature; omit it for Basic/Standard to avoid SkuNotSupported.
    policies: acrSku == 'Premium' ? {
      retentionPolicy: {
        status: 'enabled'
        days: 7
      }
    } : {}
  }
  tags: tags
}

// AcrPull role definition (built-in): allows pulling images from the registry.
var acrPullRoleDefinitionId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')

// Grant the Container App's Managed Identity permission to pull images from this ACR.
resource acrPullRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(pullPrincipalId)) {
  name: guid(containerRegistry.id, pullPrincipalId, acrPullRoleDefinitionId)
  scope: containerRegistry
  properties: {
    roleDefinitionId: acrPullRoleDefinitionId
    principalId: pullPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output acrLoginServer string = containerRegistry.properties.loginServer
output acrId string = containerRegistry.id
output acrName string = containerRegistry.name
