import { NextResponse } from "next/server";

import {
  CUSTOMER_COOKIE,
  listCustomerWorkspaces,
} from "@/lib/customer-data/workspace";

export const dynamic = "force-dynamic";

/**
 * Switches the customer shown in this browser.
 *
 * The slug becomes a filesystem path downstream, so it is never trusted: only a
 * slug that already appears in the workspace listing is accepted. That check
 * also rules out traversal attempts without needing to reason about encoding.
 */
export async function POST(request: Request) {
  let slug: unknown;
  try {
    ({ slug } = (await request.json()) as { slug?: unknown });
  } catch {
    return NextResponse.json(
      { error: 'Invalid body: send { "slug": "<customer>" }.' },
      { status: 400 },
    );
  }

  if (typeof slug !== "string" || slug.length === 0) {
    return NextResponse.json(
      { error: "Provide the customer slug." },
      { status: 400 },
    );
  }

  const known = listCustomerWorkspaces().some(
    (workspace) => workspace.slug === slug && workspace.hasDataset,
  );
  if (!known) {
    return NextResponse.json(
      { error: `Customer "${slug}" was not found or has not been ingested yet.` },
      { status: 404 },
    );
  }

  const response = NextResponse.json({ data: { active: slug } });
  response.cookies.set(CUSTOMER_COOKIE, slug, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    // The POC is local-only and the value is a folder name, not a credential.
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
