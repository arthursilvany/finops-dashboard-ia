import { useApi } from "./useApi";
import { useFilters } from "./useFilters";
import type {
  KpiSummary,
  CostOverTimePoint,
  ServiceBreakdown,
  SubscriptionCost,
  DailyCostPoint,
  CostSummaryKpi,
  MiniKpiGauge,
  PricingModelBreakdown,
  ProviderCost,
  DailyCostByCategory,
  ServiceTrendItem,
} from "@/lib/types";

export function useCostKpi() {
  const { filterParams } = useFilters();
  return useApi<KpiSummary>("cost-summary/kpi", filterParams);
}

export function useCostOverTime(months = 6) {
  const { filterParams } = useFilters();
  return useApi<CostOverTimePoint[]>("cost-summary/over-time", {
    months,
    ...filterParams,
  });
}

export function useCostByService(top = 8) {
  const { filterParams } = useFilters();
  return useApi<ServiceBreakdown[]>("cost-summary/by-service", {
    top,
    ...filterParams,
  });
}

export function useCostBySubscription() {
  const { filterParams } = useFilters();
  return useApi<SubscriptionCost[]>(
    "cost-summary/by-subscription",
    filterParams,
  );
}

export function useCostByProvider() {
  const { filterParams } = useFilters();
  return useApi<ProviderCost[]>("cost-summary/by-provider", filterParams);
}

export function useDailyCosts(days = 28) {
  const { filterParams } = useFilters();
  return useApi<DailyCostPoint[]>("cost-summary/daily", {
    days,
    ...filterParams,
  });
}

export function useCostSummaryKpi() {
  const { filterParams } = useFilters();
  return useApi<CostSummaryKpi>("cost-summary/summary-kpi", filterParams);
}

export function useMiniKpis() {
  const { filterParams } = useFilters();
  return useApi<MiniKpiGauge[]>("cost-summary/mini-kpi", filterParams);
}

export function usePricingModel() {
  const { filterParams } = useFilters();
  return useApi<PricingModelBreakdown[]>(
    "cost-summary/pricing-model",
    filterParams,
  );
}

export function useDailyCostByCategory(days = 30) {
  const { filterParams } = useFilters();
  return useApi<DailyCostByCategory[]>("cost-summary/daily-by-category", {
    days,
    ...filterParams,
  });
}

export function useServiceTrend() {
  const { filterParams } = useFilters();
  return useApi<ServiceTrendItem[]>("cost-summary/service-trend", filterParams);
}
