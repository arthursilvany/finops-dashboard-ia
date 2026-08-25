import { useApi } from "./useApi";
import { useState, useCallback } from "react";

interface DailyReport {
  date: string;
  content: string;
  generatedAt: string;
  tokens?: { prompt: number; completion: number; reasoning?: number; total: number };
}

interface ReportSummary {
  date: string;
  generatedAt: string;
  preview: string;
}

export function useDailyInsightsHistory() {
  return useApi<ReportSummary[]>("daily-insights/history");
}

export function useDailyInsightsGenerate() {
  const [report, setReport] = useState<DailyReport | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async (force = false) => {
    setIsGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/daily-insights/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setReport(data.report);
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Generation failed";
      setError(msg);
      return null;
    } finally {
      setIsGenerating(false);
    }
  }, []);

  return { report, isGenerating, error, generate };
}

export function useDailyInsightsReport(date: string | null) {
  return useApi<{ report: DailyReport }>(date ? `daily-insights/${date}` : "");
}
