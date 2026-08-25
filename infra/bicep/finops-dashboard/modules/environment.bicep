// environment.bicep - Shared Container Apps Environment and Log Analytics Workspace
//
// Extracted from containerapp.bicep so that more than one app can live in the
// same environment. The dashboard needs the internal FQDN of the pricing MCP
// server, and the MCP server needs the environment ID; keeping the environment
// inside either app module would make those two references circular.

param location string
param projectName string
param environment string

@description('Log Analytics retention in days.')
param logRetentionDays int = 30

param tags object = {}

var containerAppEnvName = 'env-${projectName}-${environment}'
var logAnalyticsWorkspaceName = 'log-${projectName}-${environment}'

resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: logAnalyticsWorkspaceName
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: logRetentionDays
  }
  tags: tags
}

resource containerAppEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: containerAppEnvName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsWorkspace.properties.customerId
        sharedKey: logAnalyticsWorkspace.listKeys().primarySharedKey
      }
    }
  }
  tags: tags
}

output environmentId string = containerAppEnvironment.id
output environmentName string = containerAppEnvironment.name

@description('Suffix used to build the FQDN of apps in this environment. Internal-only apps are reachable at https://<app>.internal.<defaultDomain>.')
output defaultDomain string = containerAppEnvironment.properties.defaultDomain

output logAnalyticsWorkspaceId string = logAnalyticsWorkspace.id
output logAnalyticsWorkspaceName string = logAnalyticsWorkspace.name
