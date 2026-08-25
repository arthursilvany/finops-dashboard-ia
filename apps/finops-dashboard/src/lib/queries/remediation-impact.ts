import type {
  RemediationCard,
  RemediationAiInsight,
  RemediationSummary,
} from "@/lib/types";
import type { AdvisorRemediationDetail } from "@/lib/resource-graph-client";
import {
  queryAdvisorRemediationDetails,
  queryAdvisorDetails,
} from "@/lib/resource-graph-client";
import { mcpPriceSearch } from "@/lib/azure-pricing-mcp-client";
import { executeQuery } from "@/lib/adx-client";
import {
  createChatCompletion,
  getFastDeployment,
  isTruncatedByReasoning,
} from "@/lib/openai-client";
import { searchMicrosoftDocs } from "@/lib/microsoft-learn-client";

const RETAIL_API = "https://prices.azure.com/api/retail/prices";

// ---------------------------------------------------------------------------
// Resource type display mapping
// ---------------------------------------------------------------------------
const RESOURCE_TYPE_LABELS: Record<string, string> = {
  "microsoft.compute/virtualmachines": "Virtual Machine",
  "microsoft.network/loadbalancers": "Load Balancer",
  "microsoft.network/applicationgateways": "Application Gateway",
  "microsoft.sql/servers/databases": "SQL Database",
  "microsoft.storage/storageaccounts": "Storage Account",
  "microsoft.web/sites": "App Service",
  "microsoft.keyvault/vaults": "Key Vault",
  "microsoft.network/virtualnetworkgateways": "VPN Gateway",
  "microsoft.network/publicipaddresses": "Public IP",
  "microsoft.containerservice/managedclusters": "AKS Cluster",
};

function friendlyResourceType(raw: string): string {
  return RESOURCE_TYPE_LABELS[raw.toLowerCase()] ?? raw.split("/").pop() ?? raw;
}

// ---------------------------------------------------------------------------
// Category + impact tag generation
// ---------------------------------------------------------------------------
const CATEGORY_MAP: Record<string, string> = {
  HighAvailability: "RELIABILITY",
  Security: "SECURITY",
};

function buildTags(rec: AdvisorRemediationDetail): {
  tags: string[];
  factTags: string[];
} {
  const tags: string[] = [];
  if (rec.impact === "High") tags.push("CRITICAL");
  const catLabel = CATEGORY_MAP[rec.category] ?? rec.category.toUpperCase();
  tags.push(catLabel);
  if (rec.category === "HighAvailability") tags.push("HIGH AVAILABILITY");

  const factTags: string[] = [];
  const ep = rec.extendedProperties;
  if (ep.Environment) factTags.push(`tag Environment=${ep.Environment}`);
  if (ep.sku) factTags.push(`SKU ${ep.sku}`);
  return { tags, factTags };
}

// ---------------------------------------------------------------------------
// Cost estimation — PriceSheet → MCP → Retail API → heuristic
// ---------------------------------------------------------------------------
interface CostEstimate {
  monthly: number;
  annual: number;
  source: "pricesheet" | "mcp" | "retail-api" | "estimate";
}

// Known remediation cost heuristics by recommendation pattern
const HEURISTIC_COSTS: { pattern: RegExp; monthly: number }[] = [
  { pattern: /availability.?zone/i, monthly: 480 },
  { pattern: /backup/i, monthly: 200 },
  { pattern: /ddos/i, monthly: 600 },
  { pattern: /waf|web.?application.?firewall/i, monthly: 450 },
  { pattern: /encryption/i, monthly: 50 },
  { pattern: /mfa|multi.?factor/i, monthly: 0 },
  { pattern: /private.?endpoint/i, monthly: 35 },
  { pattern: /nsg|network.?security.?group/i, monthly: 0 },
  { pattern: /tls|ssl/i, monthly: 30 },
  { pattern: /diagnostic|log/i, monthly: 100 },
];

function heuristicCost(title: string, exchangeRate: number): CostEstimate {
  for (const h of HEURISTIC_COSTS) {
    if (h.pattern.test(title)) {
      const m = h.monthly * exchangeRate;
      return { monthly: m, annual: m * 12, source: "estimate" };
    }
  }
  const m = 300 * exchangeRate;
  return { monthly: m, annual: m * 12, source: "estimate" };
}

// ---------------------------------------------------------------------------
// ARM region name → Prices_v1_2 display name mapper
// ---------------------------------------------------------------------------
const ARM_TO_DISPLAY_REGION: Record<string, string> = {
  brazilsouth: "BR South",
  eastus: "US East",
  eastus2: "US East 2",
  westus: "US West",
  westus2: "US West 2",
  westus3: "US West 3",
  centralus: "US Central",
  northcentralus: "US North Central",
  southcentralus: "US South Central",
  westeurope: "EU West",
  northeurope: "EU North",
  uksouth: "UK South",
  ukwest: "UK West",
  swedencentral: "SE Central",
  germanywestcentral: "DE West Central",
  francecentral: "FR Central",
  australiaeast: "AU East",
  southeastasia: "AP Southeast",
  eastasia: "AP East",
  japaneast: "JA East",
  canadacentral: "CA Central",
};

function armToDisplayRegion(armRegion: string): string {
  return ARM_TO_DISPLAY_REGION[armRegion.toLowerCase()] ?? armRegion;
}

// ---------------------------------------------------------------------------
// Price Sheet (Prices_v1_2 ADX) — batch query, in-memory lookup
// ---------------------------------------------------------------------------
type PriceSheetCache = Map<
  string,
  { contracted: number; list: number; currency: string }
>;

async function buildPriceSheetCache(
  recs: AdvisorRemediationDetail[],
): Promise<PriceSheetCache> {
  const cache: PriceSheetCache = new Map();
  try {
    const serviceNames = Array.from(
      new Set(recs.map((r) => friendlyResourceType(r.resourceType))),
    );
    const regions = Array.from(
      new Set(recs.map((r) => armToDisplayRegion(r.region || "brazilsouth"))),
    );

    if (serviceNames.length === 0 || regions.length === 0) return cache;

    const svcFilter = serviceNames.map((s) => `"${s}"`).join(", ");
    const regFilter = regions.map((r) => `"${r}"`).join(", ");

    const kql = `Prices_v1_2()
| where x_SkuMeterCategory in (${svcFilter})
| where x_SkuRegion in (${regFilter})
| where PricingCategory == "On-Demand"
| summarize
    AvgContracted = avg(todouble(ContractedUnitPrice)),
    AvgList = avg(todouble(ListUnitPrice)),
    Currency = take_any(BillingCurrency)
  by x_SkuMeterCategory, x_SkuRegion`;

    const result = await executeQuery(kql, "Hub");
    for (const row of result.rows) {
      const svc = String(row.x_SkuMeterCategory ?? "");
      const reg = String(row.x_SkuRegion ?? "");
      const contracted = Number(row.AvgContracted ?? 0);
      const list = Number(row.AvgList ?? 0);
      const currency = String(row.Currency ?? "BRL");
      if (svc && reg && (contracted > 0 || list > 0)) {
        cache.set(`${svc}|${reg}`, { contracted, list, currency });
      }
    }
  } catch {
    // ADX unavailable or mock mode — fall through to MCP
  }
  return cache;
}

function estimateViaPriceSheet(
  rec: AdvisorRemediationDetail,
  priceCache: PriceSheetCache,
): CostEstimate | null {
  const svc = friendlyResourceType(rec.resourceType);
  const reg = armToDisplayRegion(rec.region || "brazilsouth");
  const entry = priceCache.get(`${svc}|${reg}`);
  if (!entry) return null;
  const unitPrice = entry.contracted > 0 ? entry.contracted : entry.list;
  if (unitPrice <= 0) return null;
  const monthly = unitPrice * 730;
  return { monthly, annual: monthly * 12, source: "pricesheet" };
}

async function estimateViaMcp(
  rec: AdvisorRemediationDetail,
  currencyCode: string,
): Promise<CostEstimate | null> {
  try {
    const serviceName = friendlyResourceType(rec.resourceType);
    const raw = await mcpPriceSearch({
      service_name: serviceName,
      region: rec.region || "brazilsouth",
      currency_code: currencyCode,
      limit: 3,
      output_format: "compact",
    });
    const parsed = JSON.parse(raw);
    if (parsed.error) return null;
    const text = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
    const priceMatch = text.match(/(\d+[.,]\d+)/);
    if (priceMatch) {
      const price = parseFloat(priceMatch[1].replace(",", "."));
      const monthly = price * 730;
      return { monthly, annual: monthly * 12, source: "mcp" };
    }
    return null;
  } catch {
    return null;
  }
}

async function estimateViaRetailApi(
  rec: AdvisorRemediationDetail,
  currencyCode: string,
): Promise<CostEstimate | null> {
  try {
    const serviceFamily =
      rec.resourceType.split("/")[0]?.replace("microsoft.", "") ?? "";
    const filter = [
      `serviceName eq '${friendlyResourceType(rec.resourceType)}'`,
      `armRegionName eq '${rec.region || "brazilsouth"}'`,
      `currencyCode eq '${currencyCode}'`,
      `priceType eq 'Consumption'`,
    ].join(" and ");
    const url = `${RETAIL_API}?$filter=${encodeURIComponent(filter)}&$top=5`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const data = await res.json();
    const items = data.Items ?? [];
    if (items.length === 0) return null;
    const price = items[0].retailPrice ?? items[0].unitPrice ?? 0;
    if (price === 0) return null;
    const monthly = price * 730;
    return { monthly, annual: monthly * 12, source: "retail-api" as const };
  } catch {
    return null;
  }
}

async function estimateRemediationCost(
  rec: AdvisorRemediationDetail,
  priceCache: PriceSheetCache,
  fxInfo: ExchangeRateInfo,
): Promise<CostEstimate> {
  const ps = estimateViaPriceSheet(rec, priceCache);
  if (ps) return ps;
  const mcp = await estimateViaMcp(rec, fxInfo.billingCurrency);
  if (mcp) return mcp;
  const retail = await estimateViaRetailApi(rec, fxInfo.billingCurrency);
  if (retail) return retail;
  return heuristicCost(rec.title, fxInfo.rateFromUsd);
}

// ---------------------------------------------------------------------------
// Cost advisor offset lookup
// ---------------------------------------------------------------------------

// Exchange rate: Advisor savings are in USD; FinOps Hub uses BillingCurrency.
// Derive rate from Prices_v1_2 comparing ListUnitPrice (PricingCurrency/USD)
// against ContractedUnitPrice (BillingCurrency).
interface ExchangeRateInfo {
  billingCurrency: string;
  rateFromUsd: number; // 1 USD = X billing currency
}

async function fetchExchangeRate(): Promise<ExchangeRateInfo> {
  try {
    // Strategy 1: try x_BillingExchangeRate column (common FOCUS extension)
    try {
      const kql1 = `Prices_v1_2()
| where BillingCurrency != "USD"
| where isnotnull(x_BillingExchangeRate) and todouble(x_BillingExchangeRate) > 0
| summarize Rate = avg(todouble(x_BillingExchangeRate)), Currency = take_any(BillingCurrency)
| project Currency, Rate`;
      const r1 = await executeQuery(kql1, "Hub");
      if (r1.rows.length > 0) {
        const row = r1.rows[0];
        const rate = Number(row.Rate ?? 0);
        const currency = String(row.Currency ?? "BRL");
        if (rate > 0) return { billingCurrency: currency, rateFromUsd: rate };
      }
    } catch {
      // Column may not exist — fall through
    }

    // Strategy 2: derive from ListUnitPrice (USD) vs ContractedUnitPrice (BRL)
    // Use On-Demand pricing rows where both are non-zero
    const kql2 = `Prices_v1_2()
| where PricingCategory == "On-Demand"
| where todouble(ListUnitPrice) > 0 and todouble(ContractedUnitPrice) > 0
| where BillingCurrency != "USD"
| extend Ratio = todouble(ContractedUnitPrice) / todouble(ListUnitPrice)
| where Ratio > 1
| summarize AvgRatio = avg(Ratio), Currency = take_any(BillingCurrency)
| project Currency, AvgRatio`;
    const r2 = await executeQuery(kql2, "Hub");
    if (r2.rows.length > 0) {
      const row = r2.rows[0];
      const ratio = Number(row.AvgRatio ?? 0);
      const currency = String(row.Currency ?? "BRL");
      if (ratio > 1) return { billingCurrency: currency, rateFromUsd: ratio };
    }
  } catch {
    // ADX unavailable — no conversion
  }
  return { billingCurrency: "USD", rateFromUsd: 1 };
}

function findCostOffset(
  resourceId: string,
  costDetails: { resourceId: string; savingsAmount: number }[],
  exchangeRate: number,
): { monthly: number; annual: number } {
  const matches = costDetails.filter(
    (d) => d.resourceId.toLowerCase() === resourceId.toLowerCase(),
  );
  if (matches.length === 0) return { monthly: 0, annual: 0 };
  const annualTotal = matches.reduce((s, m) => s + m.savingsAmount, 0);
  const convertedAnnual = annualTotal * exchangeRate;
  return { monthly: convertedAnnual / 12, annual: convertedAnnual };
}

// ---------------------------------------------------------------------------
// GPT-4o AI Insight generation
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Microsoft Learn RAG: search docs for recommendation context
// ---------------------------------------------------------------------------
interface LearnReference {
  title: string;
  url: string;
}

async function fetchLearnContext(
  rec: AdvisorRemediationDetail,
): Promise<{ snippet: string; refs: LearnReference[] }> {
  try {
    const query = `Azure ${friendlyResourceType(rec.resourceType)} ${rec.title}`;
    const raw = await searchMicrosoftDocs(query);
    if (!raw || raw.length < 20) return { snippet: "", refs: [] };

    const refs: LearnReference[] = [];
    let snippet = "";

    // Try JSON first (structured results from Learn MCP)
    try {
      const parsed = JSON.parse(raw);
      if (parsed.error) return { snippet: "", refs: [] };
      const items = Array.isArray(parsed)
        ? parsed
        : (parsed.results ?? parsed.items ?? []);
      if (Array.isArray(items) && items.length > 0) {
        for (const item of items.slice(0, 3)) {
          const title = item.title ?? item.name ?? "";
          const url = item.contentUrl ?? item.url ?? item.link ?? "";
          const excerpt =
            item.content ??
            item.excerpt ??
            item.snippet ??
            item.description ??
            "";
          if (title && url) refs.push({ title, url });
          if (excerpt) snippet += excerpt.slice(0, 600) + "\n";
        }
        if (snippet || refs.length > 0) {
          return { snippet: snippet.slice(0, 2000), refs };
        }
      }
    } catch {
      // Not JSON — continue to text parsing
    }

    // Text response — use as snippet and extract all learn.microsoft.com URLs
    snippet = raw.slice(0, 2000);

    // Try markdown-style links first: [title](url)
    const mdRegex = /\[([^\]]+)\]\((https?:\/\/learn\.microsoft\.com[^)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = mdRegex.exec(raw)) !== null) {
      if (refs.length >= 3) break;
      refs.push({ title: m[1], url: m[2] });
    }

    // If no markdown links, try bare URLs with surrounding context
    if (refs.length === 0) {
      const urlRegex = /(https?:\/\/learn\.microsoft\.com\/[^\s)>"]+)/g;
      let u: RegExpExecArray | null;
      while ((u = urlRegex.exec(raw)) !== null) {
        if (refs.length >= 3) break;
        const url = u[1];
        // Derive title from URL path
        const pathParts = url.split("/").filter(Boolean);
        const title =
          pathParts[pathParts.length - 1]
            ?.replace(/-/g, " ")
            .replace(/\?.*$/, "") ?? "Microsoft Learn";
        refs.push({ title, url });
      }
    }

    return { snippet, refs };
  } catch {
    return { snippet: "", refs: [] };
  }
}

export async function generateRemediationInsight(
  rec: AdvisorRemediationDetail,
): Promise<RemediationAiInsight | null> {
  try {
    // Fixed-schema JSON extraction: no chain of thought needed, so this can run
    // on a cheaper non-reasoning deployment when one is configured.
    const deployment = getFastDeployment();

    // Fetch Microsoft Learn documentation context in parallel
    const learnContext = await fetchLearnContext(rec);

    const docsSection = learnContext.snippet
      ? `\n\nRelevant Microsoft Learn documentation:\n${learnContext.snippet}`
      : "";

    const prompt = `You are an Azure consultant specialized in reliability and security.
Analyze this Azure Advisor recommendation using the provided official Microsoft documentation.
Respond in pure JSON only (no markdown):
{
  "downtimeRisk": "Yes — estimated X min" or "No — no downtime",
  "confidence": 0.0 a 1.0,
  "confidenceLabel": "High" | "Moderate" | "Low",
  "contextWarning": "Short text explaining the technical remediation context based on documentation",
  "riskIfNotRemediated": "Short text describing the risk if it is not remediated"
}

Recommendation: ${rec.title}
Description: ${rec.description}
Resource type: ${rec.resourceType}
Resource: ${rec.resourceName}
Category: ${rec.category}
Impact: ${rec.impact}${docsSection}`;

    const completion = await createChatCompletion(
      {
        model: deployment,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 400,
        response_format: { type: "json_object" },
      },
      // The router can pick a reasoning model, which measured 10-13s on this
      // prompt. 15s left almost no margin and turned a slow answer into a
      // silent fallback.
      { timeout: 45_000 },
    );

    if (isTruncatedByReasoning(completion)) {
      return null;
    }

    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw);

    // Boost confidence when we have Learn docs backing the analysis
    const baseConfidence = Number(parsed.confidence ?? 0.5);
    const boostedConfidence = learnContext.snippet
      ? Math.min(baseConfidence + 0.1, 1.0)
      : baseConfidence;

    return {
      downtimeRisk: String(parsed.downtimeRisk ?? "Analysis unavailable"),
      confidence: boostedConfidence,
      confidenceLabel:
        boostedConfidence >= 0.8
          ? "High"
          : boostedConfidence >= 0.5
            ? "Moderate"
            : "Low",
      contextWarning: String(parsed.contextWarning ?? ""),
      riskIfNotRemediated: String(parsed.riskIfNotRemediated ?? ""),
      sourceReferences:
        learnContext.refs.length > 0 ? learnContext.refs : undefined,
    };
  } catch {
    return null;
  }
}

export function fallbackInsight(
  rec: AdvisorRemediationDetail,
): RemediationAiInsight {
  const isHA = rec.category === "HighAvailability";
  return {
    downtimeRisk: isHA
      ? "Yes — possible during remediation"
      : "No — no downtime expected",
    confidence: 0.6,
    confidenceLabel: "Moderate",
    contextWarning: `Azure Advisor ${rec.impact} recommendation for ${friendlyResourceType(rec.resourceType)}.`,
    riskIfNotRemediated: isHA
      ? "Risk of downtime in the event of an availability zone or datacenter failure"
      : "Risk of exposure to security vulnerabilities",
    sourceReferences: undefined,
  };
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------
export async function computeRemediationCards(
  subscriptionIds: string[],
): Promise<RemediationCard[]> {
  const [remediations, costDetails] = await Promise.all([
    queryAdvisorRemediationDetails(subscriptionIds),
    queryAdvisorDetails(subscriptionIds),
  ]);

  // Sort: High first, then Medium
  const sorted = remediations.sort((a, b) => {
    const order: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
    return (order[a.impact] ?? 3) - (order[b.impact] ?? 3);
  });

  const top = sorted.slice(0, 5);

  // Batch Price Sheet lookup for the top 5 cards
  const [priceCache, fxInfo] = await Promise.all([
    buildPriceSheetCache(top),
    fetchExchangeRate(),
  ]);

  const cards = await Promise.all(
    top.map(async (rec): Promise<RemediationCard> => {
      const costResult = await estimateRemediationCost(rec, priceCache, fxInfo);
      const offset = findCostOffset(
        rec.resourceId,
        costDetails,
        fxInfo.rateFromUsd,
      );
      const net = costResult.monthly - offset.monthly;

      const { tags, factTags } = buildTags(rec);
      const category = rec.category === "Security" ? "Security" : "Reliability";

      return {
        id: rec.id,
        resourceType: friendlyResourceType(rec.resourceType),
        resourceName: rec.resourceName,
        resourceGroup: rec.resourceGroup,
        region: rec.region || "—",
        recommendation: rec.title,
        description: rec.description,
        category,
        impact: rec.impact.toLowerCase() as "high" | "medium" | "low",
        tags,
        factTags,
        aiInsight: null,
        remediationCostMonthly: Math.round(costResult.monthly),
        remediationCostAnnual: Math.round(costResult.annual),
        advisorOffsetMonthly: Math.round(offset.monthly),
        advisorOffsetAnnual: Math.round(offset.annual),
        netMonthly: Math.round(net),
        costSource: costResult.source,
      };
    }),
  );

  return cards;
}

// ---------------------------------------------------------------------------
// KPI aggregation — all recommendations (up to 200)
// ---------------------------------------------------------------------------
export async function computeRemediationSummary(
  subscriptionIds: string[],
): Promise<RemediationSummary> {
  const [remediations, costDetails] = await Promise.all([
    queryAdvisorRemediationDetails(subscriptionIds),
    queryAdvisorDetails(subscriptionIds),
  ]);

  // Batch Price Sheet lookup for ALL recommendations + exchange rate
  const [priceCache, fxInfo] = await Promise.all([
    buildPriceSheetCache(remediations),
    fetchExchangeRate(),
  ]);

  let totalSavingsMonthly = 0;
  let totalSavingsAnnual = 0;
  let reliabilityCostMonthly = 0;
  let reliabilityCostAnnual = 0;
  let securityCostMonthly = 0;
  let securityCostAnnual = 0;
  let zeroCostCount = 0;
  let currency = fxInfo.billingCurrency;
  const reliabilitySourceSet = new Set<string>();
  const securitySourceSet = new Set<string>();

  await Promise.all(
    remediations.map(async (rec) => {
      const costResult = await estimateRemediationCost(rec, priceCache, fxInfo);
      const offset = findCostOffset(
        rec.resourceId,
        costDetails,
        fxInfo.rateFromUsd,
      );

      totalSavingsMonthly += offset.monthly;
      totalSavingsAnnual += offset.annual;

      const isReliability = rec.category !== "Security";

      if (costResult.monthly === 0) {
        zeroCostCount++;
      }

      if (isReliability) {
        reliabilityCostMonthly += costResult.monthly;
        reliabilityCostAnnual += costResult.annual;
        reliabilitySourceSet.add(costResult.source);
      } else {
        securityCostMonthly += costResult.monthly;
        securityCostAnnual += costResult.annual;
        securitySourceSet.add(costResult.source);
      }

      // Pick currency from Price Sheet cache if available
      const svc = friendlyResourceType(rec.resourceType);
      const reg = armToDisplayRegion(rec.region || "brazilsouth");
      const psEntry = priceCache.get(`${svc}|${reg}`);
      if (psEntry?.currency) currency = psEntry.currency;
    }),
  );

  const totalRemediationMonthly = reliabilityCostMonthly + securityCostMonthly;
  const totalRemediationAnnual = reliabilityCostAnnual + securityCostAnnual;

  return {
    totalSavingsMonthly: Math.round(totalSavingsMonthly),
    totalSavingsAnnual: Math.round(totalSavingsAnnual),
    reliabilityCostMonthly: Math.round(reliabilityCostMonthly),
    reliabilityCostAnnual: Math.round(reliabilityCostAnnual),
    reliabilitySources: Array.from(reliabilitySourceSet),
    securityCostMonthly: Math.round(securityCostMonthly),
    securityCostAnnual: Math.round(securityCostAnnual),
    securitySources: Array.from(securitySourceSet),
    totalRemediationMonthly: Math.round(totalRemediationMonthly),
    totalRemediationAnnual: Math.round(totalRemediationAnnual),
    netImpactMonthly: Math.round(totalSavingsMonthly - totalRemediationMonthly),
    netImpactAnnual: Math.round(totalSavingsAnnual - totalRemediationAnnual),
    zeroCostCount,
    currency,
  };
}
