export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import { getCustomerDatasetForRequest } from "@/lib/customer-dataset";
import type { ApiResponse } from "@/lib/types";

const schema = z.object({
  key: z.string().min(1).max(256),
});

const VALID_TAG_KEY = /^[a-zA-Z0-9_.\-:/\s]+$/;

export async function GET(request: NextRequest) {
  const now = new Date().toISOString();
  const params = schema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!params.success) {
    return NextResponse.json(
      { error: params.error.flatten() },
      { status: 400 },
    );
  }

  const tagKey = params.data.key;
  const normalizedTagKey = tagKey.trim().toLowerCase();

  if (!VALID_TAG_KEY.test(tagKey)) {
    return NextResponse.json(
      { error: "Invalid tag key format" },
      { status: 400 },
    );
  }

  if (isMockMode()) {
    const dataset = getCustomerDatasetForRequest(request);
    if (dataset) {
      const data = Array.from(
        new Set(
          dataset.rows
            .map((row) => row.tags[normalizedTagKey]?.trim() ?? "")
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b));

      return NextResponse.json({
        data,
        metadata: {
          queriedAt: now,
          isMock: false,
          dataSource: "customer",
          customerName: dataset.manifest.customer,
        },
      } satisfies ApiResponse<string[]>);
    }

    return NextResponse.json({
      data: ["value-1", "value-2", "value-3"],
      metadata: { queriedAt: now, isMock: true },
    } satisfies ApiResponse<string[]>);
  }

  const escapedKey = tagKey.replace(/'/g, "\\'");
  const query = `
Costs()
| where isnotempty(Tags)
| extend tagVal = tostring(todynamic(Tags)['${escapedKey}'])
| where isnotempty(tagVal)
| distinct tagVal
| order by tagVal asc
`;

  const result = await executeQuery(query);
  const data: string[] = result.rows.map((r) => String(r.tagVal ?? ""));

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<string[]>);
}
