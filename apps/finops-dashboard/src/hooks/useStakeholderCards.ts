import { useApi } from "./useApi";
import { useFilters } from "./useFilters";
import type { StakeholderCardsPayload } from "@/lib/stakeholder/types";

/**
 * Cards read the same facts as the other pages, so they respect the same
 * filters. `scope` slices only the Application Owner card.
 */
export function useStakeholderCards(scope?: string | null) {
  const { filterParams } = useFilters();
  return useApi<StakeholderCardsPayload>("stakeholder-cards", {
    ...filterParams,
    ...(scope ? { scope } : {}),
  });
}
