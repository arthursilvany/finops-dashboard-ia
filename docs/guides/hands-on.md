# FinOps Dashboard — Hands-on Guide

## Prerequisites

| Requirement | Version                            | Check Command            |
| ----------- | ---------------------------------- | ------------------------ |
| Node.js     | 18+                                | `node --version`         |
| npm         | 9+                                 | `npm --version`          |
| Azure CLI   | 2.50+                              | `az --version`           |
| Azure login | Active session                     | `az account show`        |
| ADX access  | Database Viewer role on FinOps Hub | `az kusto database show` |

## Quick Start

### 1. Install dependencies

```bash
cd apps/finops-dashboard
npm install
```

### 2. Configure environment

Copy the example file and fill in your ADX cluster details:

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```env
# Your FinOps Hub ADX cluster URI
ADX_CLUSTER_URI=https://your-finops-hub.region.kusto.windows.net
ADX_DATABASE=Hub

# Azure OpenAI (required for AI Chat and Daily Insights)
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=gpt-4o

# Azure Pricing MCP server URL (start with: npm run dev:full)
AZURE_PRICING_MCP_URL=http://localhost:8080

# Azure Subscription ID (required for Remediation Impact Cards — Advisor queries)
AZURE_SUBSCRIPTION_ID=your-subscription-id

# Set to true to use mock data (no ADX connection needed)
NEXT_PUBLIC_USE_MOCK=false

# Dashboard defaults
NEXT_PUBLIC_DEFAULT_BUDGET=10000
NEXT_PUBLIC_DEFAULT_MONTHS=6
NEXT_PUBLIC_DEFAULT_DAYS=28
```

### 3. Authenticate with Azure

For local development, authenticate with Azure CLI:

```bash
az login
az account set --subscription "your-subscription-id"
```

The dashboard uses `DefaultAzureCredential`, which picks up your `az login` session automatically.

### 4. Start the dashboard

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. The dashboard redirects to the Cost Summary page.

> **AI features (Chat + Daily Insights)** also require the Azure Pricing MCP server.
> Use the combined command to start both together:
>
> ```bash
> npm run dev:full
> ```
>
> This runs the MCP server on port 8080 and Next.js on port 3000 in parallel.

### 5. Mock mode (no ADX required)

To run without an ADX connection, either:

- Omit `ADX_CLUSTER_URI` from `.env.local`, or
- Set `NEXT_PUBLIC_USE_MOCK=true`

Mock mode provides realistic sample data for all dashboard pages.

## Dashboard Pages

### Cost Summary (`/cost-summary`)

Mirrors the `CostSummary.kql.pbit` Power BI template:

- **KPI Cards**: Total cost last month, month-over-month change %, daily average, top service, reservation coverage %
- **Monthly Trend**: Bar chart showing cost over the last 6 months
- **Service Breakdown**: Pie/donut chart of cost by service (top 10 + Others)
- **Daily Cost**: Area chart of daily spending (last 28 days)
- **Subscription View**: Pie chart of cost per subscription

### Rate Optimization (`/rate-optimization`)

Mirrors the `RateOptimization.kql.pbit` Power BI template:

- **KPI Cards**: Total potential savings, commitment gap savings, idle resource waste
- **Coverage Gauge**: Visual indicator of commitment coverage percentage
- **Commitment Gap**: Stacked bar chart showing on-demand vs committed by service
- **Impact Analysis**: Horizontal bars showing savings impact by recommendation
- **Idle Resources**: Table listing resources with zero utilization

### Anomalies (`/anomalies`)

- **KPI Cards**: Anomalies in last 7 days, 30 days, largest deviation, last anomaly date
- **Timeline**: Area chart showing actual vs baseline cost with anomaly markers
- **Top Resources**: Table of resources contributing most to detected anomalies

### Budgets (`/budgets`)

- **KPI Cards**: Spent this month, daily burn rate, projected month-end, status indicator
- **Utilization Gauge**: How much of the monthly budget has been consumed
- **Budget vs Actual**: Area chart comparing cumulative spend against budget line
- **Forecast**: Confidence band chart showing projected spend with upper/lower bounds
- **By Subscription**: Table breaking down budget allocation per subscription

### Daily Insights (`/daily-insights`)

- **Auto-generated report**: AI-written executive summary triggered once per day (cached in `.data/daily-insights/YYYY-MM-DD.json`)
- **Generation history**: List of past report dates with quick navigation
- **Regenerate button**: Force a fresh report for the current day
- **Markdown rendering**: Report rendered with full formatting support

### Azure Pricing (`/azure-pricing`)

- **Natural-language query**: Ask about any Azure service price (e.g. "D4s_v5 brazilsouth")
  — resolved via Azure Pricing MCP
- **Quick queries**: Pre-built buttons for common lookups (VMs, SQL, Storage, AKS, Cosmos DB)
- **CSV/JSON upload**: Upload a resource list for bulk price estimation
- **Price source selector**: Retail (prices.azure.com) vs Contract (Prices_v1_2() ADX function)
- **Environment toggle**: Production vs Dev/Test pricing

### Cost Simulator (`/cost-simulator`)

- **Price source toggle**: Switch between Retail (public list pricing from Prices.Azure.com) and
  Contract (enterprise contract pricing from ADX `Prices_v1_2()` function). Toggle buttons display:
  - 💲 **Retail** (default) — public list pricing
  - 📄 **Contract** — contract/committed pricing (~8% cheaper)
- **Preference persistence**: Selected price source is saved in browser localStorage key
  `simulator_price_source` and automatically restored on next visit
- **Interactive estimate form**: Select service (VM, Storage, DB, AKS), region (brazilsouth, eastus,
  westeurope, etc.), SKU (Standard_B2s, Standard_D2s_v5, etc.), and quantity to model a deployment
  cost before provisioning
- **Commitment comparison**: Compare On-Demand, 1-Year, and 3-Year monthly pricing side by side with
  automatic recommendation of best-value term
- **Recommendation card**: Highlights the suggested commitment option based on projected savings and
  break-even timing
- **Break-even timeline**: Visual bars show when 1-year and 3-year commitments recover their upfront
  tradeoff (typical: 1-year breaks even in 1–2 months, 3-year in 3–4 months)
- **Pricing comparison table**: Shows monthly cost, annual cost, savings delta, and break-even months
  for each option
- **Real pricing examples** (tested on 2025-05-03):
  - **Standard_B2s (5 qty, eastus, on-demand)**:
    - Retail: $200.75/month → 1yr: $156.59/month | 3yr: $122.46/month
    - Contract: $184.69/month (8% savings) → 1yr: $143.90/month | 3yr: $112.62/month
  - **Standard_D2s_v5 (2 qty, eastus, on-demand)**:
    - Retail: $160.60/month
    - Contract: $147.75/month (8% savings)
- **Fallback behavior**: Uses the selected price source (ListUnitPrice for retail,
  ContractedUnitPrice for contract) from ADX when available. Falls back to deterministic mock math
  with 0.92 multiplier for contract pricing when baseline fields are missing or invalid.
  Response includes `metadata.isMock` flag to indicate data source.
- **Data source**: `POST /api/simulator/estimate` (returns `{ data, metadata }`). Validates request
  against supported service/region/SKU options. Accepts query parameters:
  - `service`: "VM" | "Storage" | "DB" | "AKS"
  - `region`: Valid Azure region code (brazilsouth, eastus, etc.)
  - `sku`: Service-specific SKU identifier
  - `qty`: Quantity (integer)
  - `priceSource`: "retail" | "contract" (defaults to "retail")
  - `commitment`: "ondemand" | "1yr" | "3yr"

### Reservation Detail (`/reservation-detail`)

- **Commitment selector**: Browse all active reservations and Savings Plans by name/type
- **Utilization gauge**: Used vs Unused cost for the selected commitment
- **Trend chart**: Monthly utilization trend over the configured period
- **Drill-down table**: Resource-level breakdown of consumption against the commitment

### Settings (`/settings`)

- **ADX connection form**: Configure `ADX_CLUSTER_URI` and `ADX_DATABASE` at runtime without restarting
- **Test connection**: Validates connectivity and role access directly from the UI
- **Current config view**: Shows active configuration (cluster URI, database, mock mode)

### Workload (`/workload`)

- **KPI Cards**: Total recommendation count, reservation candidates, potential monthly savings
  (daily × 30), avg CPU utilization (0 when no CPU data available)
- **CPU vs Cost Scatter**: Bubble chart — each recommendation plotted by savings % vs monthly cost; labeled by SKU + region
- **Rightsizing Recommendations**: Table listing reservation recommendations with
  current/recommended SKU (from `x_RecommendationDetails` JSON), monthly cost
  before/after, and projected savings
- **Data source**: `Recommendations_final_v1_2` in the `Ingestion` database, queried via
  `executeQuery(kql, "Ingestion")`. Uses FOCUS-schema columns
  (`x_EffectiveCostBefore`, `x_EffectiveCostAfter`, `x_EffectiveCostSavings`,
  `x_RecommendationDetails`). Cross-database `database('Ingestion').Table` syntax is not
  supported on public FinOps Hub clusters.

### Governance (`/governance`)

- **KPI Cards**: Compliance score, untagged resources, policy violations, exempt resources
- **Tag Compliance**: Horizontal bar chart showing % compliance per required tag (`env`, `owner`, `cost-center`)
- **Budget vs Actual**: Grouped bar chart comparing budget vs actual spend per subscription or BU
- **Compliance Table**: Inline resource compliance status rows
- **Data source**: `Costs()` with `todynamic(Tags)['key']` for tag presence validation

### Chargeback (`/chargeback`)

- **KPI Cards**: Total allocated cost, untagged/unallocated cost, number of business units, largest BU share
- **Cost by BU**: Pie/donut chart — cost distribution across business units (via `cost-center` tag)
- **Monthly Trend**: Area chart showing chargeback trend per BU over the last 4 months
- **BU Detail Table**: Per-BU breakdown with total cost, resource count, and trend indicator
- **Data source**: `Costs()` with `todynamic(Tags)['cost-center']` for BU allocation

### AI Insights (`/ai-insights`)

- **Hero Panel**: Gradient header with AI-generated insight count and total impact
- **FinOps KPI Cards**: 6 executive cards aggregating all Advisor recommendations
  (up to 200): Total Saving (Advisor), Remediation Cost (Reliability), Remediation Cost
  (Security), Total Remediation Cost, Net Financial Impact, and No-Cost Remediations.
  All values are displayed in the **FinOps Hub billing currency** (for example, BRL),
  with automatic USD-to-local conversion for Advisor savings.
- **Insight Cards**: Cards with category badge, title, description, recommended action, and impact amount
- **Forecast Band**: Confidence band chart showing cost forecast
  (historical + projected with upper/lower bounds), built from ADX
  `series_decompose_forecast()` with daily step and monthly aggregation
- **WAF Radar**: Spider chart comparing current vs target scores across 6 WAF pillars
  — scores computed from Azure Resource Graph Advisor recommendations
- **Inline Chat**: Persistent chat interface that calls `POST /api/chat` for follow-up questions
- **Remediation Impact Cards**: Cards with Azure Advisor remediation recommendations,
  estimated cost (via Price Sheet ADX -> Azure Pricing MCP -> Retail API -> heuristic chain),
  financial impact badges, and on-demand AI insight powered by GPT-4o + Microsoft Learn RAG.
  Expand a card to get: downtime risk, confidence score (boosted +0.1 with Learn docs),
  technical context, risk assessment, and clickable Microsoft Learn source references.
  All monetary values in the contract billing currency.
- **Data source**: Composite — Advisor recommendations via Azure Resource Graph
  (`resource-graph-client.ts`), cost estimation via 4-source chain
  (`Prices_v1_2()` ADX -> Azure Pricing MCP -> Retail API -> heuristic), exchange rate from
  `Prices_v1_2()` (`BillingCurrency` + `ContractedUnitPrice / ListUnitPrice` ratio),
  cost forecast via ADX `Costs()`, AI analysis via Azure OpenAI GPT-4o + Microsoft Learn MCP
  (`fetchLearnContext` RAG pipeline). Falls back to mock data if Advisor returns zero results.

### Agentic FinOps (`/agentic-finops`)

- **Lifecycle Banner**: Visual 6-stage agentic pipeline
  (Detect -> Analyze -> Decide -> Execute -> Validate -> Learn) showing active stages
  with recommendation counts and future stages (Phase 3) greyed out
- **KPI Cards**: Total recommendations, potential annual savings (BRL), ready-for-action count, pending-approval count
- **Savings by Category**: Pie chart breaking down potential savings by recommendation
  category (Idle Resources, Rightsizing, Reservations, SKU Optimization, Orphaned Resources)
- **Distribution by Risk**: Stacked column chart with color-coded series (green/amber/red) for Low/Medium/High risk levels
- **Recommendation Cards** (E1): Filterable list (All / Ready / Pending / Analyzing / Decision)
  — each card shows impact/risk/stage badges, resource details, savings estimate,
  confidence bar, and an active **"Apply Action"** button for recommendations in `ready`
  or `pending-approval` stage. Clicking opens a **ConfirmationModal** that runs
  pre-condition checks (resource existence, idle threshold, estimated savings) before
  execution. After confirming, a result badge (Executed/Failed) appears inline on the card.
- **Execution Savings KPIs** (E1): 4 KPI cards showing Realized Savings
  (`totalRealizedSavings`), Executed Actions (`executionsCount`), Accuracy
  (`accuracyPercent`), and Estimated Savings (`totalEstimatedSavings`), plus a savings
  detail table (Resource / Action / Cost Before / Actual Cost / Real Savings)
- **Execution Log** (E1): Historical table of executed actions — columns:
  Date/Time, Resource, Action, Executor, Status (Success / Failed / Pending badges)
- **Data source**: Azure Resource Graph — `advisorresources` where `category == "Cost"`
  via `queryAdvisorCostAgentic()` in `resource-graph-client.ts`. Rule-based classification
  (no GPT) maps action types, risk levels, and agentic stages from impact + savings
  thresholds. Falls back to 8 realistic mock recommendations when no Azure credentials are
  available. Execution log and savings data are served from `/api/executions` and
  `/api/executions/savings` (ADX stub, mock fallback).

#### E1 — Supported Remediation Actions

| Action        | UI Label            | Description                             |
| ------------- | ------------------- | --------------------------------------- |
| `stop_vm`     | Stop VM             | Deallocate an idle virtual machine      |
| `resize_vm`   | Resize VM           | Change VM SKU to a smaller/cheaper size |
| `delete_disk` | Remove Orphan Disk  | Delete an unattached managed disk       |
| `delete_ip`   | Remove Public IP    | Release an unused public IP address     |
| `change_sku`  | Change SKU          | Switch a resource to a lower-cost SKU   |

#### E1 — Execution Flow

1. User clicks **"Apply Action"** on a recommendation card
2. `runPreConditionChecks(resourceId)` calls `GET /api/remediation/execute?precheck=1&resourceId=...`
3. ConfirmationModal shows pre-condition results — blocks confirm if any check has `status: "block"`
4. User confirms → `executeRemediation(req)` calls `POST /api/remediation/execute` with `{ resourceId, action, dryRun }`
5. Result badge updates inline; execution log refreshes via SWR

### AI Costs (`/ai-costs`)

- **KPI Cards**: Total AI cost (30d), previous period cost, change percentage, top model with cost
- **Cost by Model**: Pie chart breaking down Cognitive Services spend by model
  (GPT-4o, GPT-4, GPT-3.5-Turbo, Ada, Whisper, DALL-E, etc.)
- **Daily Trend**: Area chart showing daily AI spend over the last 30 days
- **Top Resources**: Table of highest-cost AI resources (resource name, model, cost, percentage)
- **Anomaly Timeline**: Area chart comparing actual AI cost vs statistical baseline — highlights deviations
- **Anomaly Resources**: Table of resources with the most anomalous spending (anomaly count, excess cost)
- **BU Allocation**: Table showing AI cost allocation by business unit, application, and model with percentage breakdown
- **Data source**: ADX `Costs()` table filtered by
  `ConsumedService == "Microsoft.CognitiveServices"`. Model extracted from
  `AdditionalInfo` JSON. Anomaly detection uses statistical baseline (mean + 2σ)
  over a 30-day rolling window. Falls back to mock data when no ADX connection is available.

## ADX Connection Setup

### Grant Database Viewer Access

Your Azure identity needs at minimum `Database Viewer` role on **both** FinOps Hub databases (`Hub` and `Ingestion`):

```bash
# Replace with your FinOps Hub cluster and database
# Hub database (cost data)
az kusto database-principal-assignment create \
    --cluster-name "your-finops-hub" \
    --database-name "Hub" \
    --resource-group "your-rg" \
    --principal-assignment-name "dashboard-viewer" \
    --principal-id "your-user-object-id" \
    --principal-type "User" \
    --role "Viewer"

# Ingestion database (reservation recommendations)
az kusto database-principal-assignment create \
    --cluster-name "your-finops-hub" \
    --database-name "Ingestion" \
    --resource-group "your-rg" \
    --principal-assignment-name "dashboard-viewer-ingestion" \
    --principal-id "your-user-object-id" \
    --principal-type "User" \
    --role "Viewer"
```

### Find Your ADX Cluster URI

```bash
az kusto cluster show \
    --name "your-finops-hub" \
    --resource-group "your-rg" \
    --query "uri" -o tsv
```

The output (e.g., `https://your-finops-hub.westus.kusto.windows.net`) goes into `ADX_CLUSTER_URI`.

### Verify Connectivity

After starting the dashboard, check the health endpoint:

```bash
curl http://localhost:3000/api/health
```

Expected response (live mode):

```json
{
  "status": "healthy",
  "mode": "live",
  "adx": {
    "connected": true,
    "cluster": "https://your-finops-hub.westus.kusto.windows.net",
    "database": "Hub"
  }
}
```

## Dashboard Parameters

Several API endpoints accept query parameters that configure the data range:

| Parameter | Endpoints                                            | Default | Description                        |
| --------- | ---------------------------------------------------- | ------- | ---------------------------------- |
| `months`  | `/api/cost-summary/over-time`                        | 6       | Number of months for trend charts  |
| `days`    | `/api/cost-summary/daily`, `/api/anomalies/timeline` | 28      | Number of days for daily charts    |
| `top`     | `/api/cost-summary/by-service`                       | 10      | Max items before "Others" grouping |
| `budget`  | `/api/budgets/*`                                     | 10000   | Monthly budget amount (USD)        |
| `date`    | `/api/anomalies/top-resources`                       | latest  | ISO date to drill into anomaly     |

## Adding New KQL Queries

### 1. Define the query function

Create or extend a file in `src/lib/queries/`:

```typescript
// src/lib/queries/my-new-queries.ts
export function myNewQuery(param: number): string {
  return `
    CostsPlus
    | where ChargePeriodStart >= ago(${param}d)
    | summarize TotalCost = sum(EffectiveCost) by ConsumedService
    | order by TotalCost desc
    | take 10
  `;
}
```

### 2. Add mock data

Create `src/lib/mock-data/my-new-data.ts` with sample data matching the expected response shape.

### 3. Create the API route

Add `src/app/api/my-endpoint/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { executeQuery, isMockMode } from "@/lib/adx-client";
import { myNewQuery } from "@/lib/queries/my-new-queries";
import { mockMyNewData } from "@/lib/mock-data/my-new-data";

export async function GET() {
  if (isMockMode()) {
    return NextResponse.json({
      data: mockMyNewData,
      metadata: { queriedAt: new Date().toISOString(), isMock: true },
    });
  }

  const result = await executeQuery(myNewQuery(30));
  const data = result.rows.map((r) => ({
    service: r.ConsumedService as string,
    cost: r.TotalCost as number,
  }));

  return NextResponse.json({
    data,
    metadata: { queriedAt: new Date().toISOString(), isMock: false },
  });
}
```

### 4. Create an SWR hook

Add to `src/hooks/`:

```typescript
import { useApi } from "./useApi";

export function useMyNewData() {
  return useApi<MyDataType[]>("/api/my-endpoint");
}
```

### 5. Add to a page

Import the hook in your page component and render with the appropriate chart or table component.

## Adding New Dashboard Pages

1. Create `src/app/my-page/page.tsx` with `"use client"` directive
2. Add the navigation link in `src/components/NavSidebar.tsx`
3. Create corresponding API routes, mock data, and hooks as described above

## Production Build

```bash
npm run build    # TypeScript compilation + optimization
npm run start    # Serve production build on port 3000
```

## Project Structure

```text
apps/finops-dashboard/
├── .env.local.example          # Environment template
├── package.json
├── next.config.js              # CSP headers
├── tailwind.config.ts          # Dark theme, custom colors
├── tsconfig.json
└── src/
    ├── app/
    │   ├── layout.tsx              # Root layout (dark theme, sidebar)
    │   ├── page.tsx                # Redirect → /cost-summary
    │   ├── globals.css             # Tailwind imports, dark + light theme overrides
    │   ├── cost-summary/           # Cost Summary page
    │   ├── rate-optimization/      # Rate Optimization page
    │   ├── anomalies/              # Anomalies page
    │   ├── budgets/                # Budgets page
    │   ├── workload/               # Workload & Rightsizing page
    │   ├── governance/             # Governance & Compliance page
    │   ├── chargeback/             # Chargeback & Cost Allocation page
    │   ├── ai-insights/            # AI Insights & WAF Radar page
    │   ├── daily-insights/         # AI Daily Insights page
    │   ├── azure-pricing/          # Azure Pricing query page
    │   ├── reservation-detail/     # Commitment/reservation drill-down
    │   ├── settings/               # ADX connection settings
    │   ├── api/                    # 44 BFF API routes + health
    ├── components/             # 19 shared UI components
    │   ├── KpiCard.tsx
    │   ├── GaugeChart.tsx
    │   ├── ColumnChart.tsx
    │   ├── AreaChart.tsx
    │   ├── PieChart.tsx
    │   ├── BandChart.tsx
    │   ├── ScatterChart.tsx        # CPU vs cost bubble chart
    │   ├── RadarChart.tsx          # WAF spider/radar chart
    │   ├── ThemeToggle.tsx         # Light/dark mode toggle
    │   ├── DataTable.tsx
    │   ├── ImpactBar.tsx
    │   ├── StatusCards.tsx
    │   ├── ChartCard.tsx
    │   ├── NavSidebar.tsx          # Sectioned nav (Analytics / AI & Alerts / Finance)
    │   ├── CopilotChat.tsx         # Floating AI chat panel
    │   ├── RemediationCard.tsx     # Remediation impact card with on-demand AI insight
    │   ├── DateRangePicker.tsx
    │   ├── FilterBar.tsx
    │   └── MultiSelectDropdown.tsx
    ├── hooks/                  # 16 SWR hook files
    │   ├── useApi.ts
    │   ├── useAnomalies.ts
    │   ├── useAzurePricing.ts
    │   ├── useBudgets.ts
    │   ├── useConfig.tsx
    │   ├── useCostSummary.ts
    │   ├── useDailyInsights.ts
    │   ├── useFilterOptions.ts
    │   ├── useFilters.tsx
    │   ├── useRateOptimization.ts
    │   ├── useRemediationImpact.ts  # Remediation cards (SWR 15min refresh)
    │   ├── useReservations.ts
    │   ├── useWorkload.ts          # Workload KPI, CPU scatter, rightsizing
    │   ├── useGovernance.ts        # Governance KPI, tag compliance, budget vs actual
    │   ├── useChargeback.ts        # Chargeback KPI, by-BU, trend
    │   └── useAiInsights.ts        # AI Insights bundle
    └── lib/
        ├── adx-client.ts           # ADX singleton + mock mode
        ├── agent-engine.ts         # Full 8-tool MCP agent (12 iterations)
        ├── azure-pricing-mcp-client.ts  # MCP HTTP client for Azure Pricing
        ├── chat-system-prompt.ts   # FINOPS_SYSTEM_PROMPT + TOOL_DEFINITIONS
        ├── daily-insights-store.ts # File-based cache for daily reports
        ├── filter-schema.ts        # Zod schema for UI filter state
        ├── microsoft-learn-client.ts  # MCP HTTP client for Microsoft Learn
        ├── openai-client.ts        # Azure OpenAI singleton + token cache
        ├── types.ts                # TypeScript interfaces
        ├── queries/                # 10 KQL query files
        │   ├── anomalies.ts
        │   ├── budgets.ts
        │   ├── cost-summary.ts
        │   ├── filter-builder.ts
        │   ├── rate-optimization.ts
        │   ├── remediation-impact.ts   # Remediation cards + RAG insight (Learn MCP)
        │   ├── reservations.ts
        │   ├── workload.ts          # Rightsizing & CPU queries (Ingestion DB)
        │   ├── governance.ts        # Tag compliance & budget vs actual queries
        │   └── chargeback.ts        # BU allocation queries (todynamic(Tags))
        └── mock-data/              # 9 mock data files
            ├── anomalies.ts
            ├── budgets.ts
            ├── cost-summary.ts
            ├── rate-optimization.ts
            ├── reservations.ts
            ├── workload.ts
            ├── governance.ts
            ├── chargeback.ts
            └── ai-insights.ts
```

## Troubleshooting

### "ADX_CLUSTER_URI environment variable is not set"

The dashboard is trying to connect to ADX but no cluster URI is configured. Either:

- Add `ADX_CLUSTER_URI` to `.env.local`
- Set `NEXT_PUBLIC_USE_MOCK=true` to use mock data

### Health endpoint shows `"connected": false`

- Verify `az login` session is active: `az account show`
- Check ADX cluster URI is correct and reachable
- Verify your identity has `Database Viewer` role on the `Hub` database

### Charts not rendering

- Check browser console for JavaScript errors
- Verify API endpoints return data: `curl http://localhost:3000/api/cost-summary/kpi`
- In mock mode, all charts should render with sample data

### Build errors

```bash
npx tsc --noEmit    # Check TypeScript errors
npm run lint        # Check ESLint issues
```
