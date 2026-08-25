import { useApi } from "./useApi";
import { useFilters } from "./useFilters";
import type {
  BudgetBurnRate,
  BudgetVsActualPoint,
  BudgetBySubscription,
  ForecastPoint,
  ForecastConfidencePoint,
} from "@/lib/types";

export function useBudgetBurnRate(budget = 10000) {
  const { filterParams } = useFilters();
  return useApi<BudgetBurnRate>("budgets/burn-rate", {
    budget,
    ...filterParams,
  });
}

export function useBudgetVsActual(budget = 10000) {
  const { filterParams } = useFilters();
  return useApi<BudgetVsActualPoint[]>("budgets/vs-actual", {
    budget,
    ...filterParams,
  });
}

export function useBudgetBySubscription(budget = 10000) {
  const { filterParams } = useFilters();
  return useApi<BudgetBySubscription[]>("budgets/by-subscription", {
    budget,
    ...filterParams,
  });
}

export function useForecastVsBudget(budget = 10000) {
  const { filterParams } = useFilters();
  return useApi<ForecastPoint[]>("budgets/forecast", {
    budget,
    mode: "budget",
    ...filterParams,
  });
}

export function useForecastConfidence() {
  const { filterParams } = useFilters();
  return useApi<ForecastConfidencePoint[]>("budgets/forecast", {
    mode: "confidence",
    ...filterParams,
  });
}
