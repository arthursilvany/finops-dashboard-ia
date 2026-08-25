import useSWR from "swr";
import type { ApiResponse } from "@/lib/types";

const REFRESH_INTERVAL = 60_000;

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  const json: ApiResponse<T> = await res.json();
  return json.data;
}

export function useApi<T>(
  path: string,
  params?: Record<string, string | number>,
) {
  const searchParams = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      searchParams.set(k, String(v));
    }
  }
  const qs = searchParams.toString();
  const url = path ? `/api/${path}${qs ? `?${qs}` : ""}` : null;

  return useSWR<T>(url, fetcher, {
    refreshInterval: REFRESH_INTERVAL,
    revalidateOnFocus: false,
  });
}
