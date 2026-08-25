export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { filterSchema } from "@/lib/filter-schema";
import {
  buildMulticloudComparisonPayload,
  multicloudRequestSchema,
  weightsFrom,
} from "@/lib/multicloud";
import { customerSlugFromCookieHeader } from "@/lib/customer-data/workspace";
import type { MulticloudNarrative } from "@/lib/multicloud/contract";
import { buildNarrative } from "@/lib/multicloud/narrative";
import type { ApiResponse } from "@/lib/types";

export interface NarrativeResponseBody {
  narrative: MulticloudNarrative | null;
  /** Populated when no narrative was served. Rendered verbatim by the UI. */
  suppressedReason: string | null;
}

/**
 * Optional AI narrative over the deterministic comparison.
 *
 * POST, not GET, because it costs tokens: a refresh, a prefetch or a back
 * button should never silently spend money. The facts are rebuilt server-side
 * from the same resolver rather than accepted from the client, so a caller
 * cannot hand the model a doctored set of numbers to narrate.
 */
export async function POST(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const filters = filterSchema.parse(params);
  const weights = weightsFrom(multicloudRequestSchema.parse(params));

  const { facts, metadata } = await buildMulticloudComparisonPayload(
    filters,
    weights,
    customerSlugFromCookieHeader(request.headers.get("cookie")),
  );

  const result = await buildNarrative(facts);

  if (result.violations.length > 0) {
    // Logged, not returned: the violation detail quotes the model's own
    // fabricated figures, and echoing them into the UI would put unvalidated
    // numbers on screen through the very channel meant to keep them off it.
    console.warn(
      "[multicloud] narrative rejected:",
      result.violations.map((v) => `${v.rule}: ${v.detail}`).join(" | "),
    );
  }

  return NextResponse.json({
    data: {
      narrative: result.narrative,
      suppressedReason: result.suppressedReason,
    },
    metadata,
  } satisfies ApiResponse<NarrativeResponseBody>);
}
