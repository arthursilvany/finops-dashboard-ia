// sku-advisor-containerapp.bicep - Azure SKU Advisor API as an internal Container App
//
// The image comes from the Azure SKU Advisor project, which ships a FastAPI
// microservice (`azure_sku_advisor.api.app`) listening on 8080 and serving
// GET /api/recommendations — the exact payload the dashboard's /sku-advisor
// view renders.
//
// Security, in three layers:
//   * Internal ingress (`external: false`): only the dashboard, inside this
//     Container Apps Environment, can reach it.
//   * A shared API key (`SKU_ADVISOR_API_KEY`), so a compromised neighbour in
//     the environment still cannot query the estate.
//   * `SKU_ADVISOR_ALLOW_LIVE` and `SKU_ADVISOR_ALLOW_AI` default to false.
//     They gate, respectively, Managed-Identity-backed reads of the customer's
//     Azure estate and billable Azure OpenAI calls that egress estate facts.
//     A fresh deployment must not be able to do either by accident.

param location string
param projectName string
param environment string

@description('Resource ID of the shared Container Apps Environment.')
param containerAppEnvironmentId string

@description('User-Assigned Managed Identity used to pull from ACR and, when live reads are enabled, to read the Azure estate.')
param userAssignedIdentityId string
param userAssignedIdentityClientId string

param containerImageUri string
param acrLoginServer string

param containerCpu string = '0.5'
param containerMemory string = '1Gi'

@description('Shared key the dashboard sends as x-api-key. Empty leaves the service key-less, which is only acceptable behind internal ingress.')
@secure()
param apiKey string = ''

@description('Allow Managed-Identity-backed live reads of the Azure estate (Resource Graph, quota, Advisor, Log Analytics).')
param allowLiveReads bool = false

@description('Allow the grounded AI narrative. Billable Azure OpenAI calls plus an egress of estate facts.')
param allowAiNarrative bool = false

@description('Source for live utilization telemetry when live_telemetry is requested. "metrics" reads host-emitted Azure Monitor platform metrics (Percentage CPU, Available Memory Bytes; no guest agent needed) over a 90-day P99 window. "loganalytics" reads guest Perf counters from a Log Analytics workspace instead (needs SKU_ADVISOR_LA_WORKSPACE_ID).')
@allowed([
  'metrics'
  'loganalytics'
])
param telemetrySource string = 'metrics'

@description('Recommendation cache TTL in seconds. The advisor calls the public Retail Prices API on a miss.')
param cacheTtlSeconds int = 900

@description('A cold start would add the full pricing pipeline to the first page load, so the service does not scale to zero.')
param minReplicas int = 1
param maxReplicas int = 2

param tags object = {}

// Container Apps cap resource names at 32 characters, and the sibling
// 'app-<project>-mcp-<environment>' already sits exactly on that limit — so the
// longer 'skuadv' infix overflows it for the default project name and fails at
// preflight. Truncate deterministically instead, and drop a trailing '-' because
// a name must end with an alphanumeric character.
var containerAppNameCandidate = 'app-${projectName}-skuadv-${environment}'
var containerAppNameTruncated = take(containerAppNameCandidate, 32)
var containerAppName = endsWith(containerAppNameTruncated, '-')
  ? take(containerAppNameTruncated, 31)
  : containerAppNameTruncated
var hasApiKey = !empty(apiKey)

resource skuAdvisorApp 'Microsoft.App/containerApps@2024-03-01' = {
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
        // Never expose this publicly: it answers with the customer's estate.
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
      registries: [
        {
          server: acrLoginServer
          identity: userAssignedIdentityId
        }
      ]
      secrets: hasApiKey
        ? [
            {
              name: 'sku-advisor-api-key'
              value: apiKey
            }
          ]
        : []
    }
    template: {
      containers: [
        {
          name: 'azure-sku-advisor'
          image: containerImageUri
          resources: {
            cpu: json(containerCpu)
            memory: containerMemory
          }
          env: concat(
            [
              { name: 'SKU_ADVISOR_ALLOW_LIVE', value: string(allowLiveReads) }
              { name: 'SKU_ADVISOR_ALLOW_AI', value: string(allowAiNarrative) }
              { name: 'SKU_ADVISOR_TELEMETRY_SOURCE', value: telemetrySource }
              { name: 'SKU_ADVISOR_CACHE_TTL', value: string(cacheTtlSeconds) }
              // Only the dashboard calls this service, and it does so
              // server-side, so no browser origin needs to be allowed.
              { name: 'SKU_ADVISOR_CORS_ORIGINS', value: '' }
              // Lets DefaultAzureCredential inside the container pick the
              // user-assigned identity rather than searching for a system one.
              { name: 'AZURE_CLIENT_ID', value: userAssignedIdentityClientId }
            ],
            hasApiKey
              ? [
                  {
                    name: 'SKU_ADVISOR_API_KEY'
                    secretRef: 'sku-advisor-api-key'
                  }
                ]
              : []
          )
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 8080
              }
              initialDelaySeconds: 10
              periodSeconds: 30
            }
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

@description('Internal URL of the SKU Advisor API. Only resolvable from inside the Container Apps Environment.')
output skuAdvisorUrl string = 'https://${skuAdvisorApp.properties.configuration.ingress.fqdn}'

output containerAppName string = skuAdvisorApp.name
output containerAppId string = skuAdvisorApp.id
