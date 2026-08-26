# Deployment Guide

## Prerequisites

| Requirement | Details |
| --- | --- |
| Azure subscription | Contributor on the target resource group |
| Entra ID app registration | Required when Easy Auth is enabled; create it with `apps/finops-dashboard/scripts/setup-entra-app.ps1` |
| Cost data source | ADX, Fabric RTI, or Foundry; select `None` for demo mode |

The template pulls versioned public dashboard and pricing MCP images from GitHub Container
Registry. A clean deployment does not create an empty ACR and does not require Docker, a local
build, or a pre-deployment image push.

## Deploy from the Azure Portal

Use the
[Deploy to Azure](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Farthursilvany%2Ffinops-dashboard-ia%2Fmain%2Finfra%2Farm%2Fazuredeploy.json)
button in the repository README.

The default image parameters are immutable public artifacts:

```text
dashboardImageUri = ghcr.io/arthursilvany/finops-dashboard-ia-dashboard:1.0.0
mcpImageUri       = ghcr.io/arthursilvany/finops-dashboard-ia-azure-pricing-mcp:1.0.0
```

Leave `privateAcrServer` empty for these images. Enable `deployMcp` to deploy the
pricing MCP as an internal-only Container App. The Azure SKU Advisor is an external project
and is not deployed by this template; configure `skuAdvisorApiUrl` only when you already
operate that API.

After the deployment:

1. Register the dashboard callback URI on the Entra app:

   ```powershell
   ./apps/finops-dashboard/scripts/finish-entra-app.ps1 `
     -AppId <ENTRA_APP_CLIENT_ID> `
     -AppUrl <CONTAINER_APP_URL>
   ```

2. Grant the dashboard Managed Identity access to the selected analytics backend. See
   [Security](security.md).

## Deploy via Azure CLI

```bash
git clone https://github.com/arthursilvany/finops-dashboard-ia.git
cd finops-dashboard-ia

az group create --name <RESOURCE_GROUP> --location <REGION>

az deployment group create \
  --name finops-dashboard \
  --resource-group <RESOURCE_GROUP> \
  --template-file infra/bicep/finops-dashboard/main.bicep \
  --parameters \
      projectName=<PROJECT_NAME> \
      environment=<ENVIRONMENT> \
      analyticsBackend=None \
      deployMcp=true
```

For a configured backend, copy the example parameter file:

```bash
cp infra/parameters/azuredeploy.parameters.example.bicepparam my-params.bicepparam
az deployment group create \
  --name finops-dashboard \
  --resource-group <RESOURCE_GROUP> \
  --template-file infra/bicep/finops-dashboard/main.bicep \
  --parameters my-params.bicepparam
```

Never commit the local parameter file when it contains real identifiers or credentials.

## Upgrade from the ACR-Based Template

This release intentionally changes the image contract. Existing parameter files must be
migrated before an in-place redeployment:

| Previous parameter | Replacement |
| --- | --- |
| `dashboardImageName` | `dashboardImageUri` with a full URI |
| `mcpImageName` | `mcpImageUri` with a full URI |
| `acrSku` | Removed; the template no longer creates ACR |
| `grantAcrPull` | Removed for public images |
| `deploySkuAdvisor` | Removed; deploy the advisor separately and set `skuAdvisorApiUrl` |
| `skuAdvisorImageName` | Removed |
| `skuAdvisorAllowLiveReads` | `skuAdvisorLiveUsage` controls the dashboard request only |
| `skuAdvisorAllowAiNarrative` | Configure this on the external advisor service |

ARM incremental mode does not delete resources removed from a template. After redeploying,
confirm that both active revisions use the expected GHCR images:

```bash
az containerapp show -g <RESOURCE_GROUP> -n app-<PROJECT>-<ENV> \
  --query properties.template.containers[0].image -o tsv

az containerapp show -g <RESOURCE_GROUP> -n app-<PROJECT>-mcp-<ENV> \
  --query properties.template.containers[0].image -o tsv
```

The legacy ACR and managed SKU Advisor remain billable until explicitly removed. Delete them
only after confirming no other workload references them:

```bash
# Inventory first.
az acr repository list -g <RESOURCE_GROUP> -n <LEGACY_ACR_NAME> -o table
az resource list -g <RESOURCE_GROUP> \
  --query "[?type=='Microsoft.App/containerApps'].{name:name,image:properties.template.containers[0].image}" \
  -o table

# Remove the obsolete advisor only when an external endpoint or fallback is in use.
az containerapp delete -g <RESOURCE_GROUP> -n app-<PROJECT>-skuadv-<ENV> --yes

# Remove the old registry only when no remaining app pulls from it.
az acr delete -g <RESOURCE_GROUP> -n <LEGACY_ACR_NAME> --yes
```

## Private Custom Images

The public defaults need no registry credentials. To use private images:

1. Push both selected image tags to your registry.
2. Deploy once with the public defaults to create the User-Assigned Managed Identity.
3. Grant that identity pull access to the private registry.
4. Set full `dashboardImageUri` and `mcpImageUri` values.
5. Set `privateAcrServer` to the ACR login server, without a scheme, and redeploy.

For ACR, the required role is `AcrPull`. The template deliberately does not create the
registry or role assignment because doing so would recreate the original bootstrap cycle:
Container Apps cannot start until the images already exist.

## Backend RBAC

With ADX, grant the Managed Identity a Kusto database principal assignment on every database
the queries touch:

```bash
for DB in Hub Ingestion; do
  az kusto database-principal-assignment create \
    --cluster-name <CLUSTER_NAME> \
    --database-name "$DB" \
    --resource-group <CLUSTER_RESOURCE_GROUP> \
    --principal-assignment-name mi-finops-dashboard \
    --principal-id <MANAGED_IDENTITY_PRINCIPAL_ID> \
    --principal-type App \
    --role Viewer \
    --tenant-id <TENANT_ID>
done
```

`Ingestion` is required because FinOps Hub functions in `Hub` resolve remote entities there.

## Verify

```bash
APP_URL=$(az deployment group show \
  --resource-group <RESOURCE_GROUP> \
  --name finops-dashboard \
  --query "properties.outputs.containerAppUrl.value" \
  --output tsv)

curl --fail "$APP_URL/api/health"
```

When Easy Auth is enabled, `/api/health` is the only anonymous application path.

## Publishing Releases

`.github/workflows/release.yml` publishes versioned dashboard and MCP images to GHCR. The
repository packages must remain public because the default deployment intentionally has no
registry credential. The optional Template Spec job uses Azure OIDC and runs only when
`publishTemplateSpec` is selected during manual dispatch.

Never replace an existing version tag. Publish a new version and update the image defaults in
`main.bicep`, then recompile `infra/arm/azuredeploy.json`.

## Teardown

```bash
az group delete --name <RESOURCE_GROUP> --yes --no-wait
```
