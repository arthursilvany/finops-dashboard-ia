import fs from "node:fs";

import type {
  AdvisorEvidenceRow,
  CustomerEvidenceFile,
} from "./customer-data/evidence";
import { activeCustomerPaths } from "./customer-data/workspace";
import type { AiRadarDataset } from "./types";

const PILLARS = [
  "Reliability",
  "Security",
  "Cost Optimization",
  "Operational Excellence",
  "Performance Efficiency",
] as const;

const IMPACT_PENALTY: Record<string, number> = {
  high: 20,
  medium: 10,
  low: 5,
};

function pillarFor(row: AdvisorEvidenceRow): (typeof PILLARS)[number] | null {
  const value = `${row.category} ${row.title} ${row.recommendationTypeId}`
    .replace(/[\s_-]/g, "")
    .toLowerCase();
  if (/highavailability|reliability|availability|backup|recovery/.test(value)) {
    return "Reliability";
  }
  if (/security|defender|encrypt|vulnerab/.test(value)) return "Security";
  if (/cost|saving|rightsiz|reservation|idle|unused/.test(value)) {
    return "Cost Optimization";
  }
  if (/operationalexcellence|monitor|diagnostic|alert|log/.test(value)) {
    return "Operational Excellence";
  }
  if (/performance|latency|throughput|scale/.test(value)) {
    return "Performance Efficiency";
  }
  return null;
}

export const unavailableCustomerWafRadar: AiRadarDataset = {
  indicators: PILLARS.map((name) => ({ name, max: 100 })),
  series: [
    {
      name: "Assessment unavailable",
      values: PILLARS.map(() => 0),
      color: "#64748b",
    },
  ],
};

export function getCustomerWafRadar(
  expectedDatasetGeneratedAtUtc: string,
  customerSlug?: string | null,
): AiRadarDataset | null {
  try {
    const advisorFile = activeCustomerPaths(customerSlug).advisor;
    if (!fs.existsSync(advisorFile)) return null;
    const evidence = JSON.parse(
      fs.readFileSync(advisorFile, "utf8"),
    ) as CustomerEvidenceFile<AdvisorEvidenceRow>;
    if (
      evidence.datasetGeneratedAtUtc !== expectedDatasetGeneratedAtUtc ||
      evidence.status !== "available" ||
      evidence.records.length === 0
    ) {
      return null;
    }

    const scores = new Map<(typeof PILLARS)[number], number>(
      PILLARS.map((pillar) => [pillar, 100]),
    );
    for (const recommendation of evidence.records) {
      const pillar = pillarFor(recommendation);
      if (!pillar) continue;
      const penalty =
        IMPACT_PENALTY[recommendation.impact.trim().toLowerCase()] ?? 10;
      scores.set(pillar, Math.max(0, (scores.get(pillar) ?? 100) - penalty));
    }

    return {
      indicators: PILLARS.map((name) => ({ name, max: 100 })),
      series: [
        {
          name: "Advisor export snapshot",
          values: PILLARS.map((pillar) => scores.get(pillar) ?? 100),
          color: "#38bdf8",
        },
      ],
    };
  } catch (error) {
    console.error("[customer-waf-radar] failed to load Advisor evidence:", error);
    return null;
  }
}
