export const dynamic = "force-dynamic";
import type { NextRequest } from "next/server";

import { selectKpi } from "@/lib/sku-advisor-aggregations";
import { skuAdvisorResponse } from "@/lib/sku-advisor-response";

export async function GET(request: NextRequest) {
  return skuAdvisorResponse(request, selectKpi);
}
