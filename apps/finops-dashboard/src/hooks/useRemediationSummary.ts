import useSWR from "swr";
import type { ApiResponse, RemediationSummary } from "@/lib/types";

const REFRESH_INTERVAL = 900_000; // 15 min

async function fetcher(url: string): Promise<RemediationSummary | null> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const json: ApiResponse<RemediationSummary | null> = await res.json();
  return json.data;
}

export function useRemediationSummary() {
  return useSWR<RemediationSummary | null>(
    "/api/remediation-summary",
    fetcher,
    {
      refreshInterval: REFRESH_INTERVAL,
      revalidateOnFocus: false,
    },
  );
}
