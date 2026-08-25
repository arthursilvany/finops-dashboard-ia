import {
  parseSkuAdvisorPayload,
  type SkuAdvisorPayload,
} from "./sku-advisor-contract";

/**
 * Server-side client for the Azure SKU Advisor microservice.
 *
 * The advisor runs as an internal-only Container App (same pattern as the
 * pricing MCP server), so the browser never reaches it: every call goes through
 * this module from a BFF route.
 *
 * Two things are deliberately not forwarded from the browser:
 *
 *   * the `live_*` flags — they drive the advisor's Managed Identity into
 *     Resource Graph, Log Analytics, quota and Advisor reads;
 *   * `ai_narrative` / `waf_review` — a billable Azure OpenAI call plus an
 *     egress of the customer's estate facts.
 *
 * The advisor gates both server-side too (`SKU_ADVISOR_ALLOW_LIVE`,
 * `SKU_ADVISOR_ALLOW_AI`, off by default), but the allowlist below means a
 * crafted query string can never even ask.
 *
 * `live_usage` is the one live flag the deployment may opt into, and only from
 * the server: it decides whether the recommendations describe the customer's
 * real inventory or the advisor's bundled offline export. Because that changes
 * what the numbers *mean*, the result reports which of the two it got so the
 * page can label it honestly.
 */

/**
 * Generous: on a cold cache the advisor runs its full pipeline and prices every
 * candidate against the public Retail Prices API, which takes well over the
 * usual API budget. A timeout here silently downgrades the page to sample data,
 * so it is set above the observed cold-start cost rather than at a round number.
 */
const REQUEST_TIMEOUT_MS = 120_000;

/** Query parameters a caller may influence. Everything else is ignored. */
const FORWARDABLE_PARAMS = [
  "region",
  "currency",
  "threshold",
  "subscription",
  "cross_arch",
  "cross_family",
  "hybrid_benefit",
  "os_type",
] as const;

export type SkuAdvisorParams = Partial<
  Record<(typeof FORWARDABLE_PARAMS)[number], string | string[]>
>;

/**
 * Where the VM inventory behind the recommendations came from.
 *
 * `live` means Resource Graph discovered the customer's actual VMs; `offline`
 * means the advisor used its bundled sample inventory and only the prices are
 * real. The savings figures are not comparable between the two.
 */
export type SkuAdvisorInventory = "live" | "offline";

/**
 * Whether the recommendations were guided by a real 90-day P99 CPU/memory/IOPS
 * busy-signal. `live` means the advisor measured it from Azure Monitor;
 * `unavailable` means telemetry was requested but the advisor was not allowed
 * (or configured) to serve it and every recommendation falls back to
 * spec-parity sizing alone.
 */
export type SkuAdvisorTelemetry = "live" | "unavailable";

export interface SkuAdvisorFetchResult {
  payload: SkuAdvisorPayload;
  inventory: SkuAdvisorInventory;
  telemetry: SkuAdvisorTelemetry;
}

function baseUrl(): string | null {
  const url = process.env.SKU_ADVISOR_API_URL?.trim();
  return url ? url.replace(/\/$/, "") : null;
}

/** True when a live advisor service is configured for this deployment. */
export function isSkuAdvisorConfigured(): boolean {
  return baseUrl() !== null;
}

/**
 * Server-side opt-in for live inventory discovery. Never derived from request
 * input: this is the flag that lets the advisor's Managed Identity read the
 * customer's estate, so only the deployment may turn it on.
 */
function wantsLiveInventory(): boolean {
  return isTruthyEnv(process.env.SKU_ADVISOR_LIVE_USAGE);
}

/**
 * Server-side opt-in for live rightsizing telemetry (90-day P99 CPU/memory/IOPS
 * busy-signal from Azure Monitor). Same Managed-Identity trust boundary as
 * `wantsLiveInventory`: only the deployment may turn it on, never the browser.
 */
function wantsLiveTelemetry(): boolean {
  return isTruthyEnv(process.env.SKU_ADVISOR_LIVE_TELEMETRY);
}

function isTruthyEnv(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

/**
 * Regions the deployment expects its estate to live in.
 *
 * Live discovery is filtered by region, and when the caller names none the
 * advisor falls back to its own `settings.regions` — a *pricing* scope that
 * defaults to `eastus`. An estate outside that list then comes back as zero
 * workloads with no error and no warning, which is indistinguishable from a
 * customer who genuinely runs nothing. Declaring the regions here is what
 * keeps the view honest.
 */
function defaultRegions(): string[] {
  return (process.env.SKU_ADVISOR_REGIONS ?? "")
    .split(",")
    .map((region) => region.trim())
    .filter((region) => region !== "");
}

/** Exported for tests: the exact query the BFF sends to the advisor. */
export function buildAdvisorQuery(
  params: SkuAdvisorParams,
  liveUsage: boolean,
  liveTelemetry: boolean = false,
): URLSearchParams {
  const search = new URLSearchParams();
  for (const key of FORWARDABLE_PARAMS) {
    const value = params[key];
    if (value === undefined || value === null || value === "") continue;
    // `region` and `subscription` are repeatable on the advisor side.
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== "") search.append(key, String(item));
    }
  }
  if (!search.has("region")) {
    for (const region of defaultRegions()) search.append("region", region);
  }
  // Retail pricing hits the public price API and needs no identity, so it is
  // the one "live" flag that is safe to keep on.
  search.set("live_pricing", "true");
  // The quota ledger and capacity awareness run off a bundled catalog unless
  // their `live_*` twins are set, so they need no identity either. Without
  // them the advisor omits the capacity block entirely and the view cannot
  // tell "no blockers" apart from "never checked".
  search.set("quota", "true");
  search.set("capacity", "true");
  if (liveUsage) search.set("live_usage", "true");
  if (liveTelemetry) {
    // `live_telemetry` implies `telemetry` on the advisor side, but setting
    // both keeps the query self-explanatory and matches the advisor's own
    // `_cached_pipeline` key derivation.
    search.set("telemetry", "true");
    search.set("live_telemetry", "true");
  }
  return search;
}

/**
 * Fetches the recommendations payload from the live advisor service.
 *
 * Returns `null` when the service is not configured, unreachable, or answers
 * with something that does not match the contract — the caller then falls back
 * to the customer export or the bundled sample.
 *
 * When the deployment asked for live inventory and/or live telemetry but the
 * advisor refuses them (`SKU_ADVISOR_ALLOW_LIVE` off, HTTP 403 — the advisor
 * rejects the whole request if *any* requested live flag is disallowed, so the
 * two cannot be told apart from the status code alone), the call is retried
 * with both off: a stricter advisor should degrade the *meaning* of the
 * answer, not take the whole view down. The degraded meaning is reported back.
 */
export async function fetchSkuAdvisorPayload(
  params: SkuAdvisorParams = {},
): Promise<SkuAdvisorFetchResult | null> {
  const base = baseUrl();
  if (!base) return null;

  const liveUsage = wantsLiveInventory();
  const liveTelemetry = wantsLiveTelemetry();

  if (liveUsage || liveTelemetry) {
    const live = await requestPayload(base, params, liveUsage, liveTelemetry);
    if (live.payload) {
      return {
        payload: live.payload,
        inventory: liveUsage ? "live" : "offline",
        telemetry: liveTelemetry ? "live" : "unavailable",
      };
    }
    if (live.status !== 403) return null;
    console.warn(
      "[sku-advisor] live reads refused by the service " +
        "(SKU_ADVISOR_ALLOW_LIVE is off); retrying with them off.",
    );
  }

  const offline = await requestPayload(base, params, false, false);
  return offline.payload
    ? { payload: offline.payload, inventory: "offline", telemetry: "unavailable" }
    : null;
}

async function requestPayload(
  base: string,
  params: SkuAdvisorParams,
  liveUsage: boolean,
  liveTelemetry: boolean,
): Promise<{ payload: SkuAdvisorPayload | null; status: number | null }> {
  const query = buildAdvisorQuery(params, liveUsage, liveTelemetry).toString();
  const url = `${base}/api/recommendations?${query}`;
  const apiKey = process.env.SKU_ADVISOR_API_KEY?.trim();

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(
        `[sku-advisor] service returned ${response.status} ${response.statusText}`,
      );
      return { payload: null, status: response.status };
    }


    return { payload: parseSkuAdvisorPayload(await response.json()), status: 200 };
  } catch (error) {
    console.error("[sku-advisor] service call failed:", error);
    return { payload: null, status: null };
  }
}
