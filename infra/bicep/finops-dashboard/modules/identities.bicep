// identities.bicep - User-Assigned Managed Identity
// Provides secure, passwordless authentication for the Container App.
// After deployment, assign RBAC roles on backend resources (ADX, Fabric, Foundry)
// to the identity's principalId. See docs/operations/security.md for role assignment steps.

param location string
param projectName string
param environment string
param tags object = {}

resource userAssignedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'mi-${projectName}-${environment}'
  location: location
  tags: tags
}

output userAssignedIdentityId string = userAssignedIdentity.id
output userAssignedIdentityClientId string = userAssignedIdentity.properties.clientId
output userAssignedIdentityPrincipalId string = userAssignedIdentity.properties.principalId
