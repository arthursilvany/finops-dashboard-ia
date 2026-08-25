import type {
  ExecutionRequest,
  ExecutionResult,
  RemediationAction,
} from "./types";
import { mockExecutionResult } from "./mock-data/executions";

const ACTION_LABELS: Record<RemediationAction, string> = {
  stop_vm: "Stop VM",
  resize_vm: "Resize VM",
  delete_disk: "Delete Orphan Disk",
  delete_ip: "Delete Public IP",
  change_sku: "Change SKU",
};

export function getActionLabel(action: RemediationAction): string {
  return ACTION_LABELS[action] ?? action;
}

export async function executeRemediation(
  req: ExecutionRequest,
): Promise<ExecutionResult> {
  try {
    const res = await fetch("/api/remediation/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const json = await res.json();
    return json.data as ExecutionResult;
  } catch {
    return {
      ...mockExecutionResult,
      resourceId: req.resourceId,
      resourceName: req.resourceName,
      action: req.action,
      executedAt: new Date().toISOString(),
      message: `[Mock] ${getActionLabel(req.action)} executed successfully for ${req.resourceName}.`,
    };
  }
}
