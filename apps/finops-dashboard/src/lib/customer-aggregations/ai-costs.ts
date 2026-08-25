import type {
  AiAnomalyResource,
  AiAnomalyTimelinePoint,
  AiCostAllocation,
  AiCostByModel,
  AiCostByResource,
  AiCostDailyPoint,
  AiCostKpi,
} from "../types";
import type { CustomerCostRow } from "../customer-data/contract";
import { lookupTag } from "../customer-data/contract";
import type { AggregationContext } from "./context";
import { addDays, groupEntries, round2, rowsOverlapping, sumBy } from "./filters";
import { aggregateAnomalyTimeline } from "./anomalies";

/**
 * In-memory equivalents of `src/lib/queries/ai-costs.ts`.
 *
 * All aggregators filter on `serviceCategory === "AI and Machine Learning"`.
 * For legacy exports that lack a ServiceCategory column the category is derived
 * from service/meter names by `deriveServiceCategory()` during ingestion, so
 * both FOCUS and legacy formats are handled transparently here.
 *
 * HONESTY NOTE: a Cost Export is a billing snapshot, not a model telemetry
 * feed. Token counts, quota utilisation, latency and model-level unit economics
 * are NOT available. Where the KQL computes a metric the export cannot provide,
 * we return 0 / empty and document why in a comment — matching the approach in
 * `governance.ts` (`budget: 0`, "Budgets live in Azure, not in the export.").
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isAi(row: CustomerCostRow): boolean {
  return row.serviceCategory === "AI and Machine Learning";
}

/**
 * Returns a narrowed `AggregationContext` whose `.rows` and window helpers
 * only include AI-category rows. The `.cost` accessor is inherited unchanged.
 */
function aiScope(ctx: AggregationContext): AggregationContext {
  const aiRows = ctx.rows.filter(isAi);

  const between = (from: string, toExclusive: string): CustomerCostRow[] =>
    rowsOverlapping(aiRows, from, toExclusive);

  const lastDays = (days: number): CustomerCostRow[] =>
    between(addDays(ctx.anchor, -(days - 1)), addDays(ctx.anchor, 1));

  const previousDays = (days: number): CustomerCostRow[] =>
    between(
      addDays(ctx.anchor, -(days * 2 - 1)),
      addDays(ctx.anchor, -(days - 1)),
    );

  return { ...ctx, rows: aiRows, lastDays, previousDays, between };
}

/**
 * Infers a model name from meter/SKU metadata when confidently possible.
 *
 * A Cost Export has no dedicated model column — billing is at the resource
 * or meter level. Pattern matching on `x_SkuMeterSubcategory` and
 * `x_SkuMeterCategory` yields a model label for the most common Azure OpenAI
 * deployments. Anything not recognised is grouped as "Other" rather than
 * inventing a label.
 */
function deriveModel(row: CustomerCostRow): string {
  const haystack = [
    row.skuMeterSubcategory,
    row.skuMeterCategory,
    row.resourceName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (haystack.includes("gpt-4o")) return "GPT-4o";
  if (haystack.includes("gpt-4")) return "GPT-4";
  if (haystack.includes("gpt-35") || haystack.includes("gpt-3.5"))
    return "GPT-3.5";
  if (haystack.includes("text-embedding") || haystack.includes("ada"))
    return "Embeddings";
  if (haystack.includes("dall-e") || haystack.includes("dalle"))
    return "DALL-E";
  if (haystack.includes("whisper")) return "Whisper";
  if (
    haystack.includes("tts") ||
    (haystack.includes("speech") && !haystack.includes("cognitive"))
  )
    return "Speech";
  // Cannot confidently derive the model from this row — do not fabricate.
  return "Other";
}

// ---------------------------------------------------------------------------
// Public aggregators
// ---------------------------------------------------------------------------

/** Mirrors `aiCostKpi` + `aiCostKpiPrevious`. */
export function aggregateAiCostKpi(ctx: AggregationContext): AiCostKpi {
  const scope = aiScope(ctx);
  const last30 = scope.lastDays(30);
  const prev30 = scope.previousDays(30);

  const totalCost30d = round2(sumBy(last30, ctx.cost));
  const costPrevious30d = round2(sumBy(prev30, ctx.cost));

  const momChangePercent =
    costPrevious30d > 0
      ? Math.round(
          ((totalCost30d - costPrevious30d) / costPrevious30d) * 10000,
        ) / 100
      : 0;

  const resources = new Set(last30.map((r) => r.resourceId).filter(Boolean));
  const resourceCount = resources.size;
  const avgCostPerResource =
    resourceCount > 0 ? round2(totalCost30d / resourceCount) : 0;

  // Top resource by cost mirrors KQL `take 1 of aiCostByModel (order by Cost desc)`.
  let topModel = "N/A";
  let topModelCost = 0;
  for (const [name, rows] of groupEntries(
    last30,
    (r) => r.resourceName || "Unknown",
  )) {
    const cost = sumBy(rows, ctx.cost);
    if (cost > topModelCost) {
      topModelCost = cost;
      topModel = name;
    }
  }

  return {
    totalCost30d,
    costPrevious30d,
    momChangePercent,
    resourceCount,
    avgCostPerResource,
    topModel,
    topModelCost: round2(topModelCost),
  };
}

/** Mirrors `aiCostDaily`. */
export function aggregateAiCostDaily(
  ctx: AggregationContext,
): AiCostDailyPoint[] {
  const scope = aiScope(ctx);
  return groupEntries(scope.lastDays(30), (r) => r.chargePeriodStart)
    .map(([day, group]) => ({
      day: `${day}T00:00:00Z`,
      cost: round2(sumBy(group, ctx.cost)),
    }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/** Mirrors `aiCostByResource`. */
export function aggregateAiCostByResource(
  ctx: AggregationContext,
): AiCostByResource[] {
  const scope = aiScope(ctx);
  const rows30 = scope.lastDays(30);

  return groupEntries(
    rows30,
    (r) =>
      `${r.resourceName || r.resourceId || "unknown"}\u0000${r.resourceGroupName}\u0000${r.subAccountName}`,
  )
    .map(([, group]) => {
      const first = group[0];
      const cost = sumBy(group, ctx.cost);
      const days = new Set(group.map((r) => r.chargePeriodStart)).size;
      return {
        resourceName: first.resourceName || first.resourceId || "Unknown",
        // AWS has no resource group, and an empty cell reads as missing data
        // rather than a concept that does not exist for that provider.
        resourceGroup:
          first.resourceGroupName ||
          (first.providerName === "Azure" ? "" : `N/A (${first.providerName})`),
        subscriptionName: first.subAccountName,
        cost: round2(cost),
        dailyAvg: days > 0 ? round2(cost / days) : 0,
        model: deriveModel(first),
      };
    })
    .sort((a, b) => b.cost - a.cost);
}

/**
 * Mirrors `aiCostByModel` — grouped by inferred model name rather than
 * ResourceName, since the export has no model column. The KQL groups by
 * ResourceName; here we do the same inferrence step first so the panel shows
 * GPT-4o, GPT-4, etc. when the meter names carry that signal.
 */
export function aggregateAiCostByModel(
  ctx: AggregationContext,
): AiCostByModel[] {
  const scope = aiScope(ctx);
  const rows30 = scope.lastDays(30);
  const total = sumBy(rows30, ctx.cost);

  return groupEntries(rows30, (r) => deriveModel(r))
    .map(([model, group]) => {
      const cost = sumBy(group, ctx.cost);
      return {
        resourceName: model,
        cost: round2(cost),
        percentage:
          total > 0 ? Math.round((cost / total) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 10);
}

/**
 * Mirrors `aiCostAllocation`. Reads tag keys `cost-center`, `ai-app` and
 * `ai-model` — the same keys the KQL reads from `todynamic(Tags)`.
 *
 * The `ai-model` tag is populated only when the customer has tagged their
 * OpenAI deployments with it; it is NOT inferred from meter names here because
 * this panel exists to validate the customer's own allocation taxonomy, not to
 * substitute for it.
 */
export function aggregateAiCostAllocation(
  ctx: AggregationContext,
): AiCostAllocation[] {
  const scope = aiScope(ctx);
  const rows30 = scope.lastDays(30);
  const total = sumBy(rows30, ctx.cost);

  return groupEntries(
    rows30,
    (r) =>
      `${lookupTag(r.tags, "cost-center") || "Untagged"}\u0000${lookupTag(r.tags, "ai-app") || "Unknown"}\u0000${lookupTag(r.tags, "ai-model") || "Unknown"}`,
  )
    .map(([key, group]) => {
      const parts = key.split("\u0000");
      const cost = sumBy(group, ctx.cost);
      return {
        businessUnit: parts[0],
        aiApp: parts[1],
        aiModel: parts[2],
        cost: round2(cost),
        percentage:
          total > 0 ? Math.round((cost / total) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.cost - a.cost);
}

/**
 * Mirrors `aiAnomalyTimeline`. Delegates to the shared MAD-based anomaly
 * detector from `anomalies.ts` on the AI-filtered subset, preserving the
 * phase-1 MAD/moving-average algorithm exactly.
 */
export function aggregateAiAnomalyTimeline(
  ctx: AggregationContext,
): AiAnomalyTimelinePoint[] {
  const scope = aiScope(ctx);
  return aggregateAnomalyTimeline(scope).map((p) => ({
    day: p.day,
    actualCost: p.actualCost,
    baseline: p.baseline,
    anomalyFlag: p.anomalyFlag,
    // anomalyScore is in AnomalyPoint but not required by AiAnomalyTimelinePoint.
  }));
}

/**
 * Mirrors `aiAnomalyTopResources`. The KQL computes per-resource baselines by
 * comparing a 7-day window to a prior 30-day window. We reproduce that here:
 * resources whose 7-day average daily cost exceeds the 30-day prior average by
 * more than 100% are flagged as anomalous.
 *
 * `deviationPercent` is a percentage increase vs. baseline, not a z-score.
 * Resources with no prior baseline (newly created) are excluded rather than
 * treated as infinite anomalies, which would be misleading in a meeting.
 */
export function aggregateAiAnomalyTopResources(
  ctx: AggregationContext,
): AiAnomalyResource[] {
  const scope = aiScope(ctx);
  const recent7d = scope.lastDays(7);
  // Prior window: same length as KQL's `ago(37d) .. ago(7d)`.
  const baseline30d = scope.previousDays(30);

  // Per-resource average DAILY cost over the 30d prior window.
  const baselineAvg = new Map<string, number>();
  for (const [resource, rows] of groupEntries(
    baseline30d,
    (r) => r.resourceName || r.resourceId,
  )) {
    const days = new Set(rows.map((r) => r.chargePeriodStart)).size;
    baselineAvg.set(
      resource,
      days > 0 ? sumBy(rows, ctx.cost) / days : 0,
    );
  }

  // Per-resource total cost over 7d.
  const results: AiAnomalyResource[] = [];
  for (const [resource, rows] of groupEntries(
    recent7d,
    (r) => r.resourceName || r.resourceId,
  )) {
    const dayCost = round2(sumBy(rows, ctx.cost));
    const baseline = round2(baselineAvg.get(resource) ?? 0);
    if (baseline <= 0) continue; // No prior baseline — exclude to avoid misleading output.
    const deviationPercent = round2(((dayCost - baseline) / baseline) * 100);
    if (deviationPercent > 100) {
      results.push({
        resourceName: resource,
        consumedService: rows[0].serviceName,
        dayCost,
        baselineCost: baseline,
        deviationPercent,
      });
    }
  }

  return results.sort((a, b) => b.deviationPercent - a.deviationPercent).slice(0, 5);
}
