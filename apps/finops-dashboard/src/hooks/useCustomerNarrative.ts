import { useApi } from "./useApi";
import type { CustomerNarrativeResult } from "@/lib/customer-narrative-store";

export function useCustomerNarrative() {
  return useApi<CustomerNarrativeResult | null>("customer-narrative");
}
