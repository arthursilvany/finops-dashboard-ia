import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  CLIENT_PRINCIPAL_HEADER,
  hasRole,
  isAuthEnforced,
  parseClientPrincipal,
} from "@/lib/auth";
import { isAnonymousPath, requiredRoleForRequest } from "@/lib/auth-policy";

/**
 * Defense in depth for the public ingress.
 *
 * Easy Auth already blocks anonymous traffic at the platform level. This
 * middleware re-validates the resulting principal inside the app so that a
 * misconfigured ingress, a direct call to the container, or an infra regression
 * cannot expose cost data or the remediation endpoints. It is also where
 * Reader/Admin authorization is applied.
 */

const LOGIN_PATH = "/.auth/login/aad";
const FORBIDDEN_PATH = "/forbidden";

function isApiRequest(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function redirectToLogin(request: NextRequest): NextResponse {
  const loginUrl = new URL(LOGIN_PATH, request.url);
  loginUrl.searchParams.set(
    "post_login_redirect_uri",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.redirect(loginUrl);
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isAnonymousPath(pathname) || pathname === FORBIDDEN_PATH) {
    return NextResponse.next();
  }

  // Local development and any deployment without the platform auth layer: the
  // client principal header cannot be trusted, so it is never read.
  if (!isAuthEnforced()) {
    return NextResponse.next();
  }

  const principal = parseClientPrincipal(
    request.headers.get(CLIENT_PRINCIPAL_HEADER),
  );

  if (!principal) {
    return isApiRequest(pathname)
      ? jsonError("Authentication required", 401)
      : redirectToLogin(request);
  }

  const requiredRole = requiredRoleForRequest(pathname, request.method);

  if (!hasRole(principal, requiredRole)) {
    console.warn(
      JSON.stringify({
        event: "authz.denied",
        userId: principal.id,
        path: pathname,
        method: request.method,
        requiredRole,
        grantedRoles: principal.roles,
      }),
    );

    if (isApiRequest(pathname)) {
      return jsonError(
        `Access denied: the ${requiredRole} role is required`,
        403,
      );
    }

    const forbiddenUrl = new URL(FORBIDDEN_PATH, request.url);
    forbiddenUrl.searchParams.set("required", requiredRole);
    return NextResponse.redirect(forbiddenUrl);
  }

  // Route handlers re-derive the principal from the platform header. Nothing is
  // forwarded in an internal header: such a header would not be stripped by
  // Easy Auth and would therefore be attacker-controlled.
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Everything except Next.js internals and the Easy Auth endpoints
     * (/.auth/*), which must stay reachable to complete the login.
     *
     * The static-extension exclusion deliberately does NOT apply to /api/*:
     * an unanchored extension rule would make any API path ending in .txt,
     * .xml, .svg… skip the middleware entirely, so a future dynamic or
     * catch-all route would silently become anonymous.
     */
    "/((?!_next/static|_next/image|favicon.ico|\\.auth|(?!api/).*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|webmanifest)$).*)",
  ],
};
