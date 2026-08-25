export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isMockMode } from "@/lib/adx-client";
import { requireRole } from "@/lib/auth";
import {
  getCustomerDatasetForRequest,
  hasCustomerDatasetForRequest,
} from "@/lib/customer-dataset";
import type {
  ExecutionResult,
  PreConditionResult,
} from "@/lib/types";
import {
  mockPreConditionResult,
} from "@/lib/mock-data/executions";

const ExecutionSchema = z.object({
  recommendationId: z.string().min(1),
  action: z.enum([
    "stop_vm",
    "resize_vm",
    "delete_disk",
    "delete_ip",
    "change_sku",
  ]),
  resourceId: z.string().min(1),
  resourceName: z.string().min(1),
  dryRun: z.boolean().optional(),
});

export async function GET(request: Request) {
  const queriedAt = new Date().toISOString();
  const { searchParams } = new URL(request.url);
  const isPrecheck = searchParams.get("precheck") === "1";

  if (isPrecheck) {
    const resourceId = searchParams.get("resourceId") ?? "";
    if (!resourceId) {
      return NextResponse.json(
        { ok: false, error: "resourceId is required" },
        { status: 400 },
      );
    }

    const customerDataset = isMockMode()
      ? getCustomerDatasetForRequest(request)
      : null;
    if (customerDataset) {
      const result: PreConditionResult = {
        canProceed: false,
        blockedReason:
          "Automatic remediation is disabled in customer assessment mode.",
        checks: [
          {
            check: "customer-assessment-mode",
            status: "block",
            message:
              "Collected customer assessment snapshots are read-only. Review the recommendation, but do not execute remediation from this environment.",
          },
        ],
      };
      return NextResponse.json({
        ok: false,
        error: result.blockedReason,
        data: result,
        metadata: {
          queriedAt,
          isMock: false,
          dataSource: "customer",
          customerName: customerDataset.manifest.customer,
        },
      });
    }

    try {
      // In production, query ARM API to check locks, RBAC, dependencies
      const result: PreConditionResult = mockPreConditionResult;
      return NextResponse.json({
        ok: true,
        data: result,
        metadata: { queriedAt, isMock: true },
      });
    } catch {
      return NextResponse.json({
        ok: true,
        data: mockPreConditionResult,
        metadata: { queriedAt, isMock: true },
      });
    }
  }

  return NextResponse.json(
    { ok: false, error: "Invalid request" },
    { status: 400 },
  );
}

export async function POST(request: Request) {
  // Defense in depth: the middleware already gates this route, but remediation
  // mutates customer Azure resources, so the handler re-checks the role.
  const authorized = requireRole(request, "Admin");
  if ("response" in authorized) return authorized.response;

  if (isMockMode() && hasCustomerDatasetForRequest(request)) {
    const body = await request
      .json()
      .catch(() => null);
    const parsed = ExecutionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const result: ExecutionResult = {
      executionId: `customer-assessment-${Date.now()}`,
      status: "failed",
      action: parsed.data.action,
      resourceId: parsed.data.resourceId,
      resourceName: parsed.data.resourceName,
      beforeCost: 0,
      estimatedAfterCost: 0,
      executedAt: new Date().toISOString(),
      executedBy: "customer-assessment-mode",
      message:
        "Automatic remediation is disabled in customer assessment mode. Export-backed snapshots are read-only.",
      rollbackStatus: "none",
    };

    return NextResponse.json({
      ok: false,
      error: result.message,
      data: result,
      metadata: {
        queriedAt: result.executedAt,
        isMock: false,
        dataSource: "customer",
        customerName: getCustomerDatasetForRequest(request)?.manifest.customer,
      },
    });
  }

  return NextResponse.json(
    {
      ok: false,
      error: "Endpoint disabled for security — read-only demo mode",
    },
    { status: 403 },
  );
}
