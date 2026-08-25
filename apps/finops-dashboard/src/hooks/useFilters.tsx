"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import type { FilterState, TagFilter } from "@/lib/types";
import { DEFAULT_FILTERS } from "@/lib/types";

const STORAGE_KEY = "finops-filters";

interface FilterContextValue {
  filters: FilterState;
  setFilter: <K extends keyof FilterState>(
    key: K,
    value: FilterState[K],
  ) => void;
  setFilters: (partial: Partial<FilterState>) => void;
  resetFilters: () => void;
  addTag: (tag: TagFilter) => void;
  removeTag: (key: string) => void;
  filterParams: Record<string, string>;
}

const FilterContext = createContext<FilterContextValue | null>(null);

function loadFilters(): FilterState {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FILTERS;
    return { ...DEFAULT_FILTERS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_FILTERS;
  }
}

function serializeToParams(filters: FilterState): Record<string, string> {
  const params: Record<string, string> = {};
  if (filters.dateFrom) params.dateFrom = filters.dateFrom;
  if (filters.dateTo) params.dateTo = filters.dateTo;
  if (filters.providers.length) params.providers = filters.providers.join(",");
  if (filters.subscriptions.length)
    params.subscriptions = filters.subscriptions.join(",");
  if (filters.regions.length) params.regions = filters.regions.join(",");
  if (filters.services.length) params.services = filters.services.join(",");
  if (filters.resourceGroups.length)
    params.resourceGroups = filters.resourceGroups.join(",");
  if (filters.tags.length) params.tags = JSON.stringify(filters.tags);
  return params;
}

export function FilterProvider({ children }: { children: ReactNode }) {
  const [filters, setFiltersState] = useState<FilterState>(DEFAULT_FILTERS);

  useEffect(() => {
    setFiltersState(loadFilters());
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  }, [filters]);

  const setFilter = useCallback(
    <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
      setFiltersState((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const setFilters = useCallback((partial: Partial<FilterState>) => {
    setFiltersState((prev) => ({ ...prev, ...partial }));
  }, []);

  const resetFilters = useCallback(() => {
    setFiltersState(DEFAULT_FILTERS);
  }, []);

  const addTag = useCallback((tag: TagFilter) => {
    setFiltersState((prev) => ({
      ...prev,
      tags: [...prev.tags.filter((t) => t.key !== tag.key), tag],
    }));
  }, []);

  const removeTag = useCallback((key: string) => {
    setFiltersState((prev) => ({
      ...prev,
      tags: prev.tags.filter((t) => t.key !== key),
    }));
  }, []);

  const filterParams = serializeToParams(filters);

  return (
    <FilterContext.Provider
      value={{
        filters,
        setFilter,
        setFilters,
        resetFilters,
        addTag,
        removeTag,
        filterParams,
      }}
    >
      {children}
    </FilterContext.Provider>
  );
}

export function useFilters(): FilterContextValue {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error("useFilters must be used within FilterProvider");
  return ctx;
}
