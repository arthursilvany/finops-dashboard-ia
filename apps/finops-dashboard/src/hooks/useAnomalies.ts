import { useApi } from "./useApi";
import { useFilters } from "./useFilters";
import type {
  AnomalyPoint,
  AnomalySummary,
  AnomalyResource,
} from "@/lib/types";

export function useAnomalyTimeline() {
  const { filterParams } = useFilters();
  return useApi<AnomalyPoint[]>("anomalies/timeline", filterParams);
}

export function useAnomalySummary() {
  const { filterParams } = useFilters();
  return useApi<AnomalySummary>("anomalies/summary", filterParams);
}

export function useAnomalyTopResources(date?: string) {
  const { filterParams } = useFilters();
  return useApi<AnomalyResource[]>("anomalies/top-resources", {
    ...(date ? { date } : {}),
    ...filterParams,
  });
}
