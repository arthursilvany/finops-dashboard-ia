# FinOps Dashboard — Architecture Blueprint

## Overview

A web-based FinOps dashboard that visualizes Azure cost data from an existing FinOps Hub ADX (Azure Data Explorer) cluster. The dashboard replaces Power BI templates (`CostSummary.kql.pbit`, `RateOptimization.kql.pbit`) with a real-time, browser-based experience.

**Stack**: Next.js 16 (App Router) + React 19 + Tailwind CSS + Apache ECharts + Azure Data Explorer SDK

## Architecture Diagram

```mermaid
graph LR
    subgraph Browser
        A[React + ECharts<br/>SWR polling 60s/15min]
        RC[RemediationCard<br/>on-demand AI insight]
    end

    subgraph "Next.js BFF (localhost:3000)"
        B[API Routes<br/>51 endpoints]
        C[ADX Client<br/>Singleton]
        D[Mock Data<br/>Fallback]
    end

    subgraph "Existing FinOps Hub"
        E[Azure Data Explorer<br/>Database: Hub]
        F[CostsPlus Table<br/>FOCUS-aligned]
        I[Database: Ingestion<br/>Recommendations_final_v1_2]
    end

    subgraph Auth
        G[DefaultAzureCredential]
        H["az login (dev)<br/>Managed Identity (prod)"]
    end

    A -->|fetch /api/*| B
    RC -->|POST /api/remediation-insight| B
    B -->|mock mode| D
    B -->|live mode| C
    C -->|KQL| E
    E --- F
    C -->|KQL (overrideDatabase)| I
    C -->|token| G
    G --- H
```

## Data Flow

```
CostsPlus (ADX) ──KQL──> ADX Client ──JSON──> API Route ──HTTP──> SWR Hook ──state──> ECharts
                                                  │
                                        Zod validation on
                                        query parameters
```

1. **SWR hooks** poll `/api/*` endpoints every 60 seconds (15 minutes for remediation impact cards)
2. **API Routes** check `isMockMode()` — returns mock data if no ADX connection
3. In live mode, the **ADX Client** singleton executes parameterized KQL against the `Hub` database
4. Results map to typed TypeScript interfaces and return as JSON
5. **ECharts** components render gauges, line/area charts, bar charts, pie/donut charts

## Dashboard Pages

| Page               | Route                 | Data Source         | Key Visuals                                                                                                                                                                                                                                                                                        |
| ------------------ | --------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cost Summary       | `/cost-summary`       | 5 API routes        | KPI cards (incl. Reservation Coverage), monthly bar chart, service pie, daily area, subscription table                                                                                                                                                                                             |
| Rate Optimization  | `/rate-optimization`  | 4 API routes        | KPI cards, coverage gauge, commitment gap bars, impact bars, idle resources table                                                                                                                                                                                                                  |
| Anomalies          | `/anomalies`          | 3 API routes        | KPI cards, timeline with anomaly markers, top resources table                                                                                                                                                                                                                                      |
| Budgets            | `/budgets`            | 4 API routes        | KPI cards, utilization gauge, budget vs actual area, forecast confidence band, subscription table                                                                                                                                                                                                  |
| Workload           | `/workload`           | 3 API routes        | KPI cards, CPU vs cost scatter/bubble chart, rightsizing recommendations table                                                                                                                                                                                                                     |
| Governance         | `/governance`         | 3 API routes        | KPI cards, tag compliance bars, budget vs actual bars, compliance status table                                                                                                                                                                                                                     |
| Chargeback         | `/chargeback`         | 3 API routes        | KPI cards, cost by BU pie chart, monthly trend area chart, BU detail table                                                                                                                                                                                                                         |
| AI Insights        | `/ai-insights`        | 4 API routes        | Gradient hero, **6 FinOps KPI Cards** (savings, remediation costs, net impact — currency-converted), insight cards, forecast band, WAF radar, inline chat, **Remediation Impact Cards** with on-demand GPT-4o + Microsoft Learn RAG                                                                |
| Agentic FinOps     | `/agentic-finops`     | 4 API routes        | Lifecycle banner (Detect→Analyze→Decide→Execute→Validate→Learn), 4 KPI cards, savings-by-category pie, risk-level column chart, filterable recommendation cards with **active Execute button** (E1), ConfirmationModal with pre-checks, execution savings KPIs + detail table, execution log table |
| Daily Insights     | `/daily-insights`     | 3 API routes        | AI-generated daily executive report (Markdown), generation history, cached per day                                                                                                                                                                                                                 |
| Azure Pricing      | `/azure-pricing`      | 2 API routes        | Natural-language price query via Azure Pricing MCP, CSV/JSON upload, retail vs contract comparison                                                                                                                                                                                                 |
| Cost Simulator     | `/cost-simulator`     | Simulator API route | Interactive service/region/SKU/quantity estimate form, retail/contract price source toggle (localStorage persistence), commitment recommendation card, break-even timeline, pricing comparison table, real pricing data (e.g. Standard_B2s retail $200.75 → contract $184.69 monthly)              |
| Reservation Detail | `/reservation-detail` | 3 API routes        | Commitment detail drill-down, trend chart, unused reservation analysis                                                                                                                                                                                                                             |
| AI Costs           | `/ai-costs`           | 7 API routes        | KPI cards (total, previous, change%, top model), cost-by-model pie, daily trend area, top resources table, anomaly timeline, anomaly resources table, BU allocation table                                                                                                                          |
| Settings           | `/settings`           | 3 API routes        | ADX connection config (cluster URI, database), save/connect/test controls                                                                                                                                                                                                                          |

## API Routes

All dashboard API routes follow the same pattern:

```typescript
// 1. Validate query params with Zod
// 2. Check isMockMode() → return mock data OR execute KQL
// 3. Map ADX response to typed interface
// 4. Return { data: T, metadata: { queriedAt, isMock } }
```

| Group                      | Endpoints                                                                                  | Query Params                                       |
| -------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `/api/cost-summary/*`      | kpi, over-time, by-service, by-subscription, daily                                         | months, days, top                                  |
| `/api/rate-optimization/*` | commitment-gap, savings, actions, idle                                                     | —                                                  |
| `/api/anomalies/*`         | timeline, summary, top-resources                                                           | days, date                                         |
| `/api/budgets/*`           | burn-rate, vs-actual, by-subscription, forecast                                            | budget                                             |
| `/api/workload/*`          | kpi, cpu-scatter, rightsizing                                                              | —                                                  |
| `/api/governance/*`        | kpi, tag-compliance, budget-vs-actual                                                      | —                                                  |
| `/api/chargeback/*`        | kpi, by-bu, trend                                                                          | —                                                  |
| `/api/ai-insights`         | ai-insights (GET)                                                                          | —                                                  |
| `/api/ai-costs/*`          | kpi, by-model, daily, by-resource, anomalies/timeline, anomalies/top-resources, allocation | —                                                  |
| `/api/daily-insights/*`    | generate, history, [date]                                                                  | —                                                  |
| `/api/reservations/*`      | detail, options, trend                                                                     | —                                                  |
| `/api/pricing/*`           | query, upload                                                                              | —                                                  |
| `/api/simulator/estimate`  | Cost Simulator estimate with source-aware ADX pricing + safe fallback (POST)               | service, region, sku, qty, priceSource, commitment |
| `/api/config/*`            | current, save, connect                                                                     | —                                                  |
| `/api/filters/*`           | options, tag-values                                                                        | —                                                  |
| `/api/remediation-impact`  | remediation impact cards (GET)                                                             | —                                                  |
| `/api/remediation-summary` | KPI aggregation — savings, costs, net impact (GET)                                         | —                                                  |
| `/api/remediation-insight` | AI insight with Learn RAG (POST)                                                           | —                                                  |
| `/api/agentic-finops`      | Agentic FinOps recommendations + summary (GET)                                             | —                                                  |
| `/api/remediation/execute` | Pre-condition check (GET `?precheck=1`) + execute action (POST)                            | resourceId, action, dryRun                         |
| `/api/executions`          | Execution log — list of past remediation actions (GET)                                     | —                                                  |
| `/api/executions/savings`  | Execution savings KPIs + per-resource detail (GET)                                         | —                                                  |
| `/api/chat`                | chat (POST)                                                                                | —                                                  |
| `/api/debug`               | debug info                                                                                 | —                                                  |
| `/api/health`              | health                                                                                     | —                                                  |

## Architecture Decisions

The full decision log lives in [`docs/adr/`](../adr/README.md). Each entry records context,
rationale, and alternatives considered. The decisions most relevant to understanding this file are
summarised below.

**ADR-0001 — BFF Pattern (API Routes as Backend-for-Frontend)**
Next.js API Routes act as a server-side proxy to ADX. ADX credentials and KQL queries never reach
the browser, which also enables the mock-data fallback in a single, centralised place.
See [ADR-0001](../adr/0001-bff-api-routes.md).

**ADR-0002 — Apache ECharts over D3.js / Recharts**
ECharts was chosen for its native gauge chart type (required for score/coverage widgets),
dark-theme support, and a declarative options API that fits the React component model.
See [ADR-0002](../adr/0002-apache-echarts.md).

**ADR-0003 — SWR over WebSocket / Server-Sent Events**
60-second SWR polling is sufficient for hourly FinOps data ingestion cadence. Remediation Impact
cards poll every 15 minutes. WebSocket/SSE complexity is not justified.
See [ADR-0003](../adr/0003-swr-polling.md).

**ADR-0004 — Mock Data Fallback**
Every API route returns realistic mock data when `ADX_CLUSTER_URI` is unset or
`NEXT_PUBLIC_USE_MOCK=true`, enabling development and demos without Azure access.
See [ADR-0004](../adr/0004-mock-data-fallback.md).

**ADR-0005 — Source-Aware Defensive Pricing Fallback for Cost Simulator**
The Cost Simulator falls back to deterministic catalog-based math when ADX pricing rows return
missing or invalid baseline fields, preventing zero-baseline errors while honouring the
user-selected price source whenever valid data is available.
See [ADR-0005](../adr/0005-simulator-pricing-fallback.md).

## Security Model

| Layer                    | Control                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------- |
| **ADX Authentication**   | `DefaultAzureCredential` — `az login` in dev, Managed Identity in prod                |
| **Credential Isolation** | All ADX tokens server-side in API Routes — never sent to browser                      |
| **Input Validation**     | Zod schemas on all API query parameters (numeric budget, ISO dates, integer counts)   |
| **KQL Safety**           | No user input concatenated into KQL strings — all queries parameterized               |
| **CSP Headers**          | Content-Security-Policy set in `next.config.js`                                       |
| **No Secrets in Code**   | `.env.local` for connection strings, `.env.local.example` committed with placeholders |

## Tenant Isolation

The dashboard supports both subscription-level and tenant-level isolation:

- **Subscription isolation**: KQL queries filter by `SubscriptionName` — data is scoped to subscriptions visible in the FinOps Hub
- **Tenant isolation**: ADX cluster itself is tenant-scoped — the `DefaultAzureCredential` determines which tenant's data is accessible
- **No cross-tenant queries**: The BFF connects to a single ADX cluster per deployment

## Data Model Reference

The primary data source is the **`Costs()` function** in the `Hub` database — a FOCUS-aligned enriched view from the FinOps Toolkit (wraps the underlying `CostsPlus` table). Contract pricing is available via the **`Prices_v1_2()` function** (EA/MCA PriceSheet, FOCUS v1.2). Reservation recommendations are in the **`Recommendations_final_v1_2`** table in the **`Ingestion`** database, queried via `executeQuery(kql, "Ingestion")` using the `overrideDatabase` parameter (cross-database `database('Ingestion').Table` syntax is not supported on public FinOps Hub clusters). Advisor recommendations (rightsizing, WAF scores) are queried via **Azure Resource Graph** (`queryAdvisorRecommendations`, `queryAdvisorDetails` in `resource-graph-client.ts`).

**Key columns — Hub database (`Costs()` function)**:

| Column                     | Type     | Usage                                                                                                      |
| -------------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `ChargePeriodStart`        | datetime | Time-series grouping (monthly, daily)                                                                      |
| `EffectiveCost`            | real     | Primary cost metric (after discounts)                                                                      |
| `BilledCost`               | real     | Billed amount before credits                                                                               |
| `ListCost`                 | real     | On-demand list price (for savings calculation)                                                             |
| `ContractedCost`           | real     | Contracted/committed rate                                                                                  |
| `ConsumedService`          | string   | Service breakdown (pie charts)                                                                             |
| `ResourceName`             | string   | Resource-level drill-down                                                                                  |
| `SubscriptionName`         | string   | Subscription grouping                                                                                      |
| `PricingCategory`          | string   | On-Demand vs Committed filtering                                                                           |
| `ChargeCategory`           | string   | Usage vs Purchase filtering                                                                                |
| `CommitmentDiscountStatus` | string   | Commitment coverage analysis                                                                               |
| `Tags`                     | string   | JSON-encoded resource tags — use `todynamic(Tags)['key']` for tag-based filtering (governance, chargeback) |

**Key columns — Ingestion database (`Recommendations_final_v1_2` table)**:

| Column                     | Type    | Usage                                                                             |
| -------------------------- | ------- | --------------------------------------------------------------------------------- |
| `x_EffectiveCostBefore`    | real    | Daily cost before recommendation (×30 for monthly)                                |
| `x_EffectiveCostAfter`     | real    | Projected daily cost after recommendation (×30 for monthly)                       |
| `x_EffectiveCostSavings`   | real    | Daily savings (×30 for monthly)                                                   |
| `x_RecommendationDetails`  | dynamic | JSON with `SkuSize`, `RegionName`, `CommitmentDiscountNormalizedGroup`, `SkuTerm` |
| `x_RecommendationCategory` | string  | Category (may be empty for reservation recommendations)                           |
| `ResourceType`             | string  | Resource type (e.g., `virtualmachines`)                                           |
| `x_SourceType`             | string  | Source type (e.g., `ReservationRecommendations`)                                  |

## Technology Stack

| Layer          | Technology           | Version |
| -------------- | -------------------- | ------- |
| Runtime        | Next.js (App Router) | 14.x    |
| UI             | React                | 18.x    |
| Styling        | Tailwind CSS         | 3.4.x   |
| Charts         | Apache ECharts       | 5.5.x   |
| Charts (React) | echarts-for-react    | 3.0.x   |
| Data fetching  | SWR                  | 2.2.x   |
| Validation     | Zod                  | 3.23.x  |
| ADX SDK        | azure-kusto-data     | 6.0.x   |
| Auth           | @azure/identity      | 4.5.x   |
| Language       | TypeScript           | 5.6.x   |

**New chart components added**: `ScatterChart` (bubble sizing by cost), `RadarChart` (WAF spider), `ThemeToggle` (light/dark class toggle on `<html>`).

### Agentic FinOps (`/agentic-finops`)

- **Lifecycle Banner**: Visual 6-stage agentic pipeline (Detect → Analyze → Decide → Execute → Validate → Learn) with active/future indicators and per-stage recommendation counts
- **KPI Cards**: 4 summary cards — total recommendations, potential annual savings (BRL), ready-for-action count, pending-approval count
- **Savings by Category**: Pie chart breaking down potential savings by recommendation category (Idle Resources, Rightsizing, Reservations, SKU Optimization, Orphaned Resources)
- **Distribution by Risk**: Stacked column chart showing recommendation counts by risk level (Low/Medium/High) with color-coded series
- **Recommendation Cards**: Filterable list (All/Ready/Pending/Analyzing/Decision) with impact/risk/stage badges, resource details, savings amount, confidence bar, and disabled "Request Action" button (Phase 2 placeholder)
- **Data source**: Azure Resource Graph — `advisorresources` where `category == "Cost"` via `queryAdvisorCostAgentic()` in `resource-graph-client.ts`. Falls back to 8 realistic mock recommendations when no Azure credentials are available. Stage/risk/confidence classification is rule-based (action type + impact + savings thresholds).

## Future Enhancements

1. ~~**WAF/Advisor Gauges**~~: ✅ Done — Azure Resource Graph integration queries Advisor recommendations for WAF radar scores and insight cards (see `resource-graph-client.ts`)
2. **Container Apps Deployment**: Dockerfile + Bicep/Terraform for Azure Container Apps hosting
3. **MSAL Authentication**: Add user-level sign-in with `next-auth` + Entra ID
4. **CI/CD Pipeline**: GitHub Actions for build, test, deploy
5. **Agentic FinOps Phase 2**: Enable "Execute" and "Validate" stages — approval workflow, automated remediation execution, post-action validation loop
6. **Agentic FinOps Phase 3**: "Learn" stage — feedback collection, recommendation accuracy tracking, continuous improvement
