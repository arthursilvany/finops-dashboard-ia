import { useApi } from "./useApi";
import { useFilters } from "./useFilters";
import type {
  ChargebackKpi,
  ChargebackByBU,
  ChargebackTrendPoint,
} from "@/lib/types";

export function useChargebackKpi() {
  const { filterParams } = useFilters();
  return useApi<ChargebackKpi>("chargeback/kpi", filterParams);
}

export function useChargebackByBU() {
  const { filterParams } = useFilters();
  return useApi<ChargebackByBU[]>("chargeback/by-bu", filterParams);
}

export function useChargebackTrend() {
  const { filterParams } = useFilters();
  return useApi<ChargebackTrendPoint[]>("chargeback/trend", filterParams);
}
