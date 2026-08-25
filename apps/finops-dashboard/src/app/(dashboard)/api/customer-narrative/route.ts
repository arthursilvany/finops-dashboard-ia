export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { isMockMode } from "@/lib/adx-client";
import { getCustomerDataset } from "@/lib/customer-dataset";
import { customerSlugFromCookieHeader } from "@/lib/customer-data/workspace";
import { loadCustomerNarrative } from "@/lib/customer-narrative-store";
import type { ApiResponse } from "@/lib/types";

export async function GET(request: Request) {
  const customerSlug = customerSlugFromCookieHeader(
    request.headers.get("cookie"),
  );
  const dataset = isMockMode()
    ? getCustomerDataset(customerSlug ?? undefined)
    : null;
  if (!dataset) {
    return NextResponse.json({
      data: null,
      metadata: {
        queriedAt: new Date().toISOString(),
        isMock: true,
        dataSource: "mock",
      },
    } satisfies ApiResponse<null>);
  }

  return NextResponse.json({
    data: loadCustomerNarrative(dataset.manifest.generatedAtUtc, customerSlug),
    metadata: {
      queriedAt: new Date().toISOString(),
      isMock: false,
      dataSource: "customer",
      customerName: dataset.manifest.customer,
    },
  });
}
