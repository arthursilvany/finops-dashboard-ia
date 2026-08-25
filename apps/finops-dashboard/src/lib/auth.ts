/**
 * Identity and authorization primitives for the FinOps Dashboard.
 *
 * The dashboard runs behind Azure Container Apps built-in authentication
 * ("Easy Auth") with Microsoft Entra ID. When Easy Auth is active the platform
 * validates the token, strips any inbound `x-ms-client-principal-*` headers
 * coming from the client, and injects its own `X-MS-CLIENT-PRINCIPAL` header
 * with the validated claims.
 *
 * That last point is the whole trust contract: the header is only meaningful
 * when the platform is actually validating it. `AUTH_ENABLED` is injected by
 * the Bicep template from the very same boolean that provisions the Container
 * App `authConfigs` resource, so "app trusts the header" and "platform
 * validates the header" cannot drift apart.
 */

export const CLIENT_PRINCIPAL_HEADER = "x-ms-client-principal";

export type AppRole = "Reader" | "Admin";

export type PrincipalSource = "easy-auth" | "local-dev";

export interface Principal {
  /** Entra ID object id (oid). Stable per user per tenant. */
  id: string;
  name: string;
  email: string;
  roles: AppRole[];
  source: PrincipalSource;
}

interface ClientPrincipalClaim {
  typ?: string;
  val?: string;
}

interface ClientPrincipal {
  auth_typ?: string;
  name_typ?: string;
  role_typ?: string;
  claims?: ClientPrincipalClaim[];
}

/** Entra ID app roles exposed by the app registration, mapped to internal roles. */
const APP_ROLE_BY_CLAIM_VALUE: Record<string, AppRole> = {
  "finops.admin": "Admin",
  "finops.reader": "Reader",
  // Tolerate the shorter role values some tenants use.
  admin: "Admin",
  reader: "Reader",
};

const OID_CLAIM =
  "http://schemas.microsoft.com/identity/claims/objectidentifier";
const NAME_CLAIM = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name";
const EMAIL_CLAIM =
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress";
const ROLE_CLAIM = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";

const LOCAL_DEV_PRINCIPAL: Principal = {
  id: "local-dev",
  name: "Local Dev",
  email: "local-dev@localhost",
  roles: ["Admin", "Reader"],
  source: "local-dev",
};

/**
 * True when the platform auth layer is active and the client principal header
 * can be trusted. Driven exclusively by AUTH_ENABLED, which the Bicep template
 * derives from `enableEasyAuth` — never set it by hand in production.
 */
export function isAuthEnforced(): boolean {
  return (process.env.AUTH_ENABLED ?? "").trim().toLowerCase() === "true";
}

/** Role granted to a signed-in user with no app role assigned. */
export function getDefaultRoles(): AppRole[] {
  return process.env.AUTH_DEFAULT_ROLE === "Reader" ? ["Reader"] : [];
}

function decodeBase64(value: string): string | null {
  try {
    // Buffer exists in the Node runtime; atob covers the Edge runtime used by
    // Next.js middleware.
    if (typeof atob === "function") {
      const binary = atob(value);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder("utf-8").decode(bytes);
    }
    return Buffer.from(value, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

function findClaims(
  claims: ClientPrincipalClaim[],
  ...types: string[]
): string[] {
  const wanted = new Set(types.map((type) => type.toLowerCase()));
  return claims
    .filter((claim) => claim.typ && wanted.has(claim.typ.toLowerCase()))
    .map((claim) => claim.val ?? "")
    .filter((val) => val.length > 0);
}

/**
 * Normalizes the raw Entra role claims into the two roles the dashboard knows
 * about. Admin implies Reader — a single membership check covers both.
 */
export function normalizeRoles(rawRoles: string[]): AppRole[] {
  const roles: AppRole[] = [];
  for (const raw of rawRoles) {
    const mapped = APP_ROLE_BY_CLAIM_VALUE[raw.trim().toLowerCase()];
    if (mapped && !roles.includes(mapped)) roles.push(mapped);
  }
  if (roles.includes("Admin") && !roles.includes("Reader")) {
    roles.push("Reader");
  }
  return roles;
}

/**
 * Parses the base64-encoded `X-MS-CLIENT-PRINCIPAL` header injected by Easy Auth.
 * Returns null for anything malformed — callers must treat that as anonymous.
 */
export function parseClientPrincipal(
  headerValue: string | null | undefined,
): Principal | null {
  if (!headerValue) return null;

  const decoded = decodeBase64(headerValue);
  if (!decoded) return null;

  let parsed: ClientPrincipal;
  try {
    parsed = JSON.parse(decoded) as ClientPrincipal;
  } catch {
    return null;
  }

  const claims = Array.isArray(parsed?.claims) ? parsed.claims : [];
  if (claims.length === 0) return null;

  const roleType = parsed.role_typ ?? ROLE_CLAIM;
  const nameType = parsed.name_typ ?? NAME_CLAIM;

  const id = findClaims(claims, OID_CLAIM, "oid", "sub")[0] ?? "";
  const email =
    findClaims(claims, EMAIL_CLAIM, "preferred_username", "email", "emails")[0] ??
    "";
  const name = findClaims(claims, nameType, NAME_CLAIM, "name")[0] ?? email;
  const roles = normalizeRoles(findClaims(claims, roleType, ROLE_CLAIM, "roles"));

  // Without a stable subject we cannot audit the caller, so refuse the token.
  if (!id) return null;

  return {
    id,
    name: name || id,
    email,
    roles: roles.length > 0 ? roles : getDefaultRoles(),
    source: "easy-auth",
  };
}

type HeaderLike = { get(name: string): string | null };

/**
 * Resolves the caller identity.
 *
 * - Auth enforced: derived exclusively from the platform header. The principal
 *   is deliberately re-derived on every call instead of being cached in an
 *   internal request header: Easy Auth only strips inbound
 *   `x-ms-client-principal-*`, so any other header would be attacker-controlled
 *   and would become a privilege escalation the moment a route escaped the
 *   middleware matcher.
 * - Auth not enforced (local dev): a synthetic Admin principal, so the whole
 *   dashboard stays usable with `npm run dev` without an Entra tenant.
 */
export function getPrincipal(headers: HeaderLike): Principal | null {
  if (!isAuthEnforced()) return LOCAL_DEV_PRINCIPAL;

  return parseClientPrincipal(headers.get(CLIENT_PRINCIPAL_HEADER));
}

export function hasRole(principal: Principal | null, role: AppRole): boolean {
  return principal != null && principal.roles.includes(role);
}

/**
 * Guard for use inside a route handler when a specific action needs a stronger
 * role than the middleware enforces for the route as a whole.
 * Returns null when the caller is authorized.
 */
export function requireRole(
  request: Request,
  role: AppRole,
): { principal: Principal } | { response: Response } {
  const principal = getPrincipal(request.headers);

  if (!principal) {
    return {
      response: Response.json(
        { ok: false, error: "Authentication required" },
        { status: 401 },
      ),
    };
  }

  if (!hasRole(principal, role)) {
    return {
      response: Response.json(
        { ok: false, error: `Requires the ${role} role` },
        { status: 403 },
      ),
    };
  }

  return { principal };
}
