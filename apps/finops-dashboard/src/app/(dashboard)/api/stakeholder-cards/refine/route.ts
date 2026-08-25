export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { filterSchema } from "@/lib/filter-schema";
import { buildStakeholderCardsPayload } from "@/lib/stakeholder";
import { customerSlugFromCookieHeader } from "@/lib/customer-data/workspace";
import { refineStakeholderCards } from "@/lib/stakeholder/narrative";

/**
 * AI refinement for the three prose fields. It uses POST because it has a cost
 * and effect, so SWR automatic revalidation must not trigger it.
 *
 * If the call fails, the client keeps the deterministic card, which is already
 * shareable. AI is optional by design.
 */
export async function POST(request: NextRequest) {
  const filters = filterSchema.parse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  const scope = request.nextUrl.searchParams.get("scope");

  const { payload, facts } = buildStakeholderCardsPayload(filters, {
    scope,
    customerSlug: customerSlugFromCookieHeader(request.headers.get("cookie")),
  });

  try {
    const refined = await refineStakeholderCards(payload);
    return NextResponse.json({
      data: refined,
      metadata: {
        queriedAt: new Date().toISOString(),
        isMock: facts.dataSource === "mock",
        dataSource: facts.dataSource,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 502 },
    );
  }
}
