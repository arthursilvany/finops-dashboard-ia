import { useApi } from "./useApi";
import { useFilters } from "./useFilters";
import type {
  GovernanceKpi,
  TagComplianceBar,
  BudgetVsActualBar,
} from "@/lib/types";

export function useGovernanceKpi() {
  const { filterParams } = useFilters();
  return useApi<GovernanceKpi>("governance/kpi", filterParams);
}

export function useTagCompliance() {
  const { filterParams } = useFilters();
  return useApi<TagComplianceBar[]>("governance/tag-compliance", filterParams);
}

export function useBudgetVsActual() {
  const { filterParams } = useFilters();
  return useApi<BudgetVsActualBar[]>("governance/budget-vs-actual", filterParams);
}
