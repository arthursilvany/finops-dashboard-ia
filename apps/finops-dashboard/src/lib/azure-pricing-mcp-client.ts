/**
 * MCP HTTP client for the Azure Pricing MCP server.
 * Implements the MCP Streamable HTTP transport (2024-11-05 protocol version).
 * Mirrors the pattern used by microsoft-learn-client.ts.
 *
 * The server must be running separately:
 *   cd mcp/azure-pricing-mcp && .venv/bin/python -m azure_pricing_mcp --transport http --port 8080
 *
 * Configure via AZURE_PRICING_MCP_URL (default: http://localhost:8080).
 * The /mcp path is appended automatically.
 */

const MCP_BASE_URL =
  process.env.AZURE_PRICING_MCP_URL ?? "http://localhost:8080";
// Streamable HTTP endpoint per MCP 2024-11-05 spec
const MCP_URL = `${MCP_BASE_URL.replace(/\/$/, "")}/mcp`;

// Module-level session cache — shared across requests within the same server process
let cachedSessionId: string | null = null;

async function initSession(): Promise<string | null> {
  try {
    const res = await fetch(MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "finops-dashboard", version: "1.0" },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const sid = res.headers.get("Mcp-Session-Id");

    if (sid) {
      await fetch(MCP_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Mcp-Session-Id": sid,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
        signal: AbortSignal.timeout(5_000),
      });
    }

    return sid;
  } catch {
    return null;
  }
}

function extractText(data: unknown): string {
  if (data && typeof data === "object" && "result" in data) {
    const result = (data as { result: unknown }).result;
    if (result && typeof result === "object" && "content" in result) {
      const content = (result as { content: unknown }).content;
      if (Array.isArray(content)) {
        return content
          .filter(
            (c): c is { type: string; text: string } =>
              c != null &&
              typeof c === "object" &&
              (c as { type: string }).type === "text",
          )
          .map((c) => c.text)
          .join("\n");
      }
      return JSON.stringify(content);
    }
  }
  return "";
}

async function parseResponse(res: Response): Promise<string> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/event-stream")) {
    const text = await res.text();
    for (const line of text.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try {
        const extracted = extractText(JSON.parse(line.slice(6)));
        if (extracted) return extracted;
      } catch {
        // skip malformed SSE lines
      }
    }
    return "";
  }
  const data = await res.json();
  return extractText(data);
}

async function callTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  try {
    if (!cachedSessionId) {
      cachedSessionId = await initSession();
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (cachedSessionId) headers["Mcp-Session-Id"] = cachedSessionId;

    const res = await fetch(MCP_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: toolName, arguments: args },
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      // Session may have expired — reset and retry once
      if (res.status === 404 && cachedSessionId) {
        cachedSessionId = null;
        return callTool(toolName, args);
      }
      return JSON.stringify({
        error: `Azure Pricing MCP returned ${res.status}`,
      });
    }

    const content = await parseResponse(res);
    if (!content) {
      return JSON.stringify({
        error: "No content returned from Azure Pricing MCP",
      });
    }
    return content;
  } catch (err: unknown) {
    cachedSessionId = null;
    const message = err instanceof Error ? err.message : "Unknown error";
    return JSON.stringify({
      error: `Azure Pricing MCP call failed: ${message}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Public API — one function per tool exposed to the agent
// ---------------------------------------------------------------------------

export interface PriceSearchArgs {
  service_name?: string;
  service_family?: string;
  region?: string;
  sku_name?: string;
  price_type?: string;
  currency_code?: string;
  limit?: number;
  discount_percentage?: number;
  show_with_discount?: boolean;
  validate_sku?: boolean;
  output_format?: "compact" | "verbose";
}

export async function mcpPriceSearch(args: PriceSearchArgs): Promise<string> {
  return callTool("azure_price_search", args as Record<string, unknown>);
}

export interface PriceCompareArgs {
  service_name: string;
  sku_name?: string;
  regions?: string[];
  currency_code?: string;
  discount_percentage?: number;
  show_with_discount?: boolean;
  output_format?: "compact" | "verbose";
}

export async function mcpPriceCompare(args: PriceCompareArgs): Promise<string> {
  return callTool(
    "azure_price_compare",
    args as unknown as Record<string, unknown>,
  );
}

export interface RegionRecommendArgs {
  service_name: string;
  sku_name: string;
  top_n?: number;
  currency_code?: string;
  discount_percentage?: number;
  show_with_discount?: boolean;
  output_format?: "compact" | "verbose";
}

export async function mcpRegionRecommend(
  args: RegionRecommendArgs,
): Promise<string> {
  return callTool(
    "azure_region_recommend",
    args as unknown as Record<string, unknown>,
  );
}

export interface RiPricingArgs {
  service_name: string;
  sku_name?: string;
  region?: string;
  reservation_term?: "1 Year" | "3 Years";
  currency_code?: string;
  compare_on_demand?: boolean;
  limit?: number;
  output_format?: "compact" | "verbose";
}

export async function mcpRiPricing(args: RiPricingArgs): Promise<string> {
  return callTool(
    "azure_ri_pricing",
    args as unknown as Record<string, unknown>,
  );
}

export interface BulkEstimateResource {
  service_name: string;
  sku_name: string;
  region: string;
  quantity?: number;
  hours_per_month?: number;
}

export interface BulkEstimateArgs {
  resources: BulkEstimateResource[];
  currency_code?: string;
  discount_percentage?: number;
  show_with_discount?: boolean;
  output_format?: "compact" | "verbose";
}

export async function mcpBulkEstimate(args: BulkEstimateArgs): Promise<string> {
  return callTool(
    "azure_bulk_estimate",
    args as unknown as Record<string, unknown>,
  );
}

export interface SkuDiscoveryArgs {
  service_hint: string;
  region?: string;
  currency_code?: string;
  limit?: number;
  output_format?: "compact" | "verbose";
}

export async function mcpSkuDiscovery(args: SkuDiscoveryArgs): Promise<string> {
  return callTool(
    "azure_sku_discovery",
    args as unknown as Record<string, unknown>,
  );
}
