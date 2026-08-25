export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { executeQuery } from "@/lib/adx-client";
import { validateReadOnlyKql } from "@/lib/kql-guard";

/**
 * Local diagnostics only. This endpoint executes caller-supplied KQL, so it is
 * disabled outside development — the app is published with public ingress and
 * has no authentication layer in front of /api/*.
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  const q = request.nextUrl.searchParams.get("q") ?? "print hello='world'";

  const guard = validateReadOnlyKql(q);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: 400 });
  }

  const result = await executeQuery(q);
  return NextResponse.json({ rows: result.rows.slice(0, 30) });
}
