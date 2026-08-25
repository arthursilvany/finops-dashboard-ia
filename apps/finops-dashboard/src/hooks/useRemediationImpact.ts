import useSWR from "swr";
import type { ApiResponse, RemediationCard } from "@/lib/types";

const REFRESH_INTERVAL = 900_000; // 15 min

async function fetcher(url: string): Promise<RemediationCard[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const json: ApiResponse<RemediationCard[]> = await res.json();
  return json.data;
}

export function useRemediationImpact() {
  return useSWR<RemediationCard[]>("/api/remediation-impact", fetcher, {
    refreshInterval: REFRESH_INTERVAL,
    revalidateOnFocus: false,
  });
}
