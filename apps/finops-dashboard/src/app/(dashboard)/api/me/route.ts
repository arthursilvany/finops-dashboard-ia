export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getPrincipal, isAuthEnforced } from "@/lib/auth";

/**
 * Current caller identity.
 *
 * Preferred over the platform's own `/.auth/me` endpoint because it behaves the
 * same in local development (where it returns the synthetic Local Dev
 * principal), so the UI needs no environment-specific branch.
 */
export async function GET() {
  const principal = getPrincipal(await headers());

  if (!principal) {
    return NextResponse.json(
      { ok: false, error: "Authentication required" },
      { status: 401 },
    );
  }

  return NextResponse.json({
    ok: true,
    data: {
      id: principal.id,
      name: principal.name,
      email: principal.email,
      roles: principal.roles,
      source: principal.source,
      authEnforced: isAuthEnforced(),
    },
    metadata: { queriedAt: new Date().toISOString() },
  });
}
