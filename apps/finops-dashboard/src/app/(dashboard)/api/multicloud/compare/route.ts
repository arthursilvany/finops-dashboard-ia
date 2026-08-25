export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { filterSchema } from "@/lib/filter-schema";
import {
  buildMulticloudComparisonPayload,
  multicloudRequestSchema,
  weightsFrom,
} from "@/lib/multicloud";
import { customerSlugFromCookieHeader } from "@/lib/customer-data/workspace";
import type { MulticloudFacts } from "@/lib/multicloud/types";
import type { ApiResponse } from "@/lib/types";

export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const filters = filterSchema.parse(params);
  const weights = weightsFrom(multicloudRequestSchema.parse(params));

  const { facts, metadata } = await buildMulticloudComparisonPayload(
    filters,
    weights,
    customerSlugFromCookieHeader(request.headers.get("cookie")),
  );

  return NextResponse.json({
    data: facts,
    metadata,
  } satisfies ApiResponse<MulticloudFacts>);
}
