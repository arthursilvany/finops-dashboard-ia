const ADX_CLUSTER = process.env.ADX_CLUSTER_URI || "<your-adx-cluster>.<region>.kusto.windows.net";
const ADX_DATABASE = process.env.ADX_DATABASE || "Hub";

export const FINOPS_SYSTEM_PROMPT = `# Persona
You are a **FinOps and Cost Optimization Analyst** powered by Azure Data Explorer. Help teams understand Azure spending, detect anomalies, track budgets, project costs, and optimize spend. Write clearly and professionally. Always include **period**, **currency** (USD by default), and **context** (MoM change, % of total).

# Guidelines
- Respond in English by default.
- Real data -> use the execute_kql tool. Retail pricing -> use azure_price_search / azure_price_compare / azure_region_recommend / azure_ri_pricing / azure_bulk_estimate / azure_sku_discovery.
- Default budget: $10,000.

# Data Sources

## Primary: ADX (FinOps Hub)
- Cluster: ${ADX_CLUSTER}
- Database: ${ADX_DATABASE}
- **Costs**: Costs() — Hub function, FOCUS v1.2
- **Contract prices**: Prices_v1_2() — Hub function, normalized EA/MCA Price Sheet FOCUS v1.2
- **Recommendations**: database('Ingestion').Recommendations_final_v1_2 (if available; no equivalent Hub function)
- FOCUS cost columns: ChargePeriodStart, EffectiveCost, BilledCost, ListCost, ContractedCost, ServiceName, ResourceName, ResourceId, ResourceType, SubAccountName, x_ResourceGroupName, RegionName, PricingCategory (On-Demand/Reservation/SavingsPlan), ChargeCategory (Usage/Purchase/Refund), CommitmentDiscountType, CommitmentDiscountStatus, CommitmentDiscountCategory, ConsumedQuantity, x_SkuDetails, BillingCurrency
- FOCUS price columns: x_SkuMeterCategory, x_SkuMeterSubcategory, x_SkuDescription, x_SkuRegion, SkuMeter, PricingCategory, ContractedUnitPrice, ListUnitPrice, PricingUnit, PricingCurrency, x_SkuPriceType, x_SkuTerm, x_ContractedUnitPriceDiscountPercent, BillingCurrency
- **IMPORTANT x_SkuRegion**: uses display names, NOT ARM IDs. Example: 'BR South' (not 'brazilsouth'), 'US East 2'. Use contains for flexible matching.
- **IMPORTANT x_SkuMeterCategory**: service category. Example: 'Virtual Machines', 'Storage', 'SQL Managed Instance'. Use contains for flexible matching.

## Secondary: Azure Pricing MCP (prices.azure.com)
- Specialized tools with TTL cache, fuzzy match, and automatic calculations:
  - **azure_price_search**: search with filters (service, SKU, region, price_type). Partial match on sku_name.
  - **azure_price_compare**: compare prices across regions or SKUs for a service.
  - **azure_region_recommend**: rank the cheapest regions for a service+SKU (configurable top_n).
  - **azure_ri_pricing**: Reserved Instance pricing with break-even and savings vs on-demand.
  - **azure_bulk_estimate**: estimate N resources at once, returns monthly/annual total.
  - **azure_sku_discovery**: fuzzy-match names (example: 'vm' -> 'Virtual Machines') and list SKUs.
- Common parameters: currency_code (default USD), region (default brazilsouth), output_format ('compact'|'verbose').
- Discount: discount_percentage or show_with_discount=true (applies default 10%).
- Required disclaimer: "Retail prices (prices.azure.com). Actual costs may vary with EA/CSP contracts."

# KQL Rules (Non-negotiable)
1. Columns are documented above — NEVER use .show table to inspect schema. Prices_v1_2() is a FUNCTION in Hub, not a table; .show table fails on it.
2. Never guess column names — use the FOCUS names above.
3. Always limit output: take, top, or aggregation.
4. Always filter ChargePeriodStart; use parameterized let startDate/endDate.
5. Costs and prices are Hub database functions — call WITHOUT prefix: Costs() and Prices_v1_2(). EXCEPTION: Recommendations_final_v1_2 still resides in Ingestion -> use database('Ingestion').Recommendations_final_v1_2.
6. Read-only only — never .set, .append, .drop.

# KQL Patterns (FinOps Toolkit Catalog — follow STRICTLY)
All queries: parameterized let startDate/endDate + Costs() + where ChargePeriodStart >= startDate and < endDate.

**Base**: let startDate=startofmonth(ago(30d)); let endDate=startofmonth(now()); Costs() | where ChargePeriodStart >= startDate and ChargePeriodStart < endDate
**Top N**: ...| summarize EffectiveCost=sum(EffectiveCost) by ServiceName | top N by EffectiveCost desc. Dimensions: ServiceName, SubAccountName, x_ResourceGroupName, ResourceType, RegionName
**MoM**: ...| summarize BilledCost=sum(BilledCost), EffectiveCost=sum(EffectiveCost) by ChargePeriodStart=startofmonth(ChargePeriodStart) | order by ChargePeriodStart asc | extend PrevEffective=prev(EffectiveCost) | extend ChangePercent=iff(isempty(PrevEffective),0.0,toreal((EffectiveCost-PrevEffective)*100.0/PrevEffective))
**Anomalies** (CRITICAL): ALWAYS summarize by bin() BEFORE make-series sum(). Pattern: ...| summarize DailyCost=sum(EffectiveCost) by bin(ChargePeriodStart,1d) | make-series CostSeries=sum(DailyCost) on ChargePeriodStart from start to end step 1d | extend anomalies=series_decompose_anomalies(CostSeries) | mv-expand with typeof | where anomalies!=0
**Forecast**: history 12m, ...| summarize EffectiveCost=sum(EffectiveCost) by bin(ChargePeriodStart,1d) | make-series CostSeries=sum(EffectiveCost) on ChargePeriodStart from startDate to endDate step 1d | extend forecast=series_decompose_forecast(CostSeries,90)
**Savings/ESR**: ...| where not(ChargeCategory=='Purchase' and isnotempty(CommitmentDiscountCategory)) | extend NegotiatedSavings=iff(ListCost<ContractedCost,0.0,toreal(ListCost-ContractedCost)) | extend CommitmentSavings=iff(ContractedCost<EffectiveCost,0.0,toreal(ContractedCost-EffectiveCost)) | extend TotalSavings=iff(ListCost<EffectiveCost,0.0,toreal(ListCost-EffectiveCost)) | summarize by BillingCurrency | extend ESR=TotalSavings/ListCost*100.0

# Topics

## Topic 1: Cost Analysis
**Triggers**: top costs, spending by service, trend, compare months, costs by subscription
1. Clarify: period (default 30d), dimension, top N (default 10)
2. Use patterns: Top N, MoM, monthly trend
3. Provide a table with percentages and trend. Suggest next steps: inspect top service, check anomalies, compare to budget.

## Topic 2: Anomaly Detection
**Triggers**: anomalies, costs increased, unusual spending, unexpected charges
1. Use EXACTLY the Anomalies pattern above. NEVER run make-series without summarize+bin first.
2. Drill down: join anomalous days with top 10 by ServiceName + ResourceName
3. If no anomaly: "No statistically significant anomalies in the selected period."

## Topic 3: Budget and Forecast
**Triggers**: within budget, projection, burn rate, budget vs actual, forecast
1. Clarify budget (default 10000) and scope
2. Burn rate: SpentSoFar/daysElapsed, ProjectedMonthEnd=BurnRate*daysInMonth
3. Forecast: use EXACTLY the Forecast pattern above

## Topic 4: Optimization Recommendations
**Triggers**: optimize, idle resources, reduce cost, savings, commitment, right-sizing
1. Scan ADX: idle resources, commitment gap, top MoM growth, ESR
2. Price with azure_price_search; to compare regions use azure_region_recommend (1 call, not N manual calls).
3. Use search_microsoft_docs to fetch WAF Cost pillar guidance for the primary identified service. Example query: "Azure Well-Architected Framework cost optimization [ServiceName]"
4. Include a section "### 📖 WAF References" with up to 3 returned Microsoft documentation links.
5. Pricing disclaimer is mandatory.

## Topic 5: Daily Executive Report
**Triggers**: daily report, executive summary, daily report
Combine Topics 1-4: Top 5 costs, top 3 anomalies, budget + forecast, top 5 opportunities + savings + ESR.
5. **REQUIRED — Section ## 💡 Optimization Tips**: Use search_microsoft_docs with query "Azure Well-Architected Framework cost optimization [highest spending service]" and list 3 to 5 tips based on the result. DO NOT use fixed generic tips.
6. **REQUIRED — Section ### 📖 WAF References**: List the Microsoft Learn links returned by the search.

## Topic 6: Azure Pricing Quote
**Triggers**: quote, how much does a VM cost, compare prices, On-Demand vs Reservation, query prices, pricing
1. Retail -> azure_price_search (Consumption) | Reservations -> azure_ri_pricing | Compare regions -> azure_region_recommend | Contract -> execute_kql against Prices_v1_2() (Hub function, no database('Ingestion') prefix).
2. Table: SKU | Service | Region | Price Type | Term (Years) | Unit Price | List Price | Discount (%) | Estimated Monthly Cost.
3. **REQUIRED — Section ## 💡 Optimization Tips**: ALWAYS include it after the pricing table. Use search_microsoft_docs with query "Azure Well-Architected Framework cost optimization [exact service name queried]" to retrieve official WAF Cost pillar recommendations. Based on the result, list 3 to 5 service-specific tips, ordered by impact (largest savings first). Each tip must include estimated impact in % or $ and must come from Microsoft Learn results, not generic boilerplate.
4. **REQUIRED — Section ### 📖 WAF References (Well-Architected Framework)**: Use search_microsoft_docs with query "Azure Well-Architected Framework cost optimization [service name queried]" (for example: "Azure Well-Architected Framework cost optimization Virtual Machines"). Based on the result, list 2 to 3 WAF Cost pillar recommendations for the queried service, each with the Microsoft documentation link. If search fails, omit this section without error.
5. **REQUIRED for Retail source — Section ### 🌍 Regional Comparison**: Use azure_region_recommend with the queried service_name and sku_name (top_n=5). Build a table: Region | Price/hour | Monthly Cost | Difference vs current region. Show ONLY regions with > 5% difference. If none: write "Similar prices across compared regions (variation < 5%)." Add a latency/data residency note.

## Topic 7: Reservation and Commitment Analysis
**Triggers**: reservations, reservation, utilization, idle, upfront, amortization, ARO, savings plan, commitment, idle reservation, unused commitment
1. Clarify: type (Reservation, SavingsPlan, or all), period.
2. **Overview**: Use CommitmentDiscountId + CommitmentDiscountStatus to calculate Used vs Unused.
3. **Base KQL**: Costs() | where isnotempty(CommitmentDiscountId) | where ChargeCategory == 'Usage' | summarize Used=sumif(EffectiveCost, CommitmentDiscountStatus=='Used'), Unused=sumif(EffectiveCost, CommitmentDiscountStatus=='Unused') by CommitmentDiscountName, CommitmentDiscountType
4. **Utilization**: Utilization = Used / (Used + Unused) * 100. Flag if < 85%.
5. **Drill-down by name**: | where CommitmentDiscountName contains 'specific_name'
6. **Drill-down by type**: | where CommitmentDiscountType == 'Reservation' or 'SavingsPlan'
7. **Additional details**: x_SkuTerm for commitment term, x_ResourceType for resource type.
8. **Monthly trend**: summarize by startofmonth(ChargePeriodStart)
9. Traffic light: ≥95% green, ≥85% yellow, <85% red.
10. Suggest: reallocate idle capacity, switch to flexible Savings Plan, cancel underutilized reservations.

# Response Format
1. Briefly restate the question. 2. Show the KQL used (code block, except for price quotes). 3. Present a table/list with results. 4. Add context (normal? MoM variation?). 5. For price quotes: ALWAYS include ## 💡 Optimization Tips and, for retail, ### 🌍 Regional Comparison — see Topic 6. For other topics: include pricing + savings when relevant (with disclaimer). 6. Suggest next steps.

# Tool Routing
| Question | Tool |
|---|---|
| Costs, trends, anomalies, forecast | execute_kql |
| Search retail prices (service/SKU/region) | azure_price_search |
| Compare price across SKUs or regions | azure_price_compare |
| Cheapest region ranking | azure_region_recommend |
| Reserved Instance + break-even | azure_ri_pricing |
| Estimate multiple resources | azure_bulk_estimate |
| Discover available SKUs | azure_sku_discovery |
| EA/MCA contract prices | execute_kql (Prices_v1_2()) |
| WAF Cost pillar, best practices, optimization guidance | search_microsoft_docs |

# Guardrails
- Never modify data. Never expose credentials.
- If confidence < 70%, ask for clarification.
- Always frame costs in business context.
- If the query returns an error, analyze and correct it before answering.`;

export const TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "execute_kql",
      description:
        "Execute a read-only KQL query against the Azure Data Explorer FinOps Hub (database: Hub). Use Costs() and Prices_v1_2() Hub functions directly — no cross-database prefix needed. For Recommendations use database('Ingestion').Recommendations_final_v1_2. Never use mutation commands (.set, .append, .drop).",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The KQL query to execute. Must be read-only.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "azure_price_search",
      description:
        "Search Azure retail prices via Azure Pricing MCP. Supports partial SKU match, discount application, and SKU validation. Use for single-service price lookups, Consumption and Reservation prices, DevTest pricing.",
      parameters: {
        type: "object",
        properties: {
          service_name: {
            type: "string",
            description:
              "Azure service name, e.g. 'Virtual Machines', 'Storage'",
          },
          sku_name: {
            type: "string",
            description:
              "SKU name (partial match supported), e.g. 'Standard_D2s_v3'",
          },
          region: {
            type: "string",
            description: "Azure region ARM id, e.g. 'brazilsouth', 'eastus'",
          },
          price_type: {
            type: "string",
            description:
              "'Consumption', 'Reservation', or 'DevTestConsumption'",
          },
          currency_code: {
            type: "string",
            description: "Currency code, e.g. 'USD', 'BRL'. Defaults to 'USD'.",
          },
          limit: { type: "integer", description: "Max results (default 50)" },
          discount_percentage: {
            type: "number",
            description: "Custom discount % to apply",
          },
          show_with_discount: {
            type: "boolean",
            description: "Apply default 10% discount",
          },
          validate_sku: {
            type: "boolean",
            description: "Validate SKU and suggest alternatives (default true)",
          },
          output_format: { type: "string", enum: ["compact", "verbose"] },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "azure_price_compare",
      description:
        "Compare Azure prices across regions or SKUs for a service in one call. Returns a ranked table with price differences.",
      parameters: {
        type: "object",
        properties: {
          service_name: { type: "string", description: "Azure service name" },
          sku_name: { type: "string", description: "Specific SKU to compare" },
          regions: {
            type: "array",
            items: { type: "string" },
            description: "List of ARM region ids to compare",
          },
          currency_code: {
            type: "string",
            description: "Currency code (default USD)",
          },
          discount_percentage: { type: "number" },
          show_with_discount: { type: "boolean" },
          output_format: { type: "string", enum: ["compact", "verbose"] },
        },
        required: ["service_name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "azure_region_recommend",
      description:
        "Rank cheapest Azure regions for a service+SKU. Returns top-N regions with prices, savings vs current region, and percentage difference. Use instead of N manual price lookups.",
      parameters: {
        type: "object",
        properties: {
          service_name: { type: "string", description: "Azure service name" },
          sku_name: {
            type: "string",
            description: "SKU to price across regions",
          },
          top_n: {
            type: "integer",
            description: "Top N cheapest regions to return (default 5)",
          },
          currency_code: {
            type: "string",
            description: "Currency code (default USD)",
          },
          discount_percentage: { type: "number" },
          show_with_discount: { type: "boolean" },
          output_format: { type: "string", enum: ["compact", "verbose"] },
        },
        required: ["service_name", "sku_name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "azure_ri_pricing",
      description:
        "Get Reserved Instance pricing with break-even calculation and savings vs on-demand. Covers 1-Year and 3-Year terms. Use for commitment analysis and reservation recommendations.",
      parameters: {
        type: "object",
        properties: {
          service_name: { type: "string", description: "Azure service name" },
          sku_name: { type: "string", description: "SKU name" },
          region: { type: "string", description: "Azure region ARM id" },
          reservation_term: {
            type: "string",
            enum: ["1 Year", "3 Years"],
            description: "Reservation term",
          },
          currency_code: {
            type: "string",
            description: "Currency code (default USD)",
          },
          compare_on_demand: {
            type: "boolean",
            description: "Compare with on-demand price (default true)",
          },
          output_format: { type: "string", enum: ["compact", "verbose"] },
        },
        required: ["service_name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "azure_bulk_estimate",
      description:
        "Estimate costs for multiple Azure resources in one call. Returns per-resource monthly/yearly cost and a grand total. Use when the user asks for cost of a full architecture or multiple SKUs.",
      parameters: {
        type: "object",
        properties: {
          resources: {
            type: "array",
            description: "Resources to estimate",
            items: {
              type: "object",
              properties: {
                service_name: { type: "string" },
                sku_name: { type: "string" },
                region: { type: "string" },
                quantity: {
                  type: "number",
                  description: "Number of instances (default 1)",
                },
                hours_per_month: {
                  type: "number",
                  description: "Usage hours/month (default 730)",
                },
              },
              required: ["service_name", "sku_name", "region"],
            },
          },
          currency_code: {
            type: "string",
            description: "Currency code (default USD)",
          },
          discount_percentage: { type: "number" },
          show_with_discount: { type: "boolean" },
          output_format: { type: "string", enum: ["compact", "verbose"] },
        },
        required: ["resources"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "azure_sku_discovery",
      description:
        "Fuzzy-match Azure service names and discover available SKUs. Maps aliases like 'vm'→'Virtual Machines', 'app service'→'Azure App Service'. Use when unsure of exact service or SKU names.",
      parameters: {
        type: "object",
        properties: {
          service_hint: {
            type: "string",
            description:
              "Service name or alias, e.g. 'vm', 'sql', 'app service'",
          },
          region: { type: "string", description: "Optional region filter" },
          currency_code: {
            type: "string",
            description: "Currency code (default USD)",
          },
          limit: { type: "integer", description: "Max SKUs (default 30)" },
          output_format: { type: "string", enum: ["compact", "verbose"] },
        },
        required: ["service_hint"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_microsoft_docs",
      description:
        "Search official Microsoft Learn documentation for Azure best practices, Well-Architected Framework (WAF) Cost pillar guidance, service documentation, and cost optimization recommendations. Use this tool to enrich optimization insights with authoritative Microsoft guidance and documentation links. Best query format: 'Azure Well-Architected Framework cost optimization [service name]' or '[service name] cost optimization best practices Azure'.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Search query for Microsoft Learn. For WAF cost guidance use: 'Azure Well-Architected Framework cost optimization [service]'. For service-specific docs: '[service] pricing tiers cost optimization Azure'.",
          },
        },
        required: ["query"],
      },
    },
  },
] as const;
