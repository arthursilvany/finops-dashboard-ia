import path from "node:path";

/**
 * Filesystem layout for the customer POC datasets.
 *
 * The Next.js app lives in `apps/finops-dashboard/` while the data folders sit
 * at the repository root, so paths are resolved relative to `process.cwd()`
 * with a fallback that also works when the app is started from the repo root.
 *
 * Input and output are separate trees, one folder per customer in each:
 *
 *   input/customer/<slug>/   raw export + evidence dropped by the collector
 *   output/customer/<slug>/  normalized dataset written by the ingest
 *
 * Keeping them apart means the output tree can be wiped and rebuilt without
 * risking the collected evidence, which is the expensive half to reproduce.
 *
 * The input root itself is also a valid workspace (`LEGACY_WORKSPACE_SLUG`),
 * and its dataset stays at `input/customer/.processed/` where it was written,
 * so a pre-workspace collection keeps working without a re-ingest.
 *
 * This module stays free of any "which customer is active" logic: resolving the
 * active slug needs the registry, and the registry needs these paths. See
 * `workspace.ts` for the resolution side.
 */

function resolveRepoRelative(...segments: string[]): string {
  const cwd = process.cwd();
  // Started from apps/finops-dashboard (the normal case).
  if (path.basename(cwd) === "finops-dashboard") {
    return path.resolve(cwd, "..", "..", ...segments);
  }
  return path.resolve(cwd, ...segments);
}

function resolveRootDir(): string {
  const override = process.env.CUSTOMER_DATA_DIR;
  if (override) return path.resolve(override);
  return resolveRepoRelative("input", "customer");
}

/**
 * Where the ingest writes.
 *
 * `CUSTOMER_OUTPUT_DIR` wins. Otherwise a scratch `CUSTOMER_DATA_DIR` keeps its
 * output inside itself: tests and `--dir` runs point a single variable at a
 * temp folder and expect everything, input and output, to be removable with one
 * `rm -rf`. Only the default installation splits the two trees.
 */
function resolveOutputRootDir(): string {
  const override = process.env.CUSTOMER_OUTPUT_DIR;
  if (override) return path.resolve(override);

  const dataDir = process.env.CUSTOMER_DATA_DIR;
  if (dataDir) return path.join(path.resolve(dataDir), ".output");

  return resolveRepoRelative("output", "customer");
}

/**
 * Sentinel for the pre-workspace layout, where the export and `.processed/`
 * sit directly in the input root. It is deliberately not a legal slug, so it
 * can never collide with a real customer folder.
 */
export const LEGACY_WORKSPACE_SLUG = "__root__";

/** Registry of known workspaces. Lives in the output root, next to the data. */
export const REGISTRY_FILE_NAME = "registry.json";

/**
 * Root folder holding every customer's raw exports.
 *
 * Resolved per call rather than captured at import time: tests set
 * `CUSTOMER_DATA_DIR` after importing the module under test, and a frozen
 * constant would silently point at the developer's real customer folder.
 */
export function customerRootDir(): string {
  return resolveRootDir();
}

/** Root folder holding every customer's processed dataset. */
export function customerOutputRootDir(): string {
  return resolveOutputRootDir();
}

export function registryFile(): string {
  return path.join(customerOutputRootDir(), REGISTRY_FILE_NAME);
}

/**
 * Where the registry lived before input and output were split.
 *
 * Read-only fallback: it keeps display names and the last selection after an
 * upgrade, and is never written to again.
 */
export function legacyRegistryFile(): string {
  return path.join(customerRootDir(), REGISTRY_FILE_NAME);
}

/**
 * A slug becomes a path segment, so it is validated before any `path.join`.
 * Lowercase alphanumerics and single dashes only: no dots, no separators, no
 * absolute paths, nothing that could climb out of the root.
 */
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}

/**
 * Folder names accepted as an existing workspace.
 *
 * Looser than `isValidSlug` on purpose: folders collected before this feature
 * existed carry the customer's name verbatim (`Contoso`, `fabrikam-br`), and
 * refusing to read them would mean asking people to rename their data. New
 * folders are still created from `slugify`, so this only ever widens *reading*.
 *
 * It stays strict about everything that matters for safety: a single path
 * segment, no separators, no leading dot, and no `..`.
 */
const SAFE_FOLDER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isSafeWorkspaceName(value: string): boolean {
  return SAFE_FOLDER_PATTERN.test(value) && !value.includes("..");
}

/**
 * Derives a folder-safe slug from a customer display name.
 *
 * Returns `null` when nothing usable survives normalization (a name made only
 * of punctuation, say). Callers must treat that as an error rather than
 * inventing a fallback folder, otherwise two unnamed customers would collide.
 */
export function slugify(name: string): string | null {
  const slug = name
    .normalize("NFD")
    // Strip diacritics so "Ação" and "Acao" land in the same folder.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");

  return slug.length > 0 && isValidSlug(slug) ? slug : null;
}

/** Folder holding a workspace's raw input files. */
export function customerDir(slug: string): string {
  const root = customerRootDir();
  if (slug === LEGACY_WORKSPACE_SLUG) return root;
  assertSafeSlug(slug);
  return path.join(root, slug);
}

/**
 * Folder holding a workspace's normalized dataset.
 *
 * The legacy workspace keeps its dataset inside the input root, where the
 * pre-split ingest wrote it: moving it would break an existing collection for
 * no gain, since there is exactly one of them.
 */
export function processedDir(slug: string): string {
  if (slug === LEGACY_WORKSPACE_SLUG) {
    return path.join(customerRootDir(), ".processed");
  }
  assertSafeSlug(slug);
  return path.join(customerOutputRootDir(), slug);
}

function assertSafeSlug(slug: string): void {
  if (!isSafeWorkspaceName(slug)) {
    throw new Error(
      `Invalid customer folder "${slug}". Expected a single folder name without separators.`,
    );
  }
}

export interface CustomerWorkspacePaths {
  slug: string;
  dir: string;
  processed: string;
  rows: string;
  manifest: string;
  collectionManifest: string;
  narrative: string;
  narrativeStatus: string;
  resourceGraph: string;
  advisor: string;
  policy: string;
  security: string;
  health: string;
  patch: string;
  operations: string;
  metrics: string;
  budgets: string;
  commitments: string;
  /** Normalized Azure SKU Advisor export, written into the processed folder. */
  skuAdvisor: string;
  /** Raw `recommendations.json` dropped next to the collected evidence. */
  skuAdvisorInput: string;
}

/** Every file the dashboard reads or the ingest writes, for one workspace. */
export function customerPaths(slug: string): CustomerWorkspacePaths {
  const dir = customerDir(slug);
  const processed = processedDir(slug);
  const inProcessed = (file: string) => path.join(processed, file);

  return {
    slug,
    dir,
    processed,
    rows: inProcessed("rows.ndjson"),
    manifest: inProcessed("manifest.json"),
    collectionManifest: path.join(dir, "collection-manifest.json"),
    narrative: inProcessed("narrative.json"),
    narrativeStatus: inProcessed("narrative-status.json"),
    resourceGraph: inProcessed("resource-graph.json"),
    advisor: inProcessed("advisor.json"),
    policy: inProcessed("policy.json"),
    security: inProcessed("security.json"),
    health: inProcessed("health.json"),
    patch: inProcessed("patch.json"),
    operations: inProcessed("operations.json"),
    metrics: inProcessed("metrics.json"),
    budgets: inProcessed("budgets.json"),
    commitments: inProcessed("commitments.json"),
    skuAdvisor: inProcessed("sku-advisor.json"),
    skuAdvisorInput: path.join(dir, "sku-advisor", "recommendations.json"),
  };
}
