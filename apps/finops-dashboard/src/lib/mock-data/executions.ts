import type {
  ExecutionLogEntry,
  ExecutionResult,
  ExecutionSavingsKpi,
  ExecutionSavingsRow,
  PreConditionResult,
} from "@/lib/types";
import type { ApiResponse } from "@/lib/types";

export const mockExecutionResult: ExecutionResult = {
  executionId: "exec-001",
  status: "success",
  action: "stop_vm",
  resourceId:
    "/subscriptions/abc/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-idle-01",
  resourceName: "vm-idle-01",
  beforeCost: 2400,
  estimatedAfterCost: 0,
  executedAt: new Date().toISOString(),
  executedBy: "agentic-finops",
  message: "VM stopped successfully. Estimated savings: R$ 2,400/month.",
};

export const mockPreConditionResult: PreConditionResult = {
  canProceed: true,
  checks: [
    {
      check: "resource_exists",
      status: "pass",
      message: "Resource found and accessible.",
    },
    {
      check: "no_active_locks",
      status: "pass",
      message: "No active lock on the resource.",
    },
    {
      check: "rbac_permissions",
      status: "pass",
      message: "Write permissions confirmed.",
    },
    {
      check: "no_dependencies",
      status: "warn",
      message: "1 dependency warning found (Load Balancer backend).",
    },
  ],
};

export const mockExecutionLog: ApiResponse<ExecutionLogEntry[]> = {
  data: [
    {
      executionId: "exec-001",
      resourceId:
        "/subscriptions/abc/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-idle-01",
      resourceName: "vm-idle-01",
      action: "stop_vm",
      beforeCost: 2400,
      afterCost: 0,
      status: "success",
      executedBy: "agentic-finops",
      timestamp: "2026-04-19T14:30:00Z",
      recommendationId: "rec-agentic-001",
      rollbackStatus: "none",
    },
    {
      executionId: "exec-002",
      resourceId:
        "/subscriptions/abc/resourceGroups/rg-staging/providers/Microsoft.Compute/virtualMachines/vm-dev-03",
      resourceName: "vm-dev-03",
      action: "resize_vm",
      beforeCost: 3200,
      afterCost: 1600,
      status: "success",
      executedBy: "agentic-finops",
      timestamp: "2026-04-18T10:15:00Z",
      recommendationId: "rec-agentic-003",
      rollbackStatus: "none",
    },
    {
      executionId: "exec-003",
      resourceId:
        "/subscriptions/abc/resourceGroups/rg-prod/providers/Microsoft.Compute/disks/disk-orphan-07",
      resourceName: "disk-orphan-07",
      action: "delete_disk",
      beforeCost: 180,
      afterCost: 0,
      status: "success",
      executedBy: "agentic-finops",
      timestamp: "2026-04-17T09:45:00Z",
      recommendationId: "rec-agentic-005",
      rollbackStatus: "none",
    },
    {
      executionId: "exec-004",
      resourceId:
        "/subscriptions/abc/resourceGroups/rg-prod/providers/Microsoft.Sql/servers/sql-main/databases/db-analytics",
      resourceName: "db-analytics",
      action: "change_sku",
      beforeCost: 4800,
      afterCost: 4800,
      status: "failed",
      executedBy: "agentic-finops",
      timestamp: "2026-04-16T16:20:00Z",
      recommendationId: "rec-agentic-006",
      rollbackStatus: "none",
    },
    {
      executionId: "exec-005",
      resourceId:
        "/subscriptions/abc/resourceGroups/rg-staging/providers/Microsoft.Network/publicIPAddresses/pip-unused-02",
      resourceName: "pip-unused-02",
      action: "delete_ip",
      beforeCost: 120,
      afterCost: 0,
      status: "success",
      executedBy: "agentic-finops",
      timestamp: "2026-04-15T11:00:00Z",
      recommendationId: "rec-agentic-007",
      rollbackStatus: "none",
    },
  ],
  metadata: { queriedAt: new Date().toISOString(), isMock: true },
};

export const mockExecutionSavings: ApiResponse<{
  kpi: ExecutionSavingsKpi;
  rows: ExecutionSavingsRow[];
}> = {
  data: {
    kpi: {
      totalRealizedSavings: 4300,
      totalEstimatedSavings: 4700,
      accuracyPercent: 91.5,
      executionsCount: 5,
      successCount: 4,
      failedCount: 1,
    },
    rows: [
      {
        resourceId:
          "/subscriptions/abc/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-idle-01",
        resourceName: "vm-idle-01",
        action: "stop_vm",
        beforeCost: 2400,
        estimatedAfterCost: 0,
        actualAfterCost: 0,
        estimatedSavings: 2400,
        actualSavings: 2400,
        accuracy: 100,
      },
      {
        resourceId:
          "/subscriptions/abc/resourceGroups/rg-staging/providers/Microsoft.Compute/virtualMachines/vm-dev-03",
        resourceName: "vm-dev-03",
        action: "resize_vm",
        beforeCost: 3200,
        estimatedAfterCost: 1600,
        actualAfterCost: 1720,
        estimatedSavings: 1600,
        actualSavings: 1480,
        accuracy: 92.5,
      },
      {
        resourceId:
          "/subscriptions/abc/resourceGroups/rg-prod/providers/Microsoft.Compute/disks/disk-orphan-07",
        resourceName: "disk-orphan-07",
        action: "delete_disk",
        beforeCost: 180,
        estimatedAfterCost: 0,
        actualAfterCost: 0,
        estimatedSavings: 180,
        actualSavings: 180,
        accuracy: 100,
      },
      {
        resourceId:
          "/subscriptions/abc/resourceGroups/rg-staging/providers/Microsoft.Network/publicIPAddresses/pip-unused-02",
        resourceName: "pip-unused-02",
        action: "delete_ip",
        beforeCost: 120,
        estimatedAfterCost: 0,
        actualAfterCost: 0,
        estimatedSavings: 120,
        actualSavings: 120,
        accuracy: 100,
      },
    ],
  },
  metadata: { queriedAt: new Date().toISOString(), isMock: true },
};
