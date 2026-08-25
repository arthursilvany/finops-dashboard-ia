"use client";

import { useCallback, useState } from "react";
import type {
  ApiResponse,
  SimulatorEstimate,
  SimulatorInput,
} from "@/lib/types";

export function useCostSimulator() {
  const [result, setResult] = useState<SimulatorEstimate | null>(null);
  const [metadata, setMetadata] = useState<
    ApiResponse<SimulatorEstimate>["metadata"] | null
  >(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const estimate = useCallback(async (input: SimulatorInput) => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/simulator/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      const payload = (await res.json()) as
        | ApiResponse<SimulatorEstimate>
        | { error?: string };

      if (!res.ok || !("data" in payload)) {
        const apiError = "error" in payload ? payload.error : undefined;
        throw new Error(apiError || `Simulator request failed (${res.status})`);
      }

      setResult(payload.data);
      setMetadata(payload.metadata);
      return payload.data;
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Simulator request failed";
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setResult(null);
    setMetadata(null);
    setError(null);
  }, []);

  return {
    result,
    metadata,
    isLoading,
    error,
    estimate,
    clear,
  };
}
