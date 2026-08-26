# Operations Guide

## Viewing Logs

### Portal

1. Navigate to your Container App → **Monitoring → Log stream** for live logs.
2. Navigate to the **Log Analytics Workspace** → **Logs** for historical queries.

### CLI

```bash
# Live log stream
az containerapp logs show \
  --name ca-<PROJECT_NAME>-<ENV> \
  --resource-group <RESOURCE_GROUP> \
  --follow

# Last 100 log lines
az containerapp logs show \
  --name ca-<PROJECT_NAME>-<ENV> \
  --resource-group <RESOURCE_GROUP> \
  --tail 100
```

### KQL Queries in Log Analytics

```kql
// Recent application errors
ContainerAppConsoleLogs_CL
| where TimeGenerated > ago(1h)
| where Log contains "error" or Log contains "Error" or Log contains "ERROR"
| project TimeGenerated, RevisionName_s, Log
| order by TimeGenerated desc
| take 50

// Request rate per hour
ContainerAppSystemLogs_CL
| where TimeGenerated > ago(24h)
| summarize count() by bin(TimeGenerated, 1h)
| render timechart

// P95 response time
AppRequests
| where TimeGenerated > ago(1h)
| where Name startswith "/"
| summarize percentile(DurationMs, 95) by bin(TimeGenerated, 5m)
| render timechart
```

---

## Monitoring Key Metrics

Navigate to the Container App → **Monitoring → Metrics** to view:

| Metric                  | Description              | Alert threshold     |
| ----------------------- | ------------------------ | ------------------- |
| `Replicas`              | Active replica count     | < `minReplicas`     |
| `Requests`              | HTTP requests per second | Baseline × 2×       |
| `RestartCount`          | Container restart count  | > 3 in 10 minutes   |
| `CpuUsageNanoCores`     | CPU usage                | > 80% for 5 minutes |
| `MemoryWorkingSetBytes` | Memory usage             | > 90% of limit      |

---

## Scaling

The Container App scales automatically based on HTTP traffic (default scaling rule). The `minReplicas` and `maxReplicas` parameters control the bounds.

To update scaling limits without redeployment:

```bash
az containerapp update \
  --name ca-<PROJECT_NAME>-<ENV> \
  --resource-group <RESOURCE_GROUP> \
  --min-replicas 1 \
  --max-replicas 5
```

---

## Updating the Container Image

```bash
# Use a version already published by the Release workflow.
IMAGE="ghcr.io/arthursilvany/finops-dashboard-ia-dashboard:<NEW_VERSION>"

az containerapp update \
  --name ca-<PROJECT_NAME>-<ENV> \
  --resource-group <RESOURCE_GROUP> \
  --image "$IMAGE"
```

Never repoint production to `latest`. A new revision is created automatically,
and traffic shifts once it passes health checks.

---

## Managing Revisions

```bash
# List revisions
az containerapp revision list \
  --name ca-<PROJECT_NAME>-<ENV> \
  --resource-group <RESOURCE_GROUP> \
  --output table

# Rollback to a previous revision
az containerapp ingress traffic set \
  --name ca-<PROJECT_NAME>-<ENV> \
  --resource-group <RESOURCE_GROUP> \
  --revision-weight <PREVIOUS_REVISION>=100
```

---

## Rotating Secrets

For Service Principal or API Key auth:

```bash
# Update the secret value
az containerapp secret set \
  --name ca-<PROJECT_NAME>-<ENV> \
  --resource-group <RESOURCE_GROUP> \
  --secrets "sp-client-secret=<NEW_VALUE>"

# Restart to pick up the new secret
az containerapp revision restart \
  --name ca-<PROJECT_NAME>-<ENV> \
  --resource-group <RESOURCE_GROUP>
```

---

## Updating Infrastructure (Bicep)

For infrastructure changes (scaling limits, image versions, log retention, adding tags):

```bash
# Edit infra/bicep/finops-dashboard/main.bicep or modules

# Recompile ARM JSON (needed before publishing a new Template Spec version)
bicep build infra/bicep/finops-dashboard/main.bicep \
  --outfile infra/arm/azuredeploy.json

# Redeploy (idempotent)
az deployment group create \
  --resource-group <RESOURCE_GROUP> \
  --template-file infra/bicep/finops-dashboard/main.bicep \
  --parameters <PARAMETERS>
```

Bicep deployments are **idempotent** — re-running does not recreate unchanged resources.

---

## Cost Management

Estimated monthly cost for a minimal deployment (0.5 vCPU/1 GiB, 1 replica, 30-day log retention):

| Resource                     | Estimated Cost                        |
| ---------------------------- | ------------------------------------- |
| Container Apps (Consumption) | ~$5–$15/month (depends on usage)      |
| Log Analytics Workspace      | ~$2–$10/month (depends on log volume) |
| Managed Identity             | Free                                  |
| **Total**                    | **~$7–$25/month**                     |

Use the [Azure Pricing Calculator](https://azure.microsoft.com/pricing/calculator/) for accurate estimates based on your expected traffic.

---

## Health Checks

The Container App automatically monitors the `/` endpoint. You can verify health manually:

```bash
APP_URL=$(az containerapp show \
  --name ca-<PROJECT_NAME>-<ENV> \
  --resource-group <RESOURCE_GROUP> \
  --query "properties.configuration.ingress.fqdn" -o tsv)

curl -I "https://$APP_URL"
# Expected: HTTP/2 200
```
