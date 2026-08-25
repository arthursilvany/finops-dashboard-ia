import { useApi } from "./useApi";
import { useFilters } from "./useFilters";
import type {
  CommitmentGapItem,
  SavingsSummary,
  OptimizationAction,
  IdleResource,
  EffectiveSavingsRateSummary,
  EffectiveSavingsRateBreakdownItem,
} from "@/lib/types";

export function useCommitmentGap() {
  const { filterParams } = useFilters();
  return useApi<CommitmentGapItem[]>(
    "rate-optimization/commitment-gap",
    filterParams,
  );
}

export function useSavingsSummary() {
  const { filterParams } = useFilters();
  return useApi<SavingsSummary>("rate-optimization/savings", filterParams);
}

export function useOptimizationActions() {
  const { filterParams } = useFilters();
  return useApi<OptimizationAction[]>(
    "rate-optimization/actions",
    filterParams,
  );
}

export function useIdleResources() {
  const { filterParams } = useFilters();
  return useApi<IdleResource[]>("rate-optimization/idle", filterParams);
}

export function useEffectiveSavingsRateSummary() {
  const { filterParams } = useFilters();
  return useApi<EffectiveSavingsRateSummary>(
    "rate-optimization/esr-summary",
    filterParams,
  );
}

export function useEffectiveSavingsRateBreakdown() {
  const { filterParams } = useFilters();
  return useApi<EffectiveSavingsRateBreakdownItem[]>(
    "rate-optimization/esr-breakdown",
    filterParams,
  );
}
