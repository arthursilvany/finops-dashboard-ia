export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

import { filterSchema } from "@/lib/filter-schema";
import {
  buildMulticloudComparisonPayload,
  multicloudRequestSchema,
  weightsFrom,
} from "@/lib/multicloud";
import { customerSlugFromCookieHeader } from "@/lib/customer-data/workspace";
import { renderMulticloudMarkdown } from "@/lib/multicloud/markdown";

/**
 * Markdown export.
 *
 * Served as `text/markdown` rather than as a download so it can be copied
 * straight out of the browser, and rebuilt from the same resolver as the
 * matrix so the two can never drift.
 */
export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const filters = filterSchema.parse(params);
  const weights = weightsFrom(multicloudRequestSchema.parse(params));

  const { facts, metadata } = await buildMulticloudComparisonPayload(
    filters,
    weights,
    customerSlugFromCookieHeader(request.headers.get("cookie")),
  );

  const markdown = renderMulticloudMarkdown(facts, {
    customerName: metadata.customerName,
  });

  return new NextResponse(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
