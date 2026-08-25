import { useApi } from "./useApi";
import { useFilters } from "./useFilters";
import type {
  ReservationRow,
  ReservationTrendPoint,
  ReservationFilterOptions,
} from "@/lib/types";

export function useReservationDetail(extraParams?: Record<string, string>) {
  const { filterParams } = useFilters();
  return useApi<ReservationRow[]>("reservations/detail", {
    ...filterParams,
    ...extraParams,
  });
}

export function useReservationTrend(extraParams?: Record<string, string>) {
  const { filterParams } = useFilters();
  return useApi<ReservationTrendPoint[]>("reservations/trend", {
    ...filterParams,
    ...extraParams,
  });
}

export function useReservationOptions() {
  const { filterParams } = useFilters();
  return useApi<ReservationFilterOptions>("reservations/options", filterParams);
}
