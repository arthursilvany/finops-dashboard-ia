export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { runAgentWithTools } from "@/lib/agent-engine";
import { customerSlugFromCookieHeader } from "@/lib/customer-data/workspace";

interface PricingRequest {
  priceSource: "retail" | "contract";
  environment: "production" | "non-production";
  query: string;
  skuList?: string[];
  region?: string;
  currency?: string;
}

// Candidate regions to compare — ordered by typical Azure pricing (cheapest first)
const ALTERNATIVE_REGIONS = [
  "eastus",
  "eastus2",
  "westus2",
  "westeurope",
  "northeurope",
];

function getRegionComparisonInstruction(currentRegion: string): string {
  const alternatives = ALTERNATIVE_REGIONS.filter(
    (r) => r !== currentRegion,
  ).slice(0, 4);

  return `### 🌍 Regional Price Comparison
Use the azure_region_recommend tool with the same service_name and sku_name queried above, passing regions: ["${currentRegion}", "${alternatives.join('", "')}"]
Build a table with columns: Region | Unit Price | Estimated Monthly Cost | Difference vs ${currentRegion}.
Show ONLY regions where the difference is greater than 5% (higher or lower) compared to the current region.
If no region has a difference > 5%, write: "Similar prices across the compared regions (variation < 5%)."
At the end add this note: "_⚠️ Consider latency, data residency requirements (LGPD/GDPR), and compliance before migrating regions._"`;
}

function buildPrompt(req: PricingRequest): string {
  const region = req.region || "brazilsouth";
  const currency = req.currency || "USD";
  const isRetail = req.priceSource === "retail";
  const isNonProd = req.environment === "non-production";

  const sourceInstruction = isRetail
    ? `Use the azure_price_search tool to query retail prices (Azure Pricing MCP).
  Default parameters: region="${region}", currency_code="${currency}", price_type="Consumption".
  For each SKU found, calculate the estimated monthly cost:
  - If unitOfMeasure="1 Hour" → retailPrice × 730
  - If unitOfMeasure="1 GB/Month" → retailPrice × quantity
  - If unitOfMeasure="1/Month" → retailPrice directly`
    : `Use the execute_kql tool to query contract prices (EA/MCA) in the Prices_v1_2() function (function in the Hub database — use it WITHOUT the database('Ingestion') prefix).
  Columns: x_SkuMeterCategory, x_SkuMeterSubcategory, x_SkuDescription, x_SkuRegion, ContractedUnitPrice, ListUnitPrice, PricingUnit, x_SkuPriceType, x_SkuTerm, x_ContractedUnitPriceDiscountPercent, BillingCurrency.
  NOTE: x_SkuRegion uses display names ('BR South', not 'brazilsouth'). Use contains for matching.
  Currency: ${currency}.
  For each item, show ListUnitPrice vs ContractedUnitPrice and the applied discount (x_ContractedUnitPriceDiscountPercent).`;

  const envInstruction = isNonProd
    ? `ENVIRONMENT: Non-Production (Dev/Test).
  Special rules:
  - For retail prices: also query price_type="DevTestConsumption" when available
  - Highlight SKUs with Dev/Test licensing (Windows Server, SQL Server) that provide discounts
  - Mention that Dev/Test environments can use Azure Dev/Test pricing (up to 55% discount on Windows VMs)
  - For contract prices: filter Dev/Test offers when available
  - Recommend smaller SKUs (B-series, D2s instead of D4s) for non-production environments
  - Compare Dev/Test vs Consumption cost with azure_price_compare to justify the tier`
    : `ENVIRONMENT: Production.
  Consider high availability, SLAs, and performance. Use azure_ri_pricing to fetch Reserved Instance prices (1 year and 3 years) and show savings vs pay-as-you-go (break-even in months).`;

  const skuSection = req.skuList?.length
    ? `\n## SKU list for batch lookup:\n${req.skuList.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\nQuery the price of EACH SKU listed above. Present the result in a consolidated table.`
    : "";

  const regionComparison = isRetail
    ? getRegionComparisonInstruction(region)
    : "";

  return `Query Azure prices with the following configuration:

## Price Source: ${isRetail ? "Retail (Azure Retail Prices API)" : "Contract (EA/MCA via ADX)"}
${sourceInstruction}

## Environment
${envInstruction}

## Query
${req.query}${skuSection}

## REQUIRED RESPONSE STRUCTURE
Your response MUST contain EXACTLY these sections in this order. DO NOT omit any section.

---

## 💲 Price Query Result

[Briefly describe what was queried]

[Table with columns: SKU | Service | Region | Price Type | Term (Years) | Unit Price (${isNonProd ? "USD/H) | Estimated Monthly Cost | Dev/Test Savings" : "USD/H) | List Price (USD/H) | Discount (%) | Estimated Monthly Cost (USD)"}]

**Notes:**
- ${isRetail ? "Retail prices (prices.azure.com). Actual costs may vary with EA/CSP contracts." : "EA/MCA contract prices from FinOps Hub."}
- [other relevant notes]

---

## 💡 Optimization Tips

REQUIRED: Use the search_microsoft_docs tool with the query "Azure Well-Architected Framework cost optimization [exact resource/service name queried]" to fetch official WAF Cost pillar recommendations. Based on the result, list 3 to 5 specific tips for the queried resource, ordered from highest to lowest estimated savings. Format each tip as: "**[Tip title]** — [Description with estimated impact in % or $]"

${isRetail && regionComparison ? `---\n\n${regionComparison}\n\n---` : "---"}

**Footer:**
- Region: [queried region]
- Currency: ${req.currency || "USD"}
- Query time: [current UTC]

Execute all required queries and generate the full result without asking for confirmation.`;
}

export async function POST(request: NextRequest) {
  try {
    const body: PricingRequest = await request.json();

    if (!body.query && (!body.skuList || body.skuList.length === 0)) {
      return NextResponse.json(
        { error: "query or skuList is required" },
        { status: 400 },
      );
    }

    if (
      !body.priceSource ||
      !["retail", "contract"].includes(body.priceSource)
    ) {
      return NextResponse.json(
        { error: "priceSource must be 'retail' or 'contract'" },
        { status: 400 },
      );
    }

    if (body.skuList && body.skuList.length > 50) {
      return NextResponse.json(
        { error: "Maximum 50 SKUs per batch" },
        { status: 400 },
      );
    }

    const prompt = buildPrompt({
      priceSource: body.priceSource,
      environment: body.environment || "production",
      query:
        body.query ||
        `Query prices for the following SKUs: ${body.skuList!.join(", ")}`,
      skuList: body.skuList,
      region: body.region,
      currency: body.currency,
    });

    const customerSlug = customerSlugFromCookieHeader(
      request.headers.get("cookie"),
    );
    const result = await runAgentWithTools(prompt, customerSlug);

    const content = result.message
      .replace(/^```(?:markdown)?\s*\n?/, "")
      .replace(/\n?```\s*$/, "");

    return NextResponse.json({
      content,
      usage: result.usage,
      priceSource: body.priceSource,
      environment: body.environment || "production",
    });
  } catch (err: unknown) {
    console.error("Pricing query error:", err);
    const message = err instanceof Error ? err.message : "Pricing query failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
