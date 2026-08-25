import useSWR from "swr";

import type { ApiResponse } from "@/lib/types";
import type {
  SkuAdvisorCapacity,
  SkuAdvisorKpi,
  SkuAdvisorLeverRow,
  SkuAdvisorLifecycle,
  SkuAdvisorRow,
} from "@/lib/sku-advisor-aggregations";

/**
 * SWR hooks for the SKU Advisor view.
 *
 * Unlike `useApi`, these keep the response metadata: the page has to state
 * which of the three sources answered (live service, customer export, bundled
 * sample), and dropping that would leave a rightsizing plan on screen with no
 * indication of whether it describes the customer's estate or a demo.
 */

const REFRESH_INTERVAL = 300_000;

async function fetcher<T>(url: string): Promise<ApiResponse<T>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return (await res.json()) as ApiResponse<T>;
}

function useSkuAdvisor<T>(resource: string) {
  return useSWR<ApiResponse<T>>(`/api/sku-advisor/${resource}`, fetcher, {
    refreshInterval: REFRESH_INTERVAL,
    revalidateOnFocus: false,
  });
}

export function useSkuAdvisorKpi() {
  return useSkuAdvisor<SkuAdvisorKpi>("kpi");
}

export function useSkuAdvisorRecommendations() {
  return useSkuAdvisor<SkuAdvisorRow[]>("recommendations");
}

export function useSkuAdvisorLevers() {
  return useSkuAdvisor<SkuAdvisorLeverRow[]>("levers");
}

export function useSkuAdvisorLifecycle() {
  return useSkuAdvisor<SkuAdvisorLifecycle>("lifecycle");
}

export function useSkuAdvisorCapacity() {
  return useSkuAdvisor<SkuAdvisorCapacity>("capacity");
}
