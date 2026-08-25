import { NextResponse } from "next/server";

import {
  CUSTOMER_COOKIE,
  customerSlugFromCookieHeader,
  listCustomerWorkspaces,
  resolveActiveCustomerSlug,
} from "@/lib/customer-data/workspace";

export const dynamic = "force-dynamic";

/**
 * Customer workspaces available on this machine, and which one is active.
 *
 * The POC runs on a consultant's laptop with several customers collected over
 * time, so the dashboard needs to name them before it can switch between them.
 */
export async function GET(request: Request) {
  const workspaces = listCustomerWorkspaces();
  const active = resolveActiveCustomerSlug(
    customerSlugFromCookieHeader(request.headers.get("cookie")),
  );

  return NextResponse.json({
    data: {
      active,
      cookieName: CUSTOMER_COOKIE,
      customers: workspaces.map((workspace) => ({
        ...workspace,
        isActive: workspace.slug === active,
      })),
    },
  });
}
