export const dynamic = 'force-dynamic';
import { NextResponse } from "next/server";
import { isMockMode, checkHealth } from "@/lib/adx-client";
import { getCustomerDatasetInfoForRequest } from "@/lib/customer-dataset-info";

export async function GET(request: Request) {
  if (isMockMode()) {
    // A loaded customer dataset is real invoiced spend, not mock data. Saying
    // "mock" here contradicts every data endpoint (which report
    // dataSource: "customer") and would lead someone checking health before a
    // customer meeting to distrust correct figures.
    const customer = getCustomerDatasetInfoForRequest(request);
    if (customer) {
      return NextResponse.json({
        status: "healthy",
        mode: "customer",
        customer,
        adx: { connected: false, cluster: "N/A", database: "N/A" },
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      status: "healthy",
      mode: "mock",
      adx: { connected: false, cluster: "N/A", database: "N/A" },
      timestamp: new Date().toISOString(),
    });
  }

  const health = await checkHealth();
  return NextResponse.json(
    {
      status: health.connected ? "healthy" : "degraded",
      mode: "live",
      adx: health,
      timestamp: new Date().toISOString(),
    },
    { status: health.connected ? 200 : 503 },
  );
}
