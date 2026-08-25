import { useCallback, useMemo, useState } from "react";

import { useApi } from "./useApi";
import { useFilters } from "./useFilters";
import type { NarrativeResponseBody } from "@/app/(dashboard)/api/multicloud/narrative/route";
import type { MulticloudNarrative } from "@/lib/multicloud/contract";
import { DEFAULT_WEIGHTS } from "@/lib/multicloud/score";
import type { MulticloudFacts, ScoreWeights } from "@/lib/multicloud/types";

/**
 * The comparison, plus the weight controls that shape its ranking.
 *
 * Weights are held in React state and pushed into the query string rather than
 * applied client-side. Re-scoring in the browser would put a second scoring
 * implementation next to `score.ts` — and the moment those two disagree, the
 * page and its Markdown export tell two different stories about the same
 * estate.
 */
export function useMulticloudCompare() {
  const { filterParams } = useFilters();
  const [weights, setWeights] = useState<ScoreWeights>(DEFAULT_WEIGHTS);

  const params = useMemo(
    () => ({
      ...filterParams,
      wPrice: weights.price,
      wPerformance: weights.performance,
      wSla: weights.sla,
      wEgress: weights.egress,
    }),
    [filterParams, weights],
  );

  const query = useApi<MulticloudFacts>("multicloud/compare", params);

  const setWeight = useCallback((key: keyof ScoreWeights, value: number) => {
    setWeights((current) => ({ ...current, [key]: value }));
  }, []);

  const resetWeights = useCallback(() => setWeights(DEFAULT_WEIGHTS), []);

  const isDefaultWeights = useMemo(
    () =>
      (Object.keys(DEFAULT_WEIGHTS) as Array<keyof ScoreWeights>).every(
        (k) => weights[k] === DEFAULT_WEIGHTS[k],
      ),
    [weights],
  );

  /** Query string for the Markdown export, so it inherits the same weights. */
  const exportQuery = useMemo(() => {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) search.set(k, String(v));
    return search.toString();
  }, [params]);

  // The narrative is fetched on demand rather than with the comparison: it
  // costs tokens, and a page that spends money on every filter change is a page
  // nobody dares to explore.
  const [narrative, setNarrative] = useState<MulticloudNarrative | null>(null);
  const [narrativeNote, setNarrativeNote] = useState<string | null>(null);
  const [isNarrating, setIsNarrating] = useState(false);

  const requestNarrative = useCallback(async () => {
    setIsNarrating(true);
    setNarrativeNote(null);
    try {
      const response = await fetch(`/api/multicloud/narrative?${exportQuery}`, {
        method: "POST",
      });
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      const body = (await response.json()) as { data: NarrativeResponseBody };
      setNarrative(body.data.narrative);
      setNarrativeNote(body.data.suppressedReason);
    } catch (error) {
      setNarrative(null);
      setNarrativeNote(
        error instanceof Error ? error.message : "The narrative request failed.",
      );
    } finally {
      setIsNarrating(false);
    }
  }, [exportQuery]);

  return {
    facts: query.data,
    isLoading: query.isLoading,
    error: query.error as Error | undefined,
    weights,
    setWeight,
    resetWeights,
    isDefaultWeights,
    exportQuery,
    narrative,
    narrativeNote,
    isNarrating,
    requestNarrative,
  };
}
