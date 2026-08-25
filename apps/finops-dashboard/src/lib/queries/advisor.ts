import type {
  AdvisorRecommendationCount,
  AdvisorRecommendationDetail,
} from "@/lib/resource-graph-client";
import type { AiInsight, AiRadarDataset } from "@/lib/types";

/**
 * Maps Azure Advisor categories to the 5 official WAF pillars.
 *   - Cost                  → Cost Optimization
 *   - HighAvailability      → Reliability
 *   - Security              → Security
 *   - OperationalExcellence → Operational Excellence
 *   - Performance           → Performance Efficiency
 *
 * Performance Efficiency has limited Advisor coverage;
 * it defaults to a neutral score of 60 when no data exists.
 */

const AXIS_ORDER = [
  "Cost Optimization",
  "Reliability",
  "Security",
  "Operational Excellence",
  "Performance Efficiency",
] as const;

const ADVISOR_TO_AXIS: Record<string, (typeof AXIS_ORDER)[number]> = {
  Cost: "Cost Optimization",
  HighAvailability: "Reliability",
  Security: "Security",
  OperationalExcellence: "Operational Excellence",
  Performance: "Performance Efficiency",
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function computeRadarFromAdvisor(
  rows: AdvisorRecommendationCount[],
): AiRadarDataset {
  // Accumulate impact counts per axis
  const highCounts: Record<string, number> = {};
  const medCounts: Record<string, number> = {};

  for (const axis of AXIS_ORDER) {
    highCounts[axis] = 0;
    medCounts[axis] = 0;
  }

  for (const row of rows) {
    const axis = ADVISOR_TO_AXIS[row.category];
    if (!axis) continue;
    if (row.impact === "High") highCounts[axis] += row.count;
    else if (row.impact === "Medium") medCounts[axis] += row.count;
  }

  // Score: 100 minus weighted deductions. High = 15pts, Medium = 5pts each.
  const DEFAULT_NO_ADVISOR = 60;
  const values = AXIS_ORDER.map((axis) => {
    const hasAdvisorData = Object.values(ADVISOR_TO_AXIS).includes(axis);
    if (!hasAdvisorData) return DEFAULT_NO_ADVISOR;
    const h = highCounts[axis] ?? 0;
    const m = medCounts[axis] ?? 0;
    if (h === 0 && m === 0) return DEFAULT_NO_ADVISOR;
    const score = 100 - (h * 15 + m * 5);
    return clamp(score, 0, 100);
  });

  return {
    indicators: AXIS_ORDER.map((name) => ({ name, max: 100 })),
    series: [
      { name: "Current", values, color: "#38bdf8" },
      { name: "Target", values: [80, 85, 90, 85, 80], color: "#818cf8" },
    ],
  };
}

const IMPACT_MAP: Record<string, AiInsight["impact"]> = {
  High: "high",
  Medium: "medium",
  Low: "low",
};

export function computeInsightsFromAdvisor(
  details: AdvisorRecommendationDetail[],
): AiInsight[] {
  // Group Cost recommendations by normalized title (same problem affecting multiple resources)
  const groups = new Map<string, AdvisorRecommendationDetail[]>();
  for (const d of details) {
    if (d.category !== "Cost") continue;
    const key = (d.title || d.category).trim().toLowerCase();
    const group = groups.get(key) ?? [];
    group.push(d);
    groups.set(key, group);
  }

  const consolidated: AiInsight[] = [];
  let idx = 0;
  for (const group of Array.from(groups.values())) {
    const first = group[0];
    const resourceCount = group.length;
    const totalSavings = group.reduce(
      (sum, d) => sum + (d.savingsAmount > 0 ? d.savingsAmount : 0),
      0,
    );
    consolidated.push({
      id: `adv-${String(++idx).padStart(3, "0")}`,
      title: first.title || `${first.category} Recommendation`,
      summary:
        first.description ||
        `Azure Advisor ${first.impact} impact recommendation for ${first.category}.`,
      impact: IMPACT_MAP[first.impact] ?? "low",
      category: first.category,
      savingsEstimate:
        totalSavings > 0 ? Math.round(totalSavings / 12) : undefined,
      resourceCount: resourceCount > 1 ? resourceCount : undefined,
    });
  }

  // Show only high-impact recommendations; fall back to medium if none exist; low is never shown
  const highItems = consolidated.filter((i) => i.impact === "high");
  if (highItems.length > 0) return highItems;
  return consolidated.filter((i) => i.impact === "medium");
}
