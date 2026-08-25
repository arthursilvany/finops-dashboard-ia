export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { listReports } from "@/lib/daily-insights-store";
import { isMockMode } from "@/lib/adx-client";
import { getCustomerDatasetForRequest } from "@/lib/customer-dataset";
import {
  customerSlugFromCookieHeader,
  resolveActiveCustomerSlug,
} from "@/lib/customer-data/workspace";

export async function GET(request: Request) {
  const requestSlug = customerSlugFromCookieHeader(
    request.headers.get("cookie"),
  );
  const customerSlug =
    isMockMode() && getCustomerDatasetForRequest(request)
      ? resolveActiveCustomerSlug(requestSlug)
      : undefined;
  const reports = await listReports(customerSlug);
  return NextResponse.json({
    data: reports.map((r) => ({
      date: r.date,
      generatedAt: r.generatedAt,
      preview: r.content.slice(0, 200) + "...",
    })),
    metadata: { total: reports.length },
  });
}
