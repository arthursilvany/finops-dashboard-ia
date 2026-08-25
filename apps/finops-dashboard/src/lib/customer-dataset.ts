import fs from "node:fs";

import type {
  CustomerCostRow,
  CustomerDatasetManifest,
} from "./customer-data/contract";
import { CUSTOMER_DATASET_SCHEMA_VERSION } from "./customer-data/contract";
import { LEGACY_WORKSPACE_SLUG, customerPaths } from "./customer-data/paths";
import {
  customerSlugFromCookieHeader,
  resolveActiveCustomerSlug,
} from "./customer-data/workspace";

/**
 * In-memory dataset built from a customer Cost Export.
 *
 * Data-source precedence across the app is: ADX (production) > customer dataset
 * (pre-sales POC) > static mock (demo). This module owns the middle tier.
 *
 * The dataset is cached per customer workspace and invalidated by the
 * manifest's mtime, mirroring how `adx-client.ts` caches its connection.
 * Caching per slug matters: switching customers in the UI must not serve the
 * previous customer's rows from a stale module-level cache.
 */
export interface CustomerDataset {
  manifest: CustomerDatasetManifest;
  rows: CustomerCostRow[];
}

interface CacheEntry {
  dataset: CustomerDataset | null;
  manifestMtimeMs: number | undefined;
}

const cacheBySlug = new Map<string, CacheEntry>();

function loadDataset(slug: string): CustomerDataset | null {
  const paths = customerPaths(slug);
  if (!fs.existsSync(paths.rows) || !fs.existsSync(paths.manifest)) return null;

  try {
    const manifest = JSON.parse(
      fs.readFileSync(paths.manifest, "utf8"),
    ) as CustomerDatasetManifest;

    // A dataset produced by an older ingest carries different savings
    // semantics (schema 1.0.0 collapsed the baseline onto the effective cost),
    // and the lost columns cannot be reconstructed here. Loading it anyway
    // would render a plausible but wrong savings rate, so refuse loudly and
    // require a re-ingest instead.
    if (manifest.schemaVersion !== CUSTOMER_DATASET_SCHEMA_VERSION) {
      console.error(
        `[customer-dataset] dataset schema ${manifest.schemaVersion} does not match ` +
          `${CUSTOMER_DATASET_SCHEMA_VERSION}. Re-run "npm run ingest:customer" — ` +
          `the dataset was NOT loaded.`,
      );
      return null;
    }

    const rows: CustomerCostRow[] = [];
    const content = fs.readFileSync(paths.rows, "utf8");
    for (const line of content.split("\n")) {
      if (!line) continue;
      rows.push(JSON.parse(line) as CustomerCostRow);
    }

    if (rows.length === 0) return null;
    return { manifest, rows };
  } catch (error) {
    // A corrupt dataset must not take the dashboard down: fall back to mocks.
    console.error("[customer-dataset] failed to load customer dataset:", error);
    return null;
  }
}

/**
 * Dataset of a specific customer, or of the active one when `slug` is omitted.
 *
 * The optional parameter is what keeps this change small: every existing caller
 * (aggregators, route handlers, agent tools) keeps working untouched and simply
 * follows the browser's current selection.
 */
export function getCustomerDataset(slug?: string): CustomerDataset | null {
  const resolved = slug ?? resolveActiveCustomerSlug() ?? LEGACY_WORKSPACE_SLUG;
  const manifestFile = customerPaths(resolved).manifest;
  const manifestMtimeMs = fs.existsSync(manifestFile)
    ? fs.statSync(manifestFile).mtimeMs
    : undefined;

  const entry = cacheBySlug.get(resolved);
  if (entry && entry.manifestMtimeMs === manifestMtimeMs) {
    return entry.dataset;
  }

  const dataset = loadDataset(resolved);
  cacheBySlug.set(resolved, { dataset, manifestMtimeMs });
  if (dataset) {
    console.log(
      `[customer-dataset] loaded ${dataset.rows.length} rows for ` +
        `"${dataset.manifest.customer}" (${resolved})`,
    );
  }
  return dataset;
}

export function hasCustomerDataset(slug?: string): boolean {
  return getCustomerDataset(slug) !== null;
}

export function getCustomerDatasetForRequest(
  request: Pick<Request, "headers">,
): CustomerDataset | null {
  return getCustomerDataset(
    customerSlugFromCookieHeader(request.headers.get("cookie")) ?? undefined,
  );
}

export function hasCustomerDatasetForRequest(
  request: Pick<Request, "headers">,
): boolean {
  return getCustomerDatasetForRequest(request) !== null;
}

/** Test/CLI hook — drops the cache so the next call re-reads from disk. */
export function resetCustomerDatasetCache(slug?: string): void {
  if (slug) {
    cacheBySlug.delete(slug);
    return;
  }
  cacheBySlug.clear();
}
