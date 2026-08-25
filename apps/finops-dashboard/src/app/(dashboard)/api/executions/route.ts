export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { mockExecutionLog } from "@/lib/mock-data/executions";

export async function GET() {
  try {
    // In production, query ADX with EXECUTION_LOG_KQL
    return NextResponse.json({
      ok: true,
      data: mockExecutionLog.data,
      metadata: { queriedAt: new Date().toISOString(), isMock: true },
    });
  } catch {
    return NextResponse.json({
      ok: true,
      data: mockExecutionLog.data,
      metadata: { queriedAt: new Date().toISOString(), isMock: true },
    });
  }
}
