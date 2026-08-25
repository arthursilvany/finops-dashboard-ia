/**
 * Minimal MCP HTTP client for the Microsoft Learn documentation server.
 * Implements the MCP Streamable HTTP transport (2024-11-05 protocol version).
 */

const LEARN_MCP_URL = "https://learn.microsoft.com/api/mcp?maxTokenBudget=4000";
const LEARN_HOST = "learn.microsoft.com";

// Module-level session cache — shared across requests within the same server process
let cachedSessionId: string | null = null;
let sessionInitialization: Promise<string | null> | null = null;

export interface MicrosoftLearnReference {
  title: string;
  url: string;
}

export interface MicrosoftLearnSearchResult {
  content: string;
  references: MicrosoftLearnReference[];
}

export class MicrosoftLearnMcpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MicrosoftLearnMcpError";
  }
}

async function initSession(): Promise<string | null> {
  try {
    const res = await fetch(LEARN_MCP_URL, {
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
      // Confirm initialization per MCP spec
      await fetch(LEARN_MCP_URL, {
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

function extractContentFromResponse(data: unknown): string {
  if (data && typeof data === "object" && "result" in data) {
    const result = (data as { result: unknown }).result;
    if (result && typeof result === "object" && "content" in result) {
      const content = (result as { content: unknown }).content;
      // MCP content is usually an array of {type, text} objects
      if (Array.isArray(content)) {
        return content
          .filter(
            (c: unknown) =>
              c &&
              typeof c === "object" &&
              (c as { type: string }).type === "text",
          )
          .map((c: unknown) => (c as { text: string }).text)
          .join("\n");
      }
      return JSON.stringify(content);
    }
  }
  return "";
}

async function parseResponse(res: Response): Promise<string> {
  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("text/event-stream")) {
    const text = await res.text();
    for (const line of text.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try {
        const extracted = extractContentFromResponse(JSON.parse(line.slice(6)));
        if (extracted) return extracted;
      } catch {
        // skip malformed SSE lines
      }
    }
    return "";
  }

  const data = await res.json();
  return extractContentFromResponse(data);
}

function isLearnDocumentUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.hostname !== LEARN_HOST) return null;
    if (/\.(svg|png|jpe?g|gif|webp|ico)$/i.test(url.pathname)) return null;
    return url;
  } catch {
    return null;
  }
}

function structuredItems(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item && typeof item === "object" && !Array.isArray(item)),
    );
  }
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  for (const key of ["results", "items", "value"]) {
    const items = structuredItems(object[key]);
    if (items.length > 0) return items;
  }
  return [];
}

export function extractMicrosoftLearnReferences(
  content: string,
): MicrosoftLearnReference[] {
  const references = new Map<string, MicrosoftLearnReference>();

  try {
    const items = structuredItems(JSON.parse(content));
    for (const item of items) {
      const url = isLearnDocumentUrl(String(item.contentUrl ?? ""));
      const title = String(item.title ?? "").trim();
      if (!url || !title) continue;
      references.set(url.toString(), {
        title: title.slice(0, 200),
        url: url.toString(),
      });
      if (references.size >= 5) return Array.from(references.values());
    }
  } catch {
    // Some MCP server versions return markdown instead of JSON.
  }

  const markdownLink = /\[([^\]]+)\]\((https?:\/\/learn\.microsoft\.com[^)\s]+)\)/gi;
  let match: RegExpExecArray | null;

  while ((match = markdownLink.exec(content)) !== null) {
    const url = isLearnDocumentUrl(match[2]);
    if (!url) continue;
    const title = match[1].trim().slice(0, 200);
    references.set(url.toString(), {
      title: title || "Microsoft Learn",
      url: url.toString(),
    });
  }

  const bareUrl = /https?:\/\/learn\.microsoft\.com\/[^\s)>",]+/gi;
  while ((match = bareUrl.exec(content)) !== null) {
    const url = isLearnDocumentUrl(match[0]);
    if (!url || references.has(url.toString())) continue;
    const lastPath = url.pathname.split("/").filter(Boolean).pop();
    references.set(url.toString(), {
      title: lastPath?.replace(/-/g, " ") || "Microsoft Learn",
      url: url.toString(),
    });
  }

  return Array.from(references.values()).slice(0, 5);
}

async function callMicrosoftDocsSearch(query: string): Promise<string> {
  if (!query.trim()) {
    throw new MicrosoftLearnMcpError("Microsoft Learn query cannot be empty");
  }

  if (!cachedSessionId) {
    sessionInitialization ??= initSession();
    cachedSessionId = await sessionInitialization;
    sessionInitialization = null;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (cachedSessionId) headers["Mcp-Session-Id"] = cachedSessionId;

  const res = await fetch(LEARN_MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "microsoft_docs_search",
        arguments: { query: query.trim() },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    if (res.status === 404 && cachedSessionId) {
      cachedSessionId = null;
      sessionInitialization = null;
      return callMicrosoftDocsSearch(query);
    }
    throw new MicrosoftLearnMcpError(
      `Microsoft Learn MCP returned ${res.status}`,
    );
  }

  const content = await parseResponse(res);
  if (!content) {
    throw new MicrosoftLearnMcpError(
      "No content returned from Microsoft Learn",
    );
  }
  return content;
}

export async function searchMicrosoftDocsStructured(
  query: string,
): Promise<MicrosoftLearnSearchResult> {
  try {
    const content = await callMicrosoftDocsSearch(query);
    return {
      content,
      references: extractMicrosoftLearnReferences(content),
    };
  } catch (error) {
    cachedSessionId = null;
    sessionInitialization = null;
    if (error instanceof MicrosoftLearnMcpError) throw error;
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new MicrosoftLearnMcpError(
      `Microsoft Learn search failed: ${message}`,
    );
  }
}

export async function searchMicrosoftDocs(query: string): Promise<string> {
  try {
    const result = await searchMicrosoftDocsStructured(query);
    return result.content;
  } catch (err: unknown) {
    cachedSessionId = null;
    sessionInitialization = null;
    const message = err instanceof Error ? err.message : "Unknown error";
    return JSON.stringify({
      error: `Microsoft Learn search failed: ${message}`,
    });
  }
}
