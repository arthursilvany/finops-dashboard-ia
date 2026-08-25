/**
 * Forwardable Markdown export.
 *
 * This is the artefact that survives the meeting: it gets pasted into a ticket,
 * a wiki page or an email and read by someone who never saw the dashboard. So
 * it carries its own caveats, its own window and its own provenance — a table
 * of rates with the qualifications stripped off is worse than no table, because
 * it looks like a decision that has already been made.
 */

import type { CloudProvider } from "../customer-data/contract";
import type { MulticloudNarrative } from "./contract";
import { STANDING_CAVEATS } from "./narrative";
import {
  CANONICAL_UNIT_LABELS,
  COMMITMENT_TERM_LABELS,
  SCORE_INDEX_LABELS,
  UNOBSERVED_REASON_LABELS,
  type CommitmentTerm,
  type MulticloudFacts,
} from "./types";

const TERMS: CommitmentTerm[] = ["on-demand", "1-year", "3-year"];

function rate(value: number): string {
  // Four decimals: unit rates live between $0.0008 (a GiB-month of cool blob)
  // and $4 (a GPU-hour), and two decimals would round the storage rows to zero.
  return value.toFixed(4);
}

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function cellText(
  facts: MulticloudFacts,
  archetypeIndex: number,
  provider: CloudProvider,
  term: CommitmentTerm,
): string {
  const cell = facts.archetypes[archetypeIndex]?.cells[provider]?.[term];
  if (!cell) return "_Not observed_";
  if (!cell.observed) return `_${UNOBSERVED_REASON_LABELS[cell.reason]}_`;
  return rate(cell.rate);
}

/**
 * Renders the whole comparison as Markdown.
 *
 * Every number here is read from `facts`. Nothing is computed at render time,
 * which is why the export can never disagree with the screen.
 */
export function renderMulticloudMarkdown(
  facts: MulticloudFacts,
  options: { narrative?: MulticloudNarrative | null; customerName?: string } = {},
): string {
  const lines: string[] = [];
  const providers = facts.providersCompared;

  lines.push("# Multicloud cost-benefit comparison");
  lines.push("");
  if (options.customerName) lines.push(`**Customer:** ${options.customerName}  `);
  lines.push(
    `**Period:** ${facts.window.from} to ${facts.window.toExclusive} (exclusive)  `,
  );
  lines.push(`**Currency:** ${facts.currency}  `);
  lines.push(
    `**Providers compared:** ${providers.length > 0 ? providers.join(", ") : "none"}  `,
  );
  lines.push(
    `**Coverage:** ${facts.coverage.observedCells} of ${facts.coverage.totalCells} ` +
      `cells observed (${Math.round(facts.coverage.ratio * 100)}%)`,
  );
  lines.push("");

  if (facts.window.clipped) {
    lines.push(
      "> The period was clipped to the span where all compared providers have " +
        "data. Comparing unequal windows would report an onboarding date as a " +
        "price difference.",
    );
    lines.push("");
  }

  if (facts.insufficientForRecommendation) {
    lines.push(`> **No recommendation.** ${facts.insufficientForRecommendation}`);
    lines.push("");
  }

  if (options.narrative) {
    lines.push("## Summary");
    lines.push("");
    lines.push(options.narrative.summary);
    lines.push("");
    if (options.narrative.tradeoffs.length > 0) {
      lines.push("### Trade-offs");
      lines.push("");
      for (const tradeoff of options.narrative.tradeoffs) {
        lines.push(`- ${tradeoff}`);
      }
      lines.push("");
    }
    lines.push("### Recommendation");
    lines.push("");
    lines.push(options.narrative.recommendation);
    lines.push("");
  }

  if (facts.scores.length > 0) {
    lines.push("## Composite score");
    lines.push("");
    lines.push(
      "Higher is better. An index with no data for every compared provider is " +
        "excluded and the remaining weights are renormalized, so a score never " +
        "assumes a neutral value it did not measure.",
    );
    lines.push("");
    lines.push("| Provider | Score | Indices used |");
    lines.push("| --- | ---: | --- |");
    for (const score of facts.scores) {
      const used = score.participatingIndices
        .map((id) => SCORE_INDEX_LABELS[id])
        .join(", ");
      lines.push(
        `| ${score.provider} | ${score.score.toFixed(1)} | ${used || "—"} |`,
      );
    }
    lines.push("");
    lines.push(
      "Weights: " +
        (Object.keys(facts.weights) as Array<keyof typeof facts.weights>)
          .map((id) => `${SCORE_INDEX_LABELS[id]} ${Math.round(facts.weights[id] * 100)}%`)
          .join(", "),
    );
    lines.push("");
  }

  lines.push("## Unit rates by workload");
  lines.push("");

  for (let index = 0; index < facts.archetypes.length; index += 1) {
    const archetype = facts.archetypes[index];
    lines.push(`### ${archetype.label}`);
    lines.push("");
    lines.push(`Unit: ${CANONICAL_UNIT_LABELS[archetype.unit]} · ${facts.currency}`);
    lines.push("");

    const header = ["Term", ...providers];
    lines.push(`| ${header.join(" | ")} |`);
    lines.push(`| --- |${providers.map(() => " ---: |").join("")}`);

    for (const term of TERMS) {
      const cells = providers.map((p) => cellText(facts, index, p, term));
      lines.push(`| ${COMMITMENT_TERM_LABELS[term]} | ${cells.join(" | ")} |`);
    }
    lines.push("");

    if (archetype.cheapestProvider) {
      lines.push(
        `Cheapest on-demand: **${archetype.cheapestProvider}** ` +
          `(spread ${percent(archetype.spread)}).`,
      );
      lines.push("");
    }

    const equivalence = Object.entries(archetype.equivalence);
    if (equivalence.length > 0) {
      // The equivalence claim travels with the numbers. Someone forwarded this
      // table needs to be able to disagree with the mapping, and they can only
      // do that if they can see it.
      lines.push(
        "Taken to mean: " +
          equivalence.map(([p, label]) => `${p} — ${label}`).join("; ") +
          ".",
      );
      lines.push("");
    }
  }

  lines.push("## Caveats");
  lines.push("");
  for (const caveat of options.narrative?.caveats ?? STANDING_CAVEATS) {
    lines.push(`- ${caveat}`);
  }
  lines.push("");

  if (facts.references.length > 0) {
    lines.push("## Reference data");
    lines.push("");
    for (const ref of facts.references) {
      lines.push(`- **${ref.name}** — captured ${ref.capturedAt}. ${ref.note}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
