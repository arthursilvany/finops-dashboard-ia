# Deployment Guide

## Prerequisites

| Requirement        | Details                                                |
| ------------------ | ------------------------------------------------------ |
| Azure subscription | Contributor or Owner role on the target resource group |
| Azure CLI          | v2.50+ (`az --version`)                                |
| Bicep CLI          | v0.20+ (`bicep --version`)                             |
| Docker             | For building the container image                       |
| Git                | To clone this repository                               |
| Entra ID app registration | Required: the deployment enables sign-in by default. Create it with `apps/finops-dashboard/scripts/setup-entra-app.ps1` — see [security.md](security.md#dashboard-access-control-microsoft-entra-id). |

---

## Step 1 — Clone the Repository

```bash
git clone https://github.com/arthursilvany/finops-dashboard-ia.git
cd finopshub-dashboard-ai
```

---

## Step 2 — Build and Push the Container Image

The application must be packaged as a Docker image and pushed to Azure Container Registry **before** running the Bicep deployment. (ACR is created by the deployment, so push after the first `az deployment group create` that creates the registry.)

### 2a. Create the Resource Group and Deploy Infrastructure First

```bash
az group create --name <RESOURCE_GROUP> --location <REGION>

az deployment group create \
  --resource-group <RESOURCE_GROUP> \
  --template-file infra/bicep/finops-dashboard/main.bicep \
  --parameters \
      projectName=<PROJECT_NAME> \
      environment=<ENVIRONMENT> \
      analyticsBackend=None \
      dashboardImageName=finops-dashboard:latest
```

### 2b. Build and Push the Image

```bash
cd apps/finops-dashboard

# Build
docker build -t finops-dashboard:latest .

# Get ACR login server from deployment output
ACR_SERVER=$(az deployment group show \
  -g <RESOURCE_GROUP> -n main \
  --query "properties.outputs.acrLoginServer.value" -o tsv)

# Authenticate and push
az acr login --name ${ACR_SERVER%%.*}
docker tag finops-dashboard:latest "$ACR_SERVER/finops-dashboard:latest"
docker push "$ACR_SERVER/finops-dashboard:latest"
```

### 2c. Re-deploy with the Analytics Backend Configured

```bash
az deployment group create \
  --resource-group <RESOURCE_GROUP> \
  --template-file infra/bicep/finops-dashboard/main.bicep \
  --parameters \
      projectName=<PROJECT_NAME> \
      environment=<ENVIRONMENT> \
      analyticsBackend=ADX \
      adxClusterUri=https://<CLUSTER>.<REGION>.kusto.windows.net \
      adxDatabaseName=<DATABASE_NAME>
```

---

## Step 3 — Assign RBAC Roles

After deployment, assign the required roles to the Managed Identity. See [security.md](security.md) for the complete checklist.

**Minimum required**: AcrPull on the ACR resource.

```bash
IDENTITY_PRINCIPAL=$(az deployment group show \
  -g <RESOURCE_GROUP> -n main \
  --query "properties.outputs.managedIdentityPrincipalId.value" -o tsv)

ACR_ID=$(az deployment group show \
  -g <RESOURCE_GROUP> -n main \
  --query "properties.outputs.acrId.value" -o tsv)

az role assignment create \
  --assignee "$IDENTITY_PRINCIPAL" \
  --role AcrPull \
  --scope "$ACR_ID"
```

**With the ADX backend**, also grant a Kusto *database* principal assignment on **every** database
the queries touch. Azure RBAC on the cluster does not grant the right to read data:

```bash
for DB in Hub Ingestion; do
  az kusto database-principal-assignment create \
    --cluster-name <CLUSTER_NAME> --database-name "$DB" -g <CLUSTER_RESOURCE_GROUP> \
    --principal-assignment-name mi-finops-dashboard \
    --principal-id "$IDENTITY_PRINCIPAL" --principal-type App --role Viewer \
    --tenant-id <TENANT_ID>
done
```

`Ingestion` is required in addition to `Hub`: the FinOps Hub functions live in `Hub` but resolve
remote entities in `Ingestion`. Omitting it makes every query fail with a Kusto 400, not a 403.

For a full runbook that deploys into an existing FinOps Hub resource group, see
[../DEPLOY.md](../../apps/finops-dashboard/DEPLOY.md).

---

## Step 4 — Verify the Deployment

```bash
# Get the Container App URL
APP_URL=$(az deployment group show \
  -g <RESOURCE_GROUP> -n main \
  --query "properties.outputs.containerAppUrl.value" -o tsv)

echo "Dashboard URL: $APP_URL"
curl -I "$APP_URL"
```

Open the URL in a browser. You should see the FinOps Dashboard.

---

## Deploying via Parameter File

Copy and customize the example parameter file:

```bash
cp infra/parameters/azuredeploy.parameters.example.bicepparam my-params.bicepparam
# Edit my-params.bicepparam — replace all <PLACEHOLDER_*> values
```

Then deploy:

```bash
az deployment group create \
  --resource-group <RESOURCE_GROUP> \
  --template-file infra/bicep/finops-dashboard/main.bicep \
  --parameters my-params.bicepparam
```

> **Security**: Never commit `my-params.bicepparam` or any file containing real credentials to version control. The example file in this repository uses only placeholder values.

---

## Deploying via Azure Portal (Template Spec)

Use the
[Deploy to Azure](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Farthursilvany%2Ffinops-dashboard-ia%2Fmain%2Finfra%2Farm%2Fazuredeploy.json)
link to deploy the compiled ARM template from `main`.

For a versioned, RBAC-controlled deployment, publish the template as a Template Spec instead —
see [Publishing a Template Spec](../../README.md#publishing-a-template-spec) — then deploy it
from the Portal. The `createUiDefinition.json` wizard guides you through all configuration
options. No CLI is required for the consumer.

After the portal deployment completes:

1. Assign RBAC roles (Step 3 above) — the portal cannot do this automatically.
2. Build and push your container image to the ACR that was created.
3. Restart the Container App to pull the image: `az containerapp revision restart --name <CA_NAME> -g <RG>`.

---

## CI/CD with GitHub Actions

An example GitHub Actions workflow for continuous deployment:

```yaml
# .github/workflows/deploy.yml
name: Deploy FinOps Dashboard

on:
  push:
    branches: [main]

env:
  REGISTRY: ${{ secrets.ACR_SERVER }}
  IMAGE_NAME: finops-dashboard
  RESOURCE_GROUP: <RESOURCE_GROUP>
  PROJECT_NAME: <PROJECT_NAME>

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read

    steps:
      - uses: actions/checkout@v4

      - name: Azure Login (OIDC)
        uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Build and push image
        run: |
          cd apps/finops-dashboard
          az acr build \
            --registry "${REGISTRY%%.*}" \
            --image "$IMAGE_NAME:${{ github.sha }}" \
            .

      - name: Update Container App image
        run: |
          az containerapp update \
            --name "ca-$PROJECT_NAME-prod" \
            --resource-group "$RESOURCE_GROUP" \
            --image "$REGISTRY/$IMAGE_NAME:${{ github.sha }}"
```

---

## Updating to a New Version

```bash
# Build new image
cd apps/finops-dashboard
docker build -t finops-dashboard:<NEW_TAG> .
docker push "$ACR_SERVER/finops-dashboard:<NEW_TAG>"

# Update Container App
az containerapp update \
  --name ca-<PROJECT_NAME>-<ENV> \
  --resource-group <RESOURCE_GROUP> \
  --image "$ACR_SERVER/finops-dashboard:<NEW_TAG>"
```

---

## Teardown

```bash
# Delete all resources in the resource group
az group delete --name <RESOURCE_GROUP> --yes --no-wait
```
