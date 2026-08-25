import fs from "node:fs";
import path from "node:path";

import type { CustomerDatasetManifest } from "./contract";
import {
  LEGACY_WORKSPACE_SLUG,
  customerOutputRootDir,
  customerPaths,
  customerRootDir,
  isSafeWorkspaceName,
  legacyRegistryFile,
  registryFile,
  type CustomerWorkspacePaths,
} from "./paths";

/**
 * Which customer the dashboard is currently showing.
 *
 * The POC flow is inherently multi-customer: one collection per account, run
 * over weeks, all living on the same laptop. Before workspaces existed the
 * ingest merged every export found under the root into a single dataset, so
 * two customers silently became one. Isolating each customer in its own folder
 * is what makes that class of mistake impossible rather than merely unlikely.
 *
 * Selection is per browser (a cookie), never a server-wide toggle: two tabs may
 * legitimately show two customers side by side during a review.
 */

/** Cookie carrying the selected slug. Read-only as far as the server cares. */
export const CUSTOMER_COOKIE = "finops_customer";

export interface CustomerWorkspace {
  slug: string;
  /** Name shown in the UI. Falls back to the slug when nothing better exists. */
  displayName: string;
  /** True for the pre-workspace layout sitting directly in the root. */
  isLegacy: boolean;
  /** False when the folder exists but was never ingested. */
  hasDataset: boolean;
  rowCount: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  currency: string | null;
  ingestedAtUtc: string | null;
}

interface RegistryEntry {
  slug: string;
  displayName: string;
  ingestedAtUtc: string;
}

interface Registry {
  schemaVersion: string;
  /** Slug of the most recent successful ingest. Drives the default selection. */
  lastIngestedSlug: string | null;
  customers: RegistryEntry[];
}

const REGISTRY_SCHEMA_VERSION = "1.0.0";

const EMPTY_REGISTRY: Registry = {
  schemaVersion: REGISTRY_SCHEMA_VERSION,
  lastIngestedSlug: null,
  customers: [],
};

export function readRegistry(): Registry {
  // The output location wins; the input root is where the registry lived before
  // the two trees were split, and is still read so an upgrade keeps its
  // display names and last selection.
  for (const file of [registryFile(), legacyRegistryFile()]) {
    try {
      const raw = fs.readFileSync(file, "utf8");
      const parsed = JSON.parse(raw) as Partial<Registry>;
      return {
        schemaVersion: parsed.schemaVersion ?? REGISTRY_SCHEMA_VERSION,
        lastIngestedSlug: parsed.lastIngestedSlug ?? null,
        customers: Array.isArray(parsed.customers) ? parsed.customers : [],
      };
    } catch {
      // Missing or corrupt registry is not fatal: the folders on disk are the
      // real source of truth, and the registry only records preference.
    }
  }

  return { ...EMPTY_REGISTRY, customers: [] };
}

export function writeRegistry(registry: Registry): void {
  const file = registryFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

/** Records a successful ingest and makes that customer the new default. */
export function recordIngestedCustomer(
  slug: string,
  displayName: string,
): void {
  const registry = readRegistry();
  const others = registry.customers.filter((entry) => entry.slug !== slug);

  writeRegistry({
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    lastIngestedSlug: slug,
    customers: [
      ...others,
      { slug, displayName, ingestedAtUtc: new Date().toISOString() },
    ].sort((a, b) => a.slug.localeCompare(b.slug)),
  });
}

function readManifest(slug: string): CustomerDatasetManifest | null {
  try {
    const raw = fs.readFileSync(customerPaths(slug).manifest, "utf8");
    return JSON.parse(raw) as CustomerDatasetManifest;
  } catch {
    return null;
  }
}

function describeWorkspace(
  slug: string,
  registryEntries: Map<string, RegistryEntry>,
): CustomerWorkspace {
  const manifest = readManifest(slug);
  const entry = registryEntries.get(slug);
  const isLegacy = slug === LEGACY_WORKSPACE_SLUG;

  return {
    slug,
    displayName:
      manifest?.customer ??
      entry?.displayName ??
      (isLegacy ? "Customer (root folder)" : slug),
    isLegacy,
    hasDataset: manifest !== null,
    rowCount: manifest?.rowCount ?? null,
    periodStart: manifest?.periodStart ?? null,
    periodEnd: manifest?.periodEnd ?? null,
    currency: manifest?.currencies?.[0] ?? null,
    ingestedAtUtc: manifest?.generatedAtUtc ?? entry?.ingestedAtUtc ?? null,
  };
}

/** Customer folders present on disk, ingested or not. */
export function listWorkspaceSlugs(): string[] {
  // A customer can appear in either tree: collected but not yet ingested (input
  // only), or ingested from an export that has since been deleted to save disk
  // (output only). Both are real customers as far as the UI is concerned.
  const names = new Set<string>();
  for (const root of [customerRootDir(), customerOutputRootDir()]) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && isSafeWorkspaceName(entry.name)) {
        names.add(entry.name);
      }
    }
  }

  const slugs = Array.from(names).sort();

  // The root counts as a workspace only when it actually holds a dataset,
  // otherwise every install would show an empty phantom customer.
  if (fs.existsSync(customerPaths(LEGACY_WORKSPACE_SLUG).manifest)) {
    slugs.unshift(LEGACY_WORKSPACE_SLUG);
  }

  return slugs;
}

export function listCustomerWorkspaces(): CustomerWorkspace[] {
  const registryEntries = new Map(
    readRegistry().customers.map((entry) => [entry.slug, entry]),
  );

  return listWorkspaceSlugs().map((slug) =>
    describeWorkspace(slug, registryEntries),
  );
}

function isKnownSlug(slug: string): boolean {
  if (slug !== LEGACY_WORKSPACE_SLUG && !isSafeWorkspaceName(slug)) return false;
  return fs.existsSync(customerPaths(slug).manifest);
}

/**
 * Resolves a selected workspace from one request's Cookie header.
 *
 * This deliberately does not depend on `next/headers`: callers carry the
 * request value explicitly, keeping selection scoped to the browser request
 * and leaving scripts and tests on their normal fallback path.
 */
export function customerSlugFromCookieHeader(
  cookieHeader: string | null | undefined,
): string | null {
  if (!cookieHeader) return null;

  for (const entry of cookieHeader.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0) continue;
    const name = entry.slice(0, separator).trim();
    if (name !== CUSTOMER_COOKIE) continue;

    const slug = entry.slice(separator + 1).trim();
    return slug && isKnownSlug(slug) ? slug : null;
  }

  return null;
}

/**
 * Which customer to serve, in order of precedence:
 *
 *   1. the browser's selection cookie
 *   2. `CUSTOMER_SLUG` (scripts, tests, CI)
 *   3. the most recently ingested customer
 *   4. the legacy root dataset
 *   5. the only workspace available
 *
 * Returns `null` when nothing has been ingested, which the callers translate
 * into "fall back to mock data" — never into an error.
 */
export function resolveActiveCustomerSlug(
  requestSlug?: string | null,
): string | null {
  const fromCookie = requestSlug && isKnownSlug(requestSlug) ? requestSlug : null;
  if (fromCookie) return fromCookie;

  const fromEnv = process.env.CUSTOMER_SLUG?.trim();
  if (fromEnv && isKnownSlug(fromEnv)) return fromEnv;

  const { lastIngestedSlug } = readRegistry();
  if (lastIngestedSlug && isKnownSlug(lastIngestedSlug)) return lastIngestedSlug;

  const slugs = listWorkspaceSlugs().filter(isKnownSlug);
  if (slugs.includes(LEGACY_WORKSPACE_SLUG)) return LEGACY_WORKSPACE_SLUG;
  return slugs[0] ?? null;
}

/**
 * Paths of the active customer.
 *
 * With nothing ingested it still returns a valid (empty) legacy workspace, so
 * callers can keep doing plain `existsSync` checks instead of null handling.
 */
export function activeCustomerPaths(
  requestSlug?: string | null,
): CustomerWorkspacePaths {
  return customerPaths(
    resolveActiveCustomerSlug(requestSlug) ?? LEGACY_WORKSPACE_SLUG,
  );
}
