export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { loadReport } from "@/lib/daily-insights-store";
import { isMockMode } from "@/lib/adx-client";
import { getCustomerDatasetForRequest } from "@/lib/customer-dataset";
import {
  customerSlugFromCookieHeader,
  resolveActiveCustomerSlug,
} from "@/lib/customer-data/workspace";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ date: string }> },
) {
  const { date } = await params;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(date)) {
    return NextResponse.json(
      { error: "Invalid date format. Use YYYY-MM-DD." },
      { status: 400 },
    );
  }

  const requestSlug = customerSlugFromCookieHeader(
    request.headers.get("cookie"),
  );
  const customerSlug =
    isMockMode() && getCustomerDatasetForRequest(request)
      ? resolveActiveCustomerSlug(requestSlug)
      : undefined;
  const report = await loadReport(date, customerSlug);
  if (!report) {
    return NextResponse.json(
      { error: "No report found for this date." },
      { status: 404 },
    );
  }

  return NextResponse.json({ report });
}
