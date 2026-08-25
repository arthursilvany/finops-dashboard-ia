export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { filterSchema } from "@/lib/filter-schema";
import { buildStakeholderCardsPayload } from "@/lib/stakeholder";
import { customerSlugFromCookieHeader } from "@/lib/customer-data/workspace";
import type { ApiResponse } from "@/lib/types";
import type { StakeholderCardsPayload } from "@/lib/stakeholder";

/**
 * One verified set of facts, viewed through five decision-making lenses.
 *
 * The route never calculates: it delegates to the existing aggregators through
 * `buildStakeholderCardsPayload`. If a card disagrees with its corresponding
 * dashboard page, it is a bug — not an opinion.
 */
export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const filters = filterSchema.parse(params);
  const scope = request.nextUrl.searchParams.get("scope");

  const { payload, facts } = buildStakeholderCardsPayload(filters, {
    scope,
    customerSlug: customerSlugFromCookieHeader(request.headers.get("cookie")),
  });

  return NextResponse.json({
    data: payload,
    metadata: {
      queriedAt: payload.generatedAtUtc,
      isMock: facts.dataSource === "mock",
      dataSource: facts.dataSource,
      ...(facts.customerName ? { customerName: facts.customerName } : {}),
    },
  } satisfies ApiResponse<StakeholderCardsPayload>);
}
