/**
 * Coverage: turning the gaps in the comparison into something the reader can
 * act on.
 *
 * The honest answer to "which cloud is cheaper?" is frequently "this dataset
 * cannot say". That answer is only useful if it also says what is missing and
 * what to do about it, otherwise the reader concludes the feature is broken
 * rather than that the data is incomplete.
 */

import type { CloudProvider } from "../customer-data/contract";
import type { MulticloudFacts, UnobservedReason } from "./types";

export interface CoverageNotice {
  severity: "info" | "warning";
  title: string;
  detail: string;
}

/** How confident the coverage ratio allows the conclusion to be. */
export function confidenceLabel(ratio: number): string {
  if (ratio >= 0.6) return "High";
  if (ratio >= 0.3) return "Moderate";
  return "Low";
}

const PROVIDER_INGESTION_HINT: Record<string, string> = {
  AWS: "Configure an AWS Data Export in FOCUS 1.0 format and point the FinOps Hub connector at it.",
  GCP: "Enable the BigQuery billing export and the FOCUS view, then connect it to the FinOps Hub.",
  Azure: "Configure a Cost Management export in FOCUS format for the billing account.",
};

/**
 * The notices the UI renders above the matrix.
 *
 * Ordered most-blocking first: a reader who stops after the first line should
 * still have been told the thing that most limits the conclusion.
 */
export function coverageNotices(facts: MulticloudFacts): CoverageNotice[] {
  const notices: CoverageNotice[] = [];

  if (facts.insufficientForRecommendation) {
    const missing = (["AWS", "GCP", "Azure"] as CloudProvider[]).filter(
      (p) => !facts.providersCompared.includes(p),
    );
    const hint = missing
      .map((p) => PROVIDER_INGESTION_HINT[p])
      .filter(Boolean)
      .join(" ");

    notices.push({
      severity: "warning",
      title: "Not enough providers to compare",
      detail: `${facts.insufficientForRecommendation} ${hint}`.trim(),
    });
  }

  if (facts.window.clipped) {
    notices.push({
      severity: "info",
      title: "Comparison clipped to a common period",
      detail:
        `Providers were onboarded at different times, so the comparison covers ` +
        `${facts.window.from} to ${facts.window.toExclusive} — the period every ` +
        `compared provider has data for. Rates outside that window are excluded ` +
        `rather than averaged against a shorter history.`,
    });
  }

  if (facts.providersCompared.length >= 2 && facts.coverage.ratio < 0.3) {
    notices.push({
      severity: "warning",
      title: "Sparse coverage",
      detail:
        `Only ${facts.coverage.observedCells} of ${facts.coverage.totalCells} ` +
        `comparison cells carry an observed rate. The ranking rests on a narrow ` +
        `slice of the estate and should not be read as an estate-wide verdict.`,
    });
  }

  const quantityGaps = new Set<CloudProvider>();
  for (const archetype of facts.archetypes) {
    for (const provider of Object.keys(archetype.cells) as CloudProvider[]) {
      const terms = archetype.cells[provider];
      if (!terms) continue;
      for (const cell of Object.values(terms)) {
        if (!cell.observed && cell.reason === "quantity-missing") {
          quantityGaps.add(provider);
        }
      }
    }
  }

  if (quantityGaps.size > 0) {
    notices.push({
      severity: "info",
      title: "Some meters report cost without quantity",
      detail:
        `${Array.from(quantityGaps).join(", ")} billed for workloads that report ` +
        `no consumed quantity, so no unit rate can be derived from them. Those ` +
        `cells are left empty rather than estimated.`,
    });
  }

  return notices;
}

/** Counts of each reason, for the coverage panel. */
export function gapBreakdown(
  facts: MulticloudFacts,
): Array<{ reason: UnobservedReason; count: number }> {
  const counts = new Map<UnobservedReason, number>();

  for (const archetype of facts.archetypes) {
    for (const terms of Object.values(archetype.cells)) {
      if (!terms) continue;
      for (const cell of Object.values(terms)) {
        if (cell.observed) continue;
        counts.set(cell.reason, (counts.get(cell.reason) ?? 0) + 1);
      }
    }
  }

  return Array.from(counts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}
