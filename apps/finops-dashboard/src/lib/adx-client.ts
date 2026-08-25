import { DefaultAzureCredential, type AccessToken } from "@azure/identity";

const ADX_SCOPE = "https://kusto.kusto.windows.net/.default";
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;
const DEFAULT_QUERY_TIMEOUT_SECONDS = 30;
// Kusto refuses a servertimeout above one hour, and a non-positive one is
// meaningless, so an out-of-range setting falls back rather than failing every
// query with a request-properties error.
const MIN_QUERY_TIMEOUT_SECONDS = 1;
const MAX_QUERY_TIMEOUT_SECONDS = 3600;

/**
 * How long a single ADX query may run, from `ADX_QUERY_TIMEOUT_SECONDS`.
 *
 * The deployment templates have always set this variable and the portal has
 * always offered it as "query timeout", but nothing read it: the client aborted
 * at a hard-coded 30s regardless. Anything unparseable or out of range falls
 * back to the default instead of throwing, because a malformed environment
 * variable should not take the dashboard down.
 */
export function getQueryTimeoutSeconds(): number {
  const raw = process.env.ADX_QUERY_TIMEOUT_SECONDS?.trim();
  if (!raw) return DEFAULT_QUERY_TIMEOUT_SECONDS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_QUERY_TIMEOUT_SECONDS;
  const seconds = Math.floor(parsed);
  if (seconds < MIN_QUERY_TIMEOUT_SECONDS) return DEFAULT_QUERY_TIMEOUT_SECONDS;
  if (seconds > MAX_QUERY_TIMEOUT_SECONDS) return MAX_QUERY_TIMEOUT_SECONDS;
  return seconds;
}

/** Kusto expects `servertimeout` as an hh:mm:ss timespan. */
function toKustoTimespan(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * The exact payload sent to Kusto. Exported so the deadline can be asserted
 * without a cluster or a credential.
 *
 * Aborting the fetch only frees the dashboard: the cluster keeps executing the
 * abandoned query and keeps charging for it. `servertimeout` is what actually
 * cancels the work, so the deadline is sent to Kusto as well.
 *
 * Only for `query`. Control commands are the health check's `.show` probe --
 * trivial, and the last thing that should start failing on a request-property
 * technicality when someone is already trying to diagnose a broken cluster.
 */
export function buildRequestBody(
  database: string,
  kql: string,
  endpoint: "query" | "mgmt",
  timeoutSeconds: number,
): Record<string, unknown> {
  const body: Record<string, unknown> = { db: database, csl: kql };
  if (endpoint === "query") {
    body.properties = {
      Options: { servertimeout: toKustoTimespan(timeoutSeconds) },
    };
  }
  return body;
}

// Token cache: reuse token until near expiry
let cachedToken: AccessToken | undefined;
let credential: DefaultAzureCredential | undefined;

// Runtime config override (set via /api/config/save)
let runtimeClusterUri: string | undefined;
let runtimeDatabase: string | undefined;

function getCredential(): DefaultAzureCredential {
  if (!credential) credential = new DefaultAzureCredential();
  return credential;
}

async function getToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresOnTimestamp - now > 60_000) {
    return cachedToken.token;
  }
  cachedToken = await getCredential().getToken(ADX_SCOPE);
  return cachedToken.token;
}

/**
 * Exported for tests: the retry loop, which is where the deadline used to be
 * silently multiplied by the attempt count.
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  retries = MAX_RETRIES,
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(timeoutMs),
      });
      return res;
    } catch (err) {
      // Retries exist for transient network faults. A query that exhausted its
      // budget is not transient: re-running it multiplies the configured
      // timeout by the attempt count and piles identical work onto a cluster
      // that is already struggling, so the deadline is reported as-is.
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new Error(
          `ADX query timed out after ${Math.round(timeoutMs / 1000)}s. ` +
            "Narrow the date range or raise ADX_QUERY_TIMEOUT_SECONDS.",
        );
      }
      if (attempt === retries) throw err;
      const delay = RETRY_BASE_MS * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("fetchWithRetry: exhausted retries");
}

export function setRuntimeConfig(clusterUri: string, database: string) {
  const pattern = /^https:\/\/[a-z0-9-]+\.[a-z]+\.kusto\.windows\.net$/i;
  if (!pattern.test(clusterUri)) {
    throw new Error("Invalid ADX cluster URI format");
  }
  runtimeClusterUri = clusterUri;
  runtimeDatabase = database;
}

export function getRuntimeConfig(): {
  clusterUri: string | undefined;
  database: string | undefined;
} {
  return { clusterUri: runtimeClusterUri, database: runtimeDatabase };
}

function getClusterUri(): string {
  const uri = runtimeClusterUri || process.env.ADX_CLUSTER_URI;
  if (!uri)
    throw new Error(
      "ADX cluster URI is not configured. Go to Settings to connect.",
    );
  return uri;
}

function getDatabase(): string {
  return runtimeDatabase || process.env.ADX_DATABASE || "Hub";
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
}

interface AdxTable {
  TableName: string;
  Columns: { ColumnName: string; DataType: string }[];
  Rows: unknown[][];
}

interface AdxResponse {
  Tables: AdxTable[];
  Exceptions?: string[];
}

async function adxRestCall(
  clusterUri: string,
  database: string,
  kql: string,
  endpoint: "query" | "mgmt",
): Promise<QueryResult> {
  const token = await getToken();
  const url = `${clusterUri}/v1/rest/${endpoint}`;
  const timeoutSeconds = getQueryTimeoutSeconds();

  const res = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(
        buildRequestBody(database, kql, endpoint, timeoutSeconds),
      ),
    },
    // Give the client a small grace period over the server deadline so Kusto's
    // own timeout error surfaces instead of a generic client abort.
    (timeoutSeconds + 5) * 1000,
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `ADX ${endpoint} failed (${res.status}): ${text.slice(0, 200)}`,
    );
  }

  const data: AdxResponse = await res.json();

  if (data.Exceptions && data.Exceptions.length > 0) {
    throw new Error(`ADX error: ${data.Exceptions[0]}`);
  }

  const table = data.Tables?.[0];
  if (!table) return { columns: [], rows: [] };

  const columns = table.Columns.map((c) => c.ColumnName);
  const rows: Record<string, unknown>[] = table.Rows.map((row) => {
    const record: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      record[col] = row[i];
    });
    return record;
  });

  return { columns, rows };
}

export async function executeQuery(
  kql: string,
  overrideDatabase?: string,
): Promise<QueryResult> {
  const clusterUri = getClusterUri();
  const database = overrideDatabase || getDatabase();
  const isManagement = kql.trimStart().startsWith(".");
  return adxRestCall(
    clusterUri,
    database,
    kql,
    isManagement ? "mgmt" : "query",
  );
}

export async function executeQueryOnCluster(
  clusterUri: string,
  database: string,
  kql: string,
): Promise<QueryResult> {
  const isManagement = kql.trimStart().startsWith(".");
  return adxRestCall(
    clusterUri,
    database,
    kql,
    isManagement ? "mgmt" : "query",
  );
}

export function isMockMode(): boolean {
  if (runtimeClusterUri || process.env.ADX_CLUSTER_URI) return false;
  return true;
}

export function getActiveConfig(): {
  clusterUri: string;
  database: string;
  source: "runtime" | "env" | "none";
} {
  if (runtimeClusterUri) {
    return {
      clusterUri: runtimeClusterUri,
      database: runtimeDatabase || "Hub",
      source: "runtime",
    };
  }
  if (process.env.ADX_CLUSTER_URI) {
    return {
      clusterUri: process.env.ADX_CLUSTER_URI,
      database: process.env.ADX_DATABASE || "Hub",
      source: "env",
    };
  }
  return { clusterUri: "", database: "", source: "none" };
}

export async function checkHealth(): Promise<{
  connected: boolean;
  cluster: string;
  database: string;
  error?: string;
}> {
  try {
    const config = getActiveConfig();
    if (config.source === "none") {
      return {
        connected: false,
        cluster: "not configured",
        database: "",
        error: "No ADX cluster configured",
      };
    }
    await executeQuery(".show database schema | take 1");
    return {
      connected: true,
      cluster: config.clusterUri,
      database: config.database,
    };
  } catch (err) {
    const config = getActiveConfig();
    return {
      connected: false,
      cluster: config.clusterUri || "not configured",
      database: config.database,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function listDatabases(clusterUri: string): Promise<string[]> {
  const result = await executeQueryOnCluster(
    clusterUri,
    "NetDefaultDB",
    ".show databases | project DatabaseName",
  );
  return result.rows.map((r) => r.DatabaseName as string).filter(Boolean);
}
