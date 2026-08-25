import { useApi } from "./useApi";
import { useFilters } from "./useFilters";
import type {
  WorkloadKpi,
  CpuCostPoint,
  RightsizingRow,
} from "@/lib/types";

export function useWorkloadKpi() {
  const { filterParams } = useFilters();
  return useApi<WorkloadKpi>("workload/kpi", filterParams);
}

export function useWorkloadCpuScatter() {
  return useApi<CpuCostPoint[]>("workload/cpu-scatter");
}

export function useWorkloadRightsizing() {
  return useApi<RightsizingRow[]>("workload/rightsizing");
}
