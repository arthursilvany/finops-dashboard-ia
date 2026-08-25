import type { StakeholderCard, StakeholderCardsPayload } from "./types";

/**
 * Markdown rendering — one file per persona.
 *
 * This is where the feature adds value: you send **one** card to each
 * stakeholder rather than the entire report. Each file must therefore be
 * self-contained.
 */

function slugOf(card: StakeholderCard): string {
  return `${card.persona}.md`;
}

function renderCard(
  card: StakeholderCard,
  payload: StakeholderCardsPayload,
): string {
  const lines: string[] = [];

  lines.push(`# ${card.title}`);
  lines.push("");
  lines.push(`> **${card.question}**`);
  lines.push("");
  lines.push(`_${card.focus}_`);
  lines.push("");
  lines.push(card.headline);
  lines.push("");

  lines.push("## Numbers");
  lines.push("");
  lines.push("| Metric | Value | Meaning |");
  lines.push("|---|---|---|");
  for (const metric of card.metrics) {
    lines.push(
      `| ${metric.label} | ${metric.value} | ${metric.tip.replace(/\|/g, "\\|")} |`,
    );
  }
  lines.push("");

  lines.push("## Why it matters");
  lines.push("");
  lines.push(card.whyItMatters);
  lines.push("");

  lines.push("## Next action");
  lines.push("");
  lines.push(card.nextAction);
  lines.push("");

  lines.push("## Caveats");
  lines.push("");
  for (const caveat of card.caveats) {
    lines.push(`- ${caveat}`);
  }
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push(
    `Generated at ${payload.generatedAtUtc} · currency ${payload.currency} · ` +
      `schema ${payload.schemaVersion}.`,
  );

  const refinement = payload.refinement?.log.find(
    (entry) => entry.persona === card.persona,
  );
  if (refinement && refinement.state !== "deterministic") {
    lines.push("");
    lines.push(
      refinement.state === "refined"
        ? `Text refined by AI (${payload.refinement?.model}); numbers and caveats remain deterministic.`
        : `AI refinement was rejected by guardrail \`${refinement.failedGuardrail}\` (${refinement.reason}). This card uses deterministic text.`,
    );
  }

  return lines.join("\n");
}

/**
 * The README is required: without it, five files look like five divergent
 * analyses rather than five perspectives on the same fact.
 */
function renderReadme(payload: StakeholderCardsPayload): string {
  const lines: string[] = [];

  lines.push("# README — Stakeholder Cards");
  lines.push("");
  lines.push(
    payload.customerName
      ? `Customer: **${payload.customerName}**. Generated at ${payload.generatedAtUtc}.`
      : `**Demo** data — no real customer. Generated at ${payload.generatedAtUtc}.`,
  );
  lines.push("");
  lines.push(
    `This package contains ${payload.cards.length} files. They are **not** ${payload.cards.length} analyses.`,
  );
  lines.push("");
  lines.push(
    "They are views of the **same** verified facts, one for each decision-making role. " +
      "Each card answers the question that person actually asks and includes only the " +
      "metrics that answer it.",
  );
  lines.push("");
  lines.push(
    "A card **reframes and never recalculates**: every value is read from a verified field " +
      "and only formatted. If two cards disagree on a number, it is a bug — not an opinion.",
  );
  lines.push("");

  lines.push("## Files");
  lines.push("");
  for (const card of payload.cards) {
    lines.push(`- \`${slugOf(card)}\` — ${card.title}: ${card.question}`);
  }
  lines.push("");

  lines.push("## Collection coverage");
  lines.push("");
  lines.push(
    "A missing layer appears as **not assessed**, never as 'no risk'. " +
      "Absence of evidence is not evidence of absence.",
  );
  lines.push("");
  lines.push("| Layer | Status |");
  lines.push("|---|---|");
  lines.push(
    `| Cost Export | ${payload.coverage.costExport ? "Assessed" : "Not assessed"} |`,
  );
  lines.push(
    `| Governance | ${payload.coverage.governance ? "Assessed" : "Not assessed"} |`,
  );
  lines.push(
    `| Anomalies | ${payload.coverage.anomalies ? "Assessed" : "Not assessed"} |`,
  );
  lines.push(
    `| Commitments | ${payload.coverage.commitments ? "Assessed" : "Not assessed"} |`,
  );
  lines.push("");

  if (payload.coverage.limitations.length > 0) {
    lines.push("### Declared limitations");
    lines.push("");
    for (const limitation of payload.coverage.limitations) {
      lines.push(`- ${limitation}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(
    `Generated at ${payload.generatedAtUtc} · currency ${payload.currency}` +
      (payload.scope ? ` · Application Owner scope: ${payload.scope}` : ""),
  );

  return lines.join("\n");
}

export interface MarkdownFile {
  name: string;
  content: string;
}

/** One file per persona, plus the README. */
export function renderStakeholderMarkdown(
  payload: StakeholderCardsPayload,
): MarkdownFile[] {
  return [
    { name: "README.md", content: renderReadme(payload) },
    ...payload.cards.map((card) => ({
      name: slugOf(card),
      content: renderCard(card, payload),
    })),
  ];
}

/**
 * Concatenates files into one document for a download without a zip archive.
 * The separator names each file so the package remains separable.
 */
export function renderStakeholderMarkdownBundle(
  payload: StakeholderCardsPayload,
): string {
  return renderStakeholderMarkdown(payload)
    .map((file) => `<!-- ===== ${file.name} ===== -->\n\n${file.content}`)
    .join("\n\n\n");
}
