# Architecture

## Overview

The FinOps Dashboard IA is a containerized web application that provides real-time visibility into Azure cloud spend. It is designed as a stateless application that connects to external analytics backends for data and uses Azure Managed Identity for zero-credential authentication.

---

## Component Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  Azure Resource Group                                               │
│                                                                     │
│  ┌───────────────────────────────────────┐                         │
│  │  Container Apps Environment           │                         │
│  │  (Consumption / Dedicated)            │                         │
│  │                                       │                         │
│  │  ┌─────────────────────────────────┐  │   ┌──────────────────┐ │
│  │  │  Container App                  │  │   │  Container       │ │
│  │  │  finops-dashboard               ◄──┼───┤  Registry (ACR)  │ │
│  │  │  Port 3000 (Next.js 16)         │  │   │  [AcrPull role]  │ │
│  │  └────────────┬────────────────────┘  │   └──────────────────┘ │
│  │               │                       │                         │
│  └───────────────┼───────────────────────┘                         │
│                  │ Managed Identity (UAMI)                          │
│  ┌───────────────▼────────────────┐                                │
│  │  User-Assigned Managed Identity│                                │
│  │  (AcrPull + analytics RBAC)    │                                │
│  └────────────────────────────────┘                                │
│                                                                     │
│  ┌────────────────────────────────┐                                │
│  │  Log Analytics Workspace       │                                │
│  │  (Container App diagnostics)   │                                │
│  └────────────────────────────────┘                                │
└─────────────────────────────────────────────────────────────────────┘
         │
         │ Outbound (HTTPS)
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Analytics Backends (external — not deployed by this template)      │
│                                                                     │
│   Option A: Azure Data Explorer (ADX)                               │
│     https://<CLUSTER>.<REGION>.kusto.windows.net                    │
│                                                                     │
│   Option B: Microsoft Fabric RTI                                    │
│     https://<CLUSTER>.<REGION>.kusto.fabric.microsoft.com           │
│                                                                     │
│   Option C: Azure AI Foundry                                        │
│     https://<RESOURCE>.services.ai.azure.com/api/projects/<PROJECT> │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

1. **User** opens the dashboard in a browser.
2. **Container App** serves the Next.js application on port 3000.
3. The application authenticates to the analytics backend using the **User-Assigned Managed Identity** (Managed Identity mode) or the configured credentials (Service Principal / API Key).
4. The analytics backend executes KQL or API queries and returns results.
5. The dashboard renders charts (ECharts) and AI-generated summaries.
6. All container logs flow to the **Log Analytics Workspace** for monitoring and alerting.

---

## Technology Stack

| Layer              | Technology                                    |
| ------------------ | --------------------------------------------- |
| Frontend framework | Next.js 16 (App Router) + TypeScript          |
| Styling            | Tailwind CSS                                  |
| Charts             | Apache ECharts                                |
| Azure SDK          | `@azure/identity`, `@azure/arm-resourcegraph` |
| AI                 | Azure OpenAI / Azure AI Foundry               |
| Container          | Docker multi-stage build (Node 22 Alpine)     |
| Runtime            | Azure Container Apps (Consumption plan)       |
| Registry           | Azure Container Registry                      |
| IaC                | Azure Bicep → ARM JSON                        |

---

## Analytics Backend Options

### Azure Data Explorer (ADX)

- Connect to any ADX cluster. The dashboard sends KQL queries via the Azure Data Explorer REST API.
- Authentication: the Managed Identity is granted **`Database Viewer`** role on the target database.
- Example URI: `https://yourcluster.eastus.kusto.windows.net`

### Microsoft Fabric Real-Time Intelligence (RTI)

- Connect to a KQL database in a Fabric workspace.
- Authentication: Managed Identity must be granted **Fabric Viewer** at the workspace level.
- Either provide a full `fabricQueryUri` or a `fabricWorkspaceId` + `fabricKqlDatabaseName` pair.

### Azure AI Foundry

- Connect to a Foundry project for AI-powered analytics queries.
- Authentication: Managed Identity is granted the **Azure AI User** role on the Foundry resource.
- Optionally configure a model deployment for natural language cost queries.

### None

- Deploy the dashboard infrastructure without connecting an analytics backend.
- Backend connection strings can be added post-deployment via Container App environment variables.

---

## Security Architecture

- **Managed Identity** (User-Assigned) is the default and recommended authentication mode. No secrets to rotate.
- **ACR image pull** uses the Managed Identity (AcrPull role), not admin credentials.
- Container App **secrets** are used when Service Principal or API Key auth is selected. Secrets are never stored in ARM parameters or environment variable values.
- All outbound HTTPS traffic. Inbound restricted to Container Apps platform.
- Log Analytics Workspace retains logs for the configured retention period (7–730 days).

See [security.md](../operations/security.md) for the full post-deployment security checklist and RBAC role assignments.

---

## Infrastructure as Code

The Bicep source of truth is in `infra/bicep/finops-dashboard/`. The compiled ARM JSON at `infra/arm/azuredeploy.json` is what the CLI and the published Template Spec use.

To recompile the ARM JSON after modifying Bicep:

```bash
bicep build infra/bicep/finops-dashboard/main.bicep \
  --outfile infra/arm/azuredeploy.json
```

Bicep modules:

| Module                            | Purpose                                                  |
| --------------------------------- | -------------------------------------------------------- |
| `main.bicep`                      | Main orchestrator — wires all modules together            |
| `modules/identities.bicep`        | User-Assigned Managed Identity                            |
| `modules/acr.bicep`               | Azure Container Registry                                  |
| `modules/environment.bicep`       | Log Analytics + Container Apps Environment (shared)       |
| `modules/containerapp.bicep`      | Dashboard Container App (external ingress + Easy Auth)    |
| `modules/mcp-containerapp.bicep`  | Optional pricing MCP Container App (**internal** ingress) |

The MCP server is a plain HTTP server, not an Azure Functions app, so it is deployed as a
Container App rather than a function app. It has no authentication of its own, which is why its
ingress is internal-only — that is a security requirement, not a cost optimization. Because two
apps now share one environment, the environment lives in its own module instead of inside
`containerapp.bicep`.
