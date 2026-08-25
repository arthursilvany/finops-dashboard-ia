import useSWR from "swr";
import type { AgenticRecommendation, AgenticSummary } from "@/lib/types";

interface AgenticFinOpsData {
  recommendations: AgenticRecommendation[];
  summary: AgenticSummary;
}

const REFRESH_INTERVAL = 900_000; // 15 min

async function fetcher(url: string): Promise<AgenticFinOpsData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const json = await res.json();
  return json.data;
}

export function useAgenticFinOps() {
  const { data, error, isLoading, mutate } = useSWR<AgenticFinOpsData>(
    "/api/agentic-finops",
    fetcher,
    { refreshInterval: REFRESH_INTERVAL, revalidateOnFocus: false },
  );

  return {
    recommendations: data?.recommendations ?? [],
    summary: data?.summary ?? null,
    error,
    isLoading,
    mutate,
  };
}
