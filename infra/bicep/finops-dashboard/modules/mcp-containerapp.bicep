// mcp-containerapp.bicep - Azure Pricing MCP server as an internal Container App
//
// The image (mcp/azure-pricing-mcp) is a plain HTTP server: it listens on 8080
// and speaks the MCP streamable-HTTP protocol. It is not an Azure Functions
// app, so it cannot run on the Functions host, and a custom container image is
// not supported on the Y1 Consumption plan at all.
//
// Security: the server has no inbound authentication of its own, so the ingress
// is internal (`external: false`). Only workloads inside this Container Apps
// Environment can reach it, at https://<name>.internal.<defaultDomain>.

param location string
param projectName string
param environment string

@description('Resource ID of the shared Container Apps Environment.')
param containerAppEnvironmentId string

@description('User-Assigned Managed Identity used for private registry pulls and Azure management APIs (Spot pricing tools).')
param userAssignedIdentityId string
param userAssignedIdentityClientId string

param containerImageUri string
param privateAcrServer string = ''

param containerCpu string = '0.5'
param containerMemory string = '1Gi'

@description('The MCP client keeps a session; scaling to zero would add a cold start to every pricing lookup.')
param minReplicas int = 1
param maxReplicas int = 2

param tags object = {}

var containerAppName = 'app-${projectName}-mcp-${environment}'

resource mcpApp 'Microsoft.App/containerApps@2024-03-01' = {
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
        // Never expose this publicly: the MCP server is unauthenticated.
        external: false
        targetPort: 8080
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
    }
    template: {
      containers: [
        {
          name: 'azure-pricing-mcp'
          image: containerImageUri
          resources: {
            cpu: json(containerCpu)
            memory: containerMemory
          }
          env: [
            { name: 'MCP_HOST', value: '0.0.0.0' }
            { name: 'MCP_PORT', value: '8080' }
            // Lets DefaultAzureCredential inside the container pick the
            // user-assigned identity rather than searching for a system one.
            { name: 'AZURE_CLIENT_ID', value: userAssignedIdentityClientId }
          ]
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

@description('Internal URL of the MCP server. Only resolvable from inside the Container Apps Environment.')
output mcpServerUrl string = 'https://${mcpApp.properties.configuration.ingress.fqdn}'

output containerAppName string = mcpApp.name
output containerAppId string = mcpApp.id
