export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Endpoint disabled for security — read-only demo mode" },
    { status: 403 },
  );
}
