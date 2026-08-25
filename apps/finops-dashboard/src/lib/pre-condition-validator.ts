import type { PreConditionResult } from "./types";
import { mockPreConditionResult } from "./mock-data/executions";

export async function runPreConditionChecks(
  resourceId: string,
): Promise<PreConditionResult> {
  try {
    const res = await fetch(
      `/api/remediation/execute?precheck=1&resourceId=${encodeURIComponent(resourceId)}`,
    );
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const json = await res.json();
    return json.data as PreConditionResult;
  } catch {
    return mockPreConditionResult;
  }
}
