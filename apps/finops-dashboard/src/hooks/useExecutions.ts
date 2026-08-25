import { useApi } from "./useApi";
import type {
  ExecutionLogEntry,
  ExecutionSavingsKpi,
  ExecutionSavingsRow,
} from "@/lib/types";

export function useExecutions() {
  const { data, error, isLoading, mutate } =
    useApi<ExecutionLogEntry[]>("executions");
  return {
    executions: data ?? [],
    error,
    isLoading,
    mutate,
  };
}

export function useExecutionSavings() {
  const { data, error, isLoading } = useApi<{
    kpi: ExecutionSavingsKpi;
    rows: ExecutionSavingsRow[];
  }>("executions/savings");
  return {
    kpi: data?.kpi ?? null,
    rows: data?.rows ?? [],
    error,
    isLoading,
  };
}
