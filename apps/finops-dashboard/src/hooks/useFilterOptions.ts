import { useApi } from "./useApi";
import type { FilterOptions } from "@/lib/types";

export function useFilterOptions() {
  return useApi<FilterOptions>("filters/options");
}

export function useTagValues(tagKey: string | null) {
  const shouldFetch = tagKey !== null && tagKey.length > 0;
  return useApi<string[]>(
    shouldFetch ? "filters/tag-values" : "",
    shouldFetch ? { key: tagKey } : undefined,
  );
}
