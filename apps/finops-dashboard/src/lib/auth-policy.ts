import type { AppRole } from "@/lib/auth";

/**
 * Route authorization policy.
 *
 * The dashboard fails closed: any request that mutates state requires the Admin
 * role. Because several read-only features are implemented as POST (LLM calls
 * and query bodies that are too large for a query string), those endpoints are
 * listed explicitly. Anything not on the allowlist is treated as a write.
 */

/** Paths that stay anonymous. Must mirror `excludedPaths` in containerapp.bicep. */
export const ANONYMOUS_PATHS = ["/api/health"];

/**
 * Non-GET endpoints that do not mutate state: they run a query or an LLM
 * completion and return the result. Reader is enough.
 */
export const READ_ONLY_WRITE_METHOD_PATHS = [
  "/api/chat",
  "/api/multicloud/narrative",
  "/api/pricing/query",
  "/api/pricing/ri-compare",
  "/api/remediation-insight",
  "/api/simulator/estimate",
  "/api/stakeholder-cards/refine",
];

/**
 * GET endpoints that expose administrative detail and therefore need Admin even
 * though they are reads.
 */
export const ADMIN_ONLY_PATHS = ["/api/debug"];

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function matchesPath(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isAnonymousPath(pathname: string): boolean {
  return matchesPath(pathname, ANONYMOUS_PATHS);
}

/** The role required to perform `method` on `pathname`. */
export function requiredRoleForRequest(
  pathname: string,
  method: string,
): AppRole {
  if (matchesPath(pathname, ADMIN_ONLY_PATHS)) return "Admin";
  if (READ_METHODS.has(method.toUpperCase())) return "Reader";
  if (matchesPath(pathname, READ_ONLY_WRITE_METHOD_PATHS)) return "Reader";
  return "Admin";
}
