"use client";

import { useState, useCallback } from "react";
import type { PriceSource } from "@/lib/types";

export type { PriceSource };
export type Environment = "production" | "non-production";

interface PricingResult {
  content: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  priceSource: PriceSource;
  environment: Environment;
}

export function usePricingQuery() {
  const [result, setResult] = useState<PricingResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useCallback(
    async (params: {
      priceSource: PriceSource;
      environment: Environment;
      query: string;
      skuList?: string[];
    }) => {
      setIsLoading(true);
      setError(null);
      setResult(null);

      try {
        const res = await fetch("/api/pricing/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || `Request failed (${res.status})`);
        }

        setResult(data);
        return data;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Query failed";
        setError(msg);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const clear = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { result, isLoading, error, query, clear };
}

export function useFileUpload() {
  const [skuList, setSkuList] = useState<string[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(async (file: File) => {
    setIsUploading(true);
    setError(null);
    setSkuList(null);
    setFileName(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/pricing/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Upload failed (${res.status})`);
      }

      setSkuList(data.skuList);
      setFileName(file.name);
      return data.skuList as string[];
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setError(msg);
      return null;
    } finally {
      setIsUploading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setSkuList(null);
    setFileName(null);
    setError(null);
  }, []);

  return { skuList, fileName, isUploading, error, upload, clear };
}

export interface RiCompareRow {
  mode: string;
  monthly_cost: number | null;
  annual_cost: number | null;
  savings_pct: number | null;
  break_even_months: number | null;
  recommendation: "Strong" | "Moderate" | "Weak" | "—";
}

export interface RiCompareResult {
  rows: RiCompareRow[];
  currency: string;
  service_name: string;
  sku_name: string | null;
  region: string | null;
}

export function useRiComparison() {
  const [result, setResult] = useState<RiCompareResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const compare = useCallback(
    async (params: {
      service_name: string;
      sku_name?: string;
      region?: string;
      currency_code?: string;
    }) => {
      setIsLoading(true);
      setError(null);
      setResult(null);

      try {
        const res = await fetch("/api/pricing/ri-compare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || `Request failed (${res.status})`);
        }

        setResult(data as RiCompareResult);
        return data as RiCompareResult;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Comparison failed";
        setError(msg);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const clear = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { result, isLoading, error, compare, clear };
}
