import { useApi } from "./useApi";
import { useFilters } from "./useFilters";
import type {
  AiCostKpi,
  AiCostByModel,
  AiCostDailyPoint,
  AiCostByResource,
  AiAnomalyTimelinePoint,
  AiAnomalyResource,
  AiCostAllocation,
} from "@/lib/types";

export function useAiCostKpi() {
  const { filterParams } = useFilters();
  return useApi<AiCostKpi>("ai-costs/kpi", filterParams);
}

export function useAiCostByModel() {
  const { filterParams } = useFilters();
  return useApi<AiCostByModel[]>("ai-costs/by-model", filterParams);
}

export function useAiCostDaily() {
  const { filterParams } = useFilters();
  return useApi<AiCostDailyPoint[]>("ai-costs/daily", filterParams);
}

export function useAiCostByResource() {
  const { filterParams } = useFilters();
  return useApi<AiCostByResource[]>("ai-costs/by-resource", filterParams);
}

export function useAiAnomalyTimeline() {
  const { filterParams } = useFilters();
  return useApi<AiAnomalyTimelinePoint[]>(
    "ai-costs/anomalies/timeline",
    filterParams,
  );
}

export function useAiAnomalyTopResources() {
  const { filterParams } = useFilters();
  return useApi<AiAnomalyResource[]>(
    "ai-costs/anomalies/top-resources",
    filterParams,
  );
}

export function useAiCostAllocation() {
  const { filterParams } = useFilters();
  return useApi<AiCostAllocation[]>("ai-costs/allocation", filterParams);
}
