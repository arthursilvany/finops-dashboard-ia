export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { filterSchema } from "@/lib/filter-schema";
import { slugify } from "@/lib/customer-data/paths";
import { customerSlugFromCookieHeader } from "@/lib/customer-data/workspace";
import { buildStakeholderCardsPayload } from "@/lib/stakeholder";
import { renderStakeholderMarkdownBundle } from "@/lib/stakeholder/markdown";

/**
 * Markdown package: one block per persona, plus the README.
 *
 * This is the shareable surface: an artifact that opens offline from an email
 * attachment on a customer's machine without internet access.
 */
export async function GET(request: NextRequest) {
  const filters = filterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  const scope = request.nextUrl.searchParams.get("scope");

  const { payload } = buildStakeholderCardsPayload(filters, {
    scope,
    customerSlug: customerSlugFromCookieHeader(request.headers.get("cookie")),
  });
  const bundle = renderStakeholderMarkdownBundle(payload);
  const fileName = payload.customerName
    ? `stakeholder-cards-${slugify(payload.customerName) ?? "customer"}.md`
    : "stakeholder-cards-demo.md";

  return new NextResponse(bundle, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
