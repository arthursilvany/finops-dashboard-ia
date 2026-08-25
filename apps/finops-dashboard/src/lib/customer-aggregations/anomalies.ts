import type {
  AnomalyPoint,
  AnomalyResource,
  AnomalySummary,
} from "../types";
import type { AggregationContext } from "./context";
import { addDays, groupEntries, round2, sumBy } from "./filters";

/**
 * In-memory equivalents of `src/lib/queries/anomalies.ts`.
 *
 * The KQL uses `series_decompose_anomalies(CostSeries, 1.5)`, which performs a
 * seasonal + trend decomposition inside the ADX engine. Reproducing that
 * exactly in TypeScript is not practical, so the POC uses the same underlying
 * idea with a simpler, well-understood estimator:
 *
 *   baseline = centered 7-day moving average (captures weekly seasonality)
 *   score    = (actual - baseline) / (1.4826 * MAD of the residuals)
 *   anomaly  = |score| > 1.5, signed as +1 (spike) or -1 (drop)
 *
 * The MAD-based scale is used instead of the standard deviation because a
 * single large spike would inflate the standard deviation enough to hide
 * itself. The 1.5 threshold and the ±1 flag encoding match the KQL, so the
 * dashboard renders identically. Anomaly *counts* may differ slightly from the
 * ADX view — this is stated in the customer POC documentation.
 */

const ANOMALY_THRESHOLD = 1.5;
const BASELINE_WINDOW = 7;
/** Scale factor that makes the MAD a consistent estimator of sigma. */
const MAD_TO_SIGMA = 1.4826;

interface DailySeriesPoint {
  day: string;
  cost: number;
}

/** Daily totals over the full filtered period, with missing days filled as 0. */
function buildDailySeries(ctx: AggregationContext): DailySeriesPoint[] {
  if (ctx.rows.length === 0) return [];

  const totals = new Map<string, number>();
  let first = ctx.rows[0].chargePeriodStart;
  let last = first;

  for (const row of ctx.rows) {
    const day = row.chargePeriodStart;
    totals.set(day, (totals.get(day) ?? 0) + ctx.cost(row));
    if (day < first) first = day;
    if (day > last) last = day;
  }

  // `make-series ... step 1d` emits every day in the range, including gaps.
  const series: DailySeriesPoint[] = [];
  for (let day = first; day <= last; day = addDays(day, 1)) {
    series.push({ day, cost: totals.get(day) ?? 0 });
  }
  return series;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function movingAverage(series: DailySeriesPoint[], window: number): number[] {
  const half = Math.floor(window / 2);
  return series.map((_, index) => {
    const from = Math.max(0, index - half);
    const to = Math.min(series.length, index + half + 1);
    const slice = series.slice(from, to);
    return sumBy(slice, (p) => p.cost) / slice.length;
  });
}

function detectAnomalies(series: DailySeriesPoint[]): AnomalyPoint[] {
  if (series.length === 0) return [];

  const baselines = movingAverage(series, BASELINE_WINDOW);
  const residuals = series.map((point, i) => point.cost - baselines[i]);
  const scale = MAD_TO_SIGMA * median(residuals.map(Math.abs));

  return series.map((point, i) => {
    const residual = residuals[i];
    // With a flat series the scale collapses to zero; nothing is anomalous.
    const score = scale > 0 ? residual / scale : 0;
    const isAnomaly = Math.abs(score) > ANOMALY_THRESHOLD;
    return {
      day: `${point.day}T00:00:00Z`,
      actualCost: round2(point.cost),
      baseline: round2(baselines[i]),
      anomalyFlag: isAnomaly ? (score > 0 ? 1 : -1) : 0,
      anomalyScore: round2(score),
    };
  });
}

/** Mirrors `anomalyTimeline`. */
export function aggregateAnomalyTimeline(
  ctx: AggregationContext,
): AnomalyPoint[] {
  return detectAnomalies(buildDailySeries(ctx));
}

/** Mirrors `anomalySummary`. Windows are anchored to the dataset, not `now()`. */
export function aggregateAnomalySummary(
  ctx: AggregationContext,
): AnomalySummary {
  const anomalies = detectAnomalies(buildDailySeries(ctx)).filter(
    (point) => point.anomalyFlag !== 0,
  );

  const from7d = addDays(ctx.anchor, -6);
  const from30d = addDays(ctx.anchor, -29);
  const dayOf = (point: AnomalyPoint) => point.day.slice(0, 10);

  return {
    anomalies7d: anomalies.filter((p) => dayOf(p) >= from7d).length,
    anomalies30d: anomalies.filter((p) => dayOf(p) >= from30d).length,
    largestDeviation: round2(
      anomalies.reduce(
        (max, p) => Math.max(max, Math.abs(p.actualCost - p.baseline)),
        0,
      ),
    ),
    lastAnomalyDate:
      anomalies.length > 0 ? anomalies[anomalies.length - 1].day : "",
  };
}

/**
 * Mirrors `anomalyTopResources`. When no date is supplied the route falls back
 * to the latest day with data, which here is the dataset anchor.
 */
export function aggregateAnomalyTopResources(
  ctx: AggregationContext,
  date?: string,
): AnomalyResource[] {
  const target = date ?? ctx.anchor;
  const rows = ctx.rows.filter((r) => r.chargePeriodStart === target);

  return groupEntries(rows, (r) => `${r.serviceName}\u0000${r.resourceId}`)
    .map(([, group]) => ({
      consumedService: group[0].serviceName,
      resourceName: group[0].resourceName,
      dayCost: round2(sumBy(group, ctx.cost)),
    }))
    .sort((a, b) => b.dayCost - a.dayCost)
    .slice(0, 15);
}