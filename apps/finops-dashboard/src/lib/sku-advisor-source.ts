import fs from "node:fs";

import {
  customerPaths,
  LEGACY_WORKSPACE_SLUG,
  type CustomerWorkspacePaths,
} from "./customer-data/paths";
import {
  listCustomerWorkspaces,
  resolveActiveCustomerSlug,
} from "./customer-data/workspace";
import { mockSkuAdvisorPayload } from "./mock-data/sku-advisor";
import {
  fetchSkuAdvisorPayload,
  isSkuAdvisorConfigured,
  type SkuAdvisorInventory,
  type SkuAdvisorParams,
  type SkuAdvisorTelemetry,
} from "./sku-advisor-client";
import {
  parseSkuAdvisorPayload,
  type SkuAdvisorPayload,
} from "./sku-advisor-contract";

/**
 * Resolves where the SKU Advisor numbers come from.
 *
 * Precedence mirrors the rest of the dashboard — live backend first, then the
 * customer's own export, then the bundled sample:
 *
 *   1. `service`  — the advisor microservice, when `SKU_ADVISOR_API_URL` is set.
 *   2. `customer` — a `recommendations.json` produced by the advisor CLI and
 *                   placed in the active customer workspace.
 *   3. `mock`     — the bundled synthetic sample.
 *
 * The chosen source travels back to the browser in `metadata`, because a
 * rightsizing plan built on sample data and one built on the customer's own
 * estate must never look alike on screen.
 */

export type SkuAdvisorSource = "service" | "customer" | "mock";

export interface SkuAdvisorResolution {
  payload: SkuAdvisorPayload;
  source: SkuAdvisorSource;
  /** Set for `customer`, for the provenance badge. */
  customerName?: string;
  /** When the advisor produced the export, as reported by the payload. */
  generatedAt?: string;
  /**
   * For `service`: whether the VM inventory was discovered live or came from
   * the advisor's bundled offline export. "Live service" alone is not enough
   * to tell a stakeholder these are their own numbers.
   */
  inventory?: SkuAdvisorInventory;
  /**
   * For `service`: whether rightsizing was guided by a live 90-day P99
   * CPU/memory/IOPS busy-signal from Azure Monitor, or fell back to
   * spec-parity sizing alone because telemetry was not requested/allowed.
   */
  telemetry?: SkuAdvisorTelemetry;
}

function readPayloadFile(file: string): SkuAdvisorPayload | null {
  if (!fs.existsSync(file)) return null;
  try {
    return parseSkuAdvisorPayload(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (error) {
    console.error(`[sku-advisor] failed to read ${file}:`, error);
    return null;
  }
}

function readWorkspaceExport(
  paths: CustomerWorkspacePaths,
): SkuAdvisorPayload | null {
  // The normalized copy wins; the raw drop is the convenience path for someone
  // who just ran the advisor CLI and copied its output in.
  return (
    readPayloadFile(paths.skuAdvisor) ?? readPayloadFile(paths.skuAdvisorInput)
  );
}

function activeCustomerName(slug: string): string | undefined {
  return listCustomerWorkspaces().find((w) => w.slug === slug)?.displayName;
}

/**
 * A short in-process memo, keyed by the normalized parameters.
 *
 * It exists for two reasons beyond speed. First, the page opens five panels at
 * once and each one resolves independently: without sharing a result, a run
 * that answers some panels and times out on others would put live figures next
 * to sample figures under a single "live" badge. Second, an advisor run is
 * expensive and `threshold`/`currency`/`os_type` are caller-influenceable, so
 * an authenticated user could otherwise walk those values and force an
 * unbounded number of full pipeline runs.
 */
const MEMO_TTL_MS = 60_000;
/** Bounded so distinct parameter values cannot grow this without limit. */
const MEMO_MAX_ENTRIES = 32;

const memo = new Map<string, { at: number; resolution: SkuAdvisorResolution }>();
const inFlight = new Map<string, Promise<SkuAdvisorResolution>>();

function memoKey(
  params: SkuAdvisorParams,
  customerSlug?: string | null,
): string {
  const normalized = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => [k, (Array.isArray(v) ? [...v].sort() : [v]).join(",")])
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([customerSlug ?? "", normalized]);
}

function readMemo(key: string): SkuAdvisorResolution | null {
  const hit = memo.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > MEMO_TTL_MS) {
    memo.delete(key);
    return null;
  }
  return hit.resolution;
}

function writeMemo(key: string, resolution: SkuAdvisorResolution): void {
  // Only the service tier is memoized. The workspace export is a cheap local
  // read, and caching it keyed on advisor params alone would ignore which
  // customer is active — after a workspace switch the page would keep serving
  // the previous customer's estate. The sample is excluded too: it is the
  // fallback for a failing service, so caching it would pin the page to sample
  // data after the service recovers.
  if (resolution.source !== "service") return;
  if (memo.size >= MEMO_MAX_ENTRIES) {
    const oldest = memo.keys().next();
    if (!oldest.done) memo.delete(oldest.value);
  }
  memo.set(key, { at: Date.now(), resolution });
}

export async function resolveSkuAdvisorPayload(
  params: SkuAdvisorParams = {},
  customerSlug?: string | null,
): Promise<SkuAdvisorResolution> {
  const key = memoKey(params, customerSlug);
  const cached = readMemo(key);
  if (cached) return cached;

  // Collapse concurrent callers onto one pipeline run. The page opens five
  // panels at once; without this they would each trigger a full advisor run.
  const pending = inFlight.get(key);
  if (pending) return pending;

  const run = resolveUncached(params, customerSlug).finally(() => inFlight.delete(key));
  inFlight.set(key, run);

  const resolution = await run;
  writeMemo(key, resolution);
  return resolution;
}

async function resolveUncached(
  params: SkuAdvisorParams,
  customerSlug?: string | null,
): Promise<SkuAdvisorResolution> {
  if (isSkuAdvisorConfigured()) {
    const result = await fetchSkuAdvisorPayload(params);
    if (result) {
      return {
        payload: result.payload,
        source: "service",
        inventory: result.inventory,
        telemetry: result.telemetry,
        generatedAt: result.payload.generated_at ?? undefined,
      };
    }
    // Configured but unreachable: fall through rather than fail the page, and
    // let the source label downgrade so nobody mistakes the fallback for live.
    console.warn(
      "[sku-advisor] service is configured but did not answer; falling back.",
    );
  }

  const slug = resolveActiveCustomerSlug(customerSlug) ?? LEGACY_WORKSPACE_SLUG;
  const payload = readWorkspaceExport(customerPaths(slug));
  if (payload) {
    return {
      payload,
      source: "customer",
      customerName: activeCustomerName(slug),
      generatedAt: payload.generated_at ?? undefined,
    };
  }

  return {
    payload: mockSkuAdvisorPayload,
    source: "mock",
    generatedAt: mockSkuAdvisorPayload.generated_at ?? undefined,
  };
}
