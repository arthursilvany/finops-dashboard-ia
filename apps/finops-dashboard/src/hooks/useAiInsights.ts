import { useApi } from "./useApi";
import type { AiInsight, AiInsightsCost, AiRadarDataset } from "@/lib/types";

interface AiInsightsBundle {
  insights: AiInsight[];
  costForecast: AiInsightsCost;
  radar: AiRadarDataset;
  finopsRadar: AiRadarDataset;
}

export function useAiInsights() {
  return useApi<AiInsightsBundle>("ai-insights");
}
