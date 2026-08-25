/**
 * Authentication and authorization layer tests.
 *
 * Run: `npm run auth:test`
 *
 * None of these tests starts the server: they validate the parser for the
 * Easy Auth-injected header and the authorization matrix by route and method,
 * which decides whether a write request is permitted.
 */
import {
  getPrincipal,
  hasRole,
  isAuthEnforced,
  normalizeRoles,
  parseClientPrincipal,
  CLIENT_PRINCIPAL_HEADER,
} from "../src/lib/auth";
import {
  isAnonymousPath,
  requiredRoleForRequest,
} from "../src/lib/auth-policy";

let failures = 0;
let passes = 0;

function check(name: string, assertion: () => void) {
  try {
    assertion();
    passes += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ ${name}`);
    console.error(`      ${(error as Error).message}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function encodePrincipal(claims: { typ: string; val: string }[]): string {
  return Buffer.from(
    JSON.stringify({
      auth_typ: "aad",
      name_typ:
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
      role_typ:
        "http://schemas.microsoft.com/ws/2008/06/identity/claims/role",
      claims,
    }),
    "utf-8",
  ).toString("base64");
}

const OID = "http://schemas.microsoft.com/identity/claims/objectidentifier";
const NAME = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name";
const ROLE = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";

function headersWith(value: string | null) {
  const headers = new Headers();
  if (value) headers.set(CLIENT_PRINCIPAL_HEADER, value);
  return headers;
}

function withEnv(
  env: Record<string, string | undefined>,
  fn: () => void,
): void {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

console.log("\n== X-MS-CLIENT-PRINCIPAL parser ==");

check("decodes a valid principal with the Admin role", () => {
  const principal = parseClientPrincipal(
    encodePrincipal([
      { typ: OID, val: "11111111-2222-3333-4444-555555555555" },
      { typ: NAME, val: "Ada Lovelace" },
      { typ: "preferred_username", val: "ada@contoso.com" },
      { typ: ROLE, val: "FinOps.Admin" },
    ]),
  );

  assert(principal !== null, "principal should not be null");
  assert(
    principal!.id === "11111111-2222-3333-4444-555555555555",
    "OID was not extracted",
  );
  assert(principal!.name === "Ada Lovelace", "name was not extracted");
  assert(principal!.email === "ada@contoso.com", "email was not extracted");
  assert(principal!.roles.includes("Admin"), "Admin role is missing");
  assert(
    principal!.roles.includes("Reader"),
    "Admin must imply Reader",
  );
});

check("a missing header is anonymous", () => {
  assert(parseClientPrincipal(null) === null, "null should be anonymous");
  assert(parseClientPrincipal("") === null, "empty should be anonymous");
});

check("invalid base64 is anonymous, not an exception", () => {
  assert(
    parseClientPrincipal("!!!invalid-base64!!!") === null,
    "invalid base64 should return null",
  );
});

check("valid JSON without claims is anonymous", () => {
  const encoded = Buffer.from(JSON.stringify({ auth_typ: "aad" })).toString(
    "base64",
  );
  assert(parseClientPrincipal(encoded) === null, "without claims it should be null");
});

check("a principal without an OID is rejected (not auditable)", () => {
  const encoded = encodePrincipal([
    { typ: NAME, val: "Sem Oid" },
    { typ: ROLE, val: "FinOps.Reader" },
  ]);
  assert(parseClientPrincipal(encoded) === null, "without an OID it should be null");
});

console.log("\n== Roles ==");

check("maps Entra app role values", () => {
  assert(
    normalizeRoles(["FinOps.Reader"]).includes("Reader"),
    "FinOps.Reader should become Reader",
  );
  assert(
    normalizeRoles(["finops.admin"]).includes("Admin"),
    "comparison must be case-insensitive",
  );
});

check("unknown roles are discarded", () => {
  assert(
    normalizeRoles(["Global.Administrator", "Owner"]).length === 0,
    "roles outside the contract cannot grant access",
  );
});

check("a user without a role receives no access by default", () => {
  withEnv({ AUTH_ENABLED: "true", AUTH_DEFAULT_ROLE: "none" }, () => {
    const principal = parseClientPrincipal(
      encodePrincipal([
        { typ: OID, val: "abc" },
        { typ: NAME, val: "No Role" },
      ]),
    );
    assert(principal !== null, "principal should exist");
    assert(principal!.roles.length === 0, "should not receive any role");
    assert(!hasRole(principal, "Reader"), "should not pass as Reader");
  });
});

check("AUTH_DEFAULT_ROLE=Reader grants read access to a user without a role", () => {
  withEnv({ AUTH_ENABLED: "true", AUTH_DEFAULT_ROLE: "Reader" }, () => {
    const principal = parseClientPrincipal(
      encodePrincipal([
        { typ: OID, val: "abc" },
        { typ: NAME, val: "No Role" },
      ]),
    );
    assert(hasRole(principal, "Reader"), "should receive Reader");
    assert(!hasRole(principal, "Admin"), "should not receive Admin");
  });
});

console.log("\n== Development enforcement and bypass ==");

check("without AUTH_ENABLED, auth is not enforced", () => {
  withEnv({ AUTH_ENABLED: undefined }, () => {
    assert(!isAuthEnforced(), "should not be enforced");
  });
});

check("in development, the synthetic principal is Admin", () => {
  withEnv({ AUTH_ENABLED: undefined }, () => {
    const principal = getPrincipal(headersWith(null));
    assert(principal !== null, "development should have a principal");
    assert(principal!.source === "local-dev", "source should be local-dev");
    assert(hasRole(principal, "Admin"), "development should be Admin");
  });
});

check("with auth enforced and no header, the result is anonymous", () => {
  withEnv({ AUTH_ENABLED: "true" }, () => {
    assert(
      getPrincipal(headersWith(null)) === null,
      "without a header it should be anonymous",
    );
  });
});

check("a forged header is not read when auth is not enforced", () => {
  withEnv({ AUTH_ENABLED: "false" }, () => {
    const forged = encodePrincipal([
      { typ: OID, val: "attacker" },
      { typ: ROLE, val: "FinOps.Admin" },
    ]);
    const principal = getPrincipal(headersWith(forged));
    assert(
      principal!.source === "local-dev",
      "without enforcement the header must never be trusted",
    );
  });
});

console.log("\n== Authorization matrix by route ==");

check("/api/health is anonymous", () => {
  assert(isAnonymousPath("/api/health"), "health must remain anonymous");
  assert(
    !isAnonymousPath("/api/cost-summary/kpi"),
    "data routes cannot be anonymous",
  );
});

check("GET requires only Reader", () => {
  assert(
    requiredRoleForRequest("/api/cost-summary/kpi", "GET") === "Reader",
    "data GET should require Reader",
  );
});

check("an uncataloged write requires Admin (fail closed)", () => {
  assert(
    requiredRoleForRequest("/api/route/that/does/not/exist", "POST") === "Admin",
    "unknown POST should require Admin",
  );
  assert(
    requiredRoleForRequest("/api/config/save", "POST") === "Admin",
    "config/save should require Admin",
  );
  assert(
    requiredRoleForRequest("/api/remediation/execute", "POST") === "Admin",
    "remediation/execute should require Admin",
  );
  assert(
    requiredRoleForRequest("/api/pricing/upload", "POST") === "Admin",
    "pricing/upload should require Admin",
  );
  assert(
    requiredRoleForRequest("/api/cost-summary/kpi", "DELETE") === "Admin",
    "DELETE should require Admin",
  );
});

check("read-only POSTs in the allowlist require only Reader", () => {
  for (const path of [
    "/api/chat",
    "/api/pricing/query",
    "/api/simulator/estimate",
    "/api/stakeholder-cards/refine",
    "/api/multicloud/narrative",
    "/api/remediation-insight",
    "/api/pricing/ri-compare",
  ]) {
    assert(
      requiredRoleForRequest(path, "POST") === "Reader",
      `${path} should require only Reader`,
    );
  }
});

check("/api/debug requires Admin even for GET", () => {
  assert(
    requiredRoleForRequest("/api/debug", "GET") === "Admin",
    "debug exposes configuration and should require Admin",
  );
});

check("a prefix does not leak to similarly named routes", () => {
  assert(
    requiredRoleForRequest("/api/chat-admin-backdoor", "POST") === "Admin",
    "a prefix match cannot be partial",
  );
});

console.log(
  `\n${failures === 0 ? "✓" : "✗"} auth: ${passes} passed, ${failures} failed\n`,
);

process.exit(failures === 0 ? 0 : 1);
