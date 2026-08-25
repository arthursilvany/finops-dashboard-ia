export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

const MAX_SKUS = 50;
const MAX_FILE_SIZE = 512 * 1024; // 512KB

function parseCSV(text: string): string[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];

  const header = lines[0].toLowerCase();
  const separator = header.includes("\t") ? "\t" : ",";
  const columns = header
    .split(separator)
    .map((c) => c.trim().replace(/^["']|["']$/g, ""));

  // Find the best column for SKU names
  const skuColIndex = columns.findIndex(
    (c) =>
      c === "sku" ||
      c === "armSkuname" ||
      c === "arm_sku_name" ||
      c === "skuName" ||
      c === "sku_name" ||
      c.includes("sku"),
  );
  const serviceColIndex = columns.findIndex(
    (c) =>
      c === "service" ||
      c === "servicename" ||
      c === "service_name" ||
      c.includes("service"),
  );

  if (skuColIndex === -1 && serviceColIndex === -1) {
    // If no header match, treat first column as SKU
    return lines
      .slice(1)
      .map((l) =>
        l
          .split(separator)[0]
          ?.trim()
          .replace(/^["']|["']$/g, ""),
      )
      .filter(Boolean);
  }

  const skus: string[] = [];
  for (const line of lines.slice(1)) {
    const cells = line
      .split(separator)
      .map((c) => c.trim().replace(/^["']|["']$/g, ""));
    const parts: string[] = [];
    if (serviceColIndex !== -1 && cells[serviceColIndex]) {
      parts.push(cells[serviceColIndex]);
    }
    if (skuColIndex !== -1 && cells[skuColIndex]) {
      parts.push(cells[skuColIndex]);
    }
    if (parts.length > 0) {
      skus.push(parts.join(" "));
    }
  }

  return skus;
}

export async function POST() {
  return NextResponse.json(
    { error: "Endpoint disabled for security — read-only demo mode" },
    { status: 403 },
  );
}

// Original implementation disabled for demo safety
async function _disabledPOST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";

    let fileText: string;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;

      if (!file) {
        return NextResponse.json(
          { error: "No file provided" },
          { status: 400 },
        );
      }

      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `File too large. Maximum ${MAX_FILE_SIZE / 1024}KB.` },
          { status: 400 },
        );
      }

      const name = file.name.toLowerCase();
      if (
        !name.endsWith(".csv") &&
        !name.endsWith(".tsv") &&
        !name.endsWith(".txt")
      ) {
        return NextResponse.json(
          { error: "Only CSV, TSV, and TXT files are supported" },
          { status: 400 },
        );
      }

      fileText = await file.text();
    } else {
      const body = await request.json();
      fileText = body.content;
      if (!fileText) {
        return NextResponse.json(
          { error: "No file content provided" },
          { status: 400 },
        );
      }
    }

    const skus = parseCSV(fileText);

    if (skus.length === 0) {
      return NextResponse.json(
        {
          error:
            "No SKUs found in file. Expected columns: sku, service, or similar.",
        },
        { status: 400 },
      );
    }

    if (skus.length > MAX_SKUS) {
      return NextResponse.json(
        {
          error: `Too many SKUs (${skus.length}). Maximum ${MAX_SKUS} per batch.`,
          parsed: skus.length,
        },
        { status: 400 },
      );
    }

    return NextResponse.json({
      skuList: skus,
      total: skus.length,
    });
  } catch (err: unknown) {
    console.error("Upload parse error:", err);
    const message = err instanceof Error ? err.message : "File parsing failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
