# FinOps Dashboard IA

> AI-powered FinOps Dashboard for Azure — deployable in minutes.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/arthursilvany/finops-dashboard-ia/actions/workflows/ci.yml/badge.svg)](https://github.com/arthursilvany/finops-dashboard-ia/actions/workflows/ci.yml)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![Azure Container Apps](https://img.shields.io/badge/Azure-Container%20Apps-0078D4?logo=microsoftazure&logoColor=white)](https://learn.microsoft.com/azure/container-apps/)
[![Bicep](https://img.shields.io/badge/IaC-Bicep-5C2D91)](https://learn.microsoft.com/azure/azure-resource-manager/bicep/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[![Deploy to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2Farthursilvany%2Ffinops-dashboard-ia%2Fmain%2Finfra%2Farm%2Fazuredeploy.json)

The button deploys the compiled ARM template from `main`. For a versioned,
RBAC-controlled deployment, publish it as a [Template Spec](#publishing-a-template-spec).

---

## What is this?

**FinOps Dashboard IA** is a containerized web application that gives your team real-time visibility into Azure cloud spend. It connects to your existing cost data — via **Azure Data Explorer (ADX)**, **Microsoft Fabric Real-Time Intelligence**, or **Azure AI Foundry** — and surfaces insights through an interactive dashboard powered by AI.

| Feature            | Details                                                   |
| ------------------ | --------------------------------------------------------- |
| **Runtime**        | Next.js 16 on Azure Container Apps                        |
| **Auth**           | Managed Identity (default), Service Principal, or API Key |
| **Analytics**      | ADX, Fabric RTI, Azure AI Foundry, or None                |
| **Infrastructure** | Azure Bicep → ARM JSON (CLI or Template Spec)             |
| **AI Assistant**   | Natural language cost queries via Azure OpenAI            |

---

## Prerequisites

Before deploying:

1. **An Azure subscription** with at least Contributor access to a resource group.
2. **A cost data source**: an ADX cluster with FinOps data, a Fabric KQL database, or an AI Foundry project. Select `None` for demo mode.

---

## Portal Deploy

Publish the template as a [Template Spec](#publishing-a-template-spec), then deploy it from
the Azure Portal. The wizard (`infra/portal/createUiDefinition.json`) walks you through:

1. **Basics** — resource name prefix and environment tag
2. **Container** — CPU, memory, and scaling limits
3. **Analytics Backend** — choose ADX / Fabric / Foundry / None and enter the URIs
4. **Authentication** — Managed Identity (recommended), Service Principal, or API Key
5. **Logging** — log retention period and optional MCP pricing server

The wizard deploys the following resources to your selected resource group:

| Resource                       | Name pattern              |
| ------------------------------ | ------------------------- |
| Container Apps Environment     | `env-{name}-{env}`        |
| Container App (dashboard)      | `app-{name}-{env}`        |
| Container App (MCP, optional)  | `app-{name}-mcp-{env}`    |
| User-Assigned Managed Identity | `mi-{name}-{env}`         |
| Log Analytics Workspace        | `log-{name}-{env}`        |
| Key Vault (secrets)            | `kv-{name}{env}-{hash}`   |

---

## Deploy via CLI (Advanced)

```bash
# Clone the repo
git clone https://github.com/arthursilvany/finops-dashboard-ia.git
cd finops-dashboard-ia

# Copy and fill in the example parameters
cp infra/parameters/azuredeploy.parameters.example.bicepparam my-params.bicepparam
# Edit my-params.bicepparam with your values

# Create a resource group
az group create --name rg-finops-dashboard --location eastus

# Deploy
az deployment group create \
  --resource-group rg-finops-dashboard \
  --template-file infra/bicep/finops-dashboard/main.bicep \
  --parameters my-params.bicepparam
```

After deployment, **register the Easy Auth redirect URI** on the Entra ID app registration used by `easyAuthClientId`:

```bash
FQDN=$(az deployment group show \
  -g rg-finops-dashboard -n main \
  --query properties.outputs.containerAppUrl.value -o tsv)

az ad app update --id <ENTRA_APP_CLIENT_ID> \
  --web-redirect-uris "${FQDN}/.auth/login/aad/callback"
```

The template pulls versioned public dashboard and pricing MCP images from GHCR. It does not
create an empty registry or require an image build before the first deployment. For a private
custom ACR image, set the full image URI and `privateAcrServer`, then grant the deployment
identity pull access before switching the deployment to those private images.

> See [docs/operations/security.md](./docs/operations/security.md) for the full post-deployment security checklist.

---

## Publishing a Template Spec

A Template Spec is a versioned, RBAC-controlled copy of the ARM template that lives **inside
the target subscription**. It is the recommended way to let another team (or a customer)
redeploy this dashboard from the Portal or CLI **without granting them access to this
repository**.

```bash
az ts create \
  --name finops-dashboard \
  --version 1.0.0 \
  --resource-group rg-finops-dashboard \
  --location eastus \
  --template-file infra/arm/azuredeploy.json \
  --ui-form-definition infra/portal/createUiDefinition.json
```

Consumers then deploy by resource ID, supplying only their own parameter file:

```bash
TS_ID=$(az ts show \
  --name finops-dashboard --version 1.0.0 \
  --resource-group rg-finops-dashboard \
  --query id -o tsv)

az deployment group create \
  --resource-group <THEIR_RESOURCE_GROUP> \
  --template-spec "$TS_ID" \
  --parameters their-params.bicepparam
```

Grant them `Template Spec Reader` on the spec and `Contributor` on their resource group.

---

## Grant ADX Access (if `analyticsBackend=ADX`)

When you deploy with the **ADX** analytics backend, the template injects
`ADX_CLUSTER_URI` / `ADX_DATABASE` and creates the Managed Identity, but it does
**not** grant RBAC on the (external) ADX cluster. Until the identity has the
`Database Viewer` role, queries fail with `403` and the dashboard falls back to
mock/empty data.

Use the helper script to grant access on both FinOps Hub databases
(`Hub` and `Ingestion`) in one step:

```bash
chmod +x infra/scripts/grant-adx-access.sh

./infra/scripts/grant-adx-access.sh \
  --resource-group         rg-finops-dashboard \
  --cluster-name           mykustocluster \
  --cluster-resource-group rg-adx
```

The script reads the Managed Identity from the deployment output
`managedIdentityPrincipalId` and verifies the assignments. It requires Kusto
cluster **Contributor** on the target cluster. See
[infra/scripts/README.md](infra/scripts/README.md) for all options.

---

## Published Container Images

The release workflow publishes immutable versions of both runtime images:

- `ghcr.io/arthursilvany/finops-dashboard-ia-dashboard:1.0.0`
- `ghcr.io/arthursilvany/finops-dashboard-ia-azure-pricing-mcp:1.0.0`

The Bicep defaults use these public artifacts. Pin a different published version through
`dashboardImageUri` and `mcpImageUri`; do not use `latest` in a production deployment.

---

## Repository Structure

```text
.
├── .github/
│   ├── workflows/                 # CI (lint, build, Bicep drift, secret scan) and release
│   ├── ISSUE_TEMPLATE/            # Bug, feature and documentation issue forms
│   ├── copilot-instructions.md    # Hard invariants for coding agents
│   ├── CODEOWNERS
│   └── dependabot.yml
├── apps/
│   └── finops-dashboard/          # Next.js 16 application source
│       ├── src/                   # App source code
│       ├── scripts/               # Setup and test scripts (Entra ID, ingestion, checks)
│       ├── Dockerfile             # Multi-stage Docker build
│       ├── DEPLOY.md              # Step-by-step Azure deployment runbook
│       └── docs/                  # Application documentation
├── mcp/
│   └── azure-pricing-mcp/         # Python Azure retail pricing MCP server
├── infra/
│   ├── arm/
│   │   └── azuredeploy.json       # Compiled ARM template — generated, never hand-edited
│   ├── bicep/
│   │   └── finops-dashboard/      # Bicep source of truth
│   │       ├── main.bicep         # Main orchestrator
│   │       └── modules/           # Reusable Bicep modules
│   ├── parameters/
│   │   └── azuredeploy.parameters.example.bicepparam  # Example parameters (no secrets)
│   ├── portal/
│   │   └── createUiDefinition.json  # Azure Portal wizard UI
│   └── scripts/
│       └── grant-adx-access.sh    # Post-deploy ADX RBAC helper
├── docs/                          # Project-level and product documentation
└── AGENTS.md                      # Canonical guidance for contributors and coding agents
```

---

## Documentation

All project documentation lives in [`docs/`](./docs/README.md).

| Area | Start here |
| --- | --- |
| **Getting started** | [Getting started](./docs/getting-started.md) · [Hands-on guide](./docs/guides/hands-on.md) |
| **Architecture** | [Overview](./docs/architecture/overview.md) · [Blueprint](./docs/architecture/blueprint.md) · [AI architecture](./docs/architecture/ai.md) · [Data model](./docs/architecture/data-model.md) · [Decision records](./docs/adr/README.md) |
| **Guides** | [Customer POC mode](./docs/guides/customer-poc.md) · [Stakeholder Cards](./docs/guides/stakeholder-cards.md) · [SKU Advisor](./docs/guides/sku-advisor.md) · [Multicloud comparison](./docs/guides/multicloud-compare.md) · [Price sheet vs. calculator](./docs/guides/price-sheet-vs-calculator.md) |
| **Reference** | [API](./docs/reference/api.md) · [Configuration](./docs/reference/configuration.md) · [Infrastructure](./docs/reference/infrastructure.md) · [Glossary](./docs/reference/glossary.md) |
| **Operations** | [Deployment](./docs/operations/deployment.md) · [Runbook](./docs/operations/runbook.md) · [Security](./docs/operations/security.md) · [Testing](./docs/operations/testing.md) · [Troubleshooting](./docs/operations/troubleshooting.md) |
| **Product** | [Stakeholder Cards PRD](./docs/product/prd-stakeholder-cards.md) |

Post-deployment helper scripts are documented in
[infra/scripts/README.md](./infra/scripts/README.md).

---

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) — it covers local
setup for each workspace, the commit and branch conventions, and what a reviewable pull request
looks like.

| | |
| --- | --- |
| 🤝 [Contributing guide](CONTRIBUTING.md) | Local setup, conventions, PR expectations |
| 🔐 [Security policy](SECURITY.md) | How to report a vulnerability privately |
| 💬 [Support](SUPPORT.md) | Where to ask questions, and what is in scope |
| 📜 [Code of Conduct](CODE_OF_CONDUCT.md) | Contributor Covenant 2.1 |
| 📋 [Changelog](CHANGELOG.md) | Notable changes to this project |

> **One rule matters more than the rest:** `infra/arm/azuredeploy.json` is compiled output. If
> you change anything under `infra/bicep/`, recompile it and commit the result in the same pull
> request. CI fails on drift.

---

## Security Notes

- **No registry credentials for the defaults** — versioned runtime images are public and
  pulled anonymously from GHCR.
- **Entra ID sign-in required** — the public ingress is protected by Container Apps Easy Auth (`enableEasyAuth`); without it every `/api/*` route is anonymous.
- **No hardcoded secrets** — credentials are stored in Azure Key Vault and reached through Container App Key Vault references, or avoided entirely via Managed Identity.
- **No lab/personal data** committed to this repository. All files use `<PLACEHOLDER_*>` values.
- **Secret scanning on every pull request** — CI runs gitleaks against the diff.
- See [docs/security.md](./docs/operations/security.md) for the full security checklist,
  and [SECURITY.md](SECURITY.md) to report a vulnerability privately.

---

## License

MIT — see [LICENSE](LICENSE) for details. Third-party attributions are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
