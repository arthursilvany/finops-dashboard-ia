import { personaById } from "./catalog";
import type { PersonaTitleOverrides } from "./catalog";
import {
  formatCount,
  formatCurrency,
  formatPercent,
  formatSignedPercent,
  formatText,
  NAO_AVALIADO,
} from "./format";
import { resolveScope } from "./scope";
import type {
  CardMetric,
  PersonaId,
  ScopeRollup,
  StakeholderCard,
  StakeholderFacts,
} from "./types";

/**
 * Deterministic builders, one per persona.
 *
 * Absolute rule: **no arithmetic here**. Every value comes from
 * `StakeholderFacts` and is only formatted. If a number must be calculated, it
 * belongs in `facts.ts`.
 */

/** Caveat included in every card that cites commitment savings. */
const CAVEAT_COMMITMENT_MODELADO =
  "Commitment savings are MODELED at a fixed 30% discount on on-demand spend. " +
  "A cost export does not include reservation prices: confirmation requires the customer's price sheet.";

/** PRD outcome #4: "ready" is not "free". */
const CAVEAT_SPLIT_EXECUCAO =
  "Identified savings are not contracted savings: one part does not change architecture, " +
  "and another requires engineering validation. Approving the total as drop-in work authorizes work nobody sized.";

/** Outcome #5: a missing layer is declared. */
function coverageCaveats(facts: StakeholderFacts): string[] {
  return facts.coverage.limitations.map(
    (limitation) => `Collection coverage: ${limitation}`,
  );
}

function metric(
  label: string,
  value: string,
  tip: string,
  raw: number | null,
  factPath: string,
): CardMetric {
  return { label, value, tip, raw, factPath };
}

function assemble(
  persona: PersonaId,
  overrides: PersonaTitleOverrides,
  parts: {
    headline: string;
    whyItMatters: string;
    nextAction: string;
    metrics: CardMetric[];
    caveats: string[];
  },
): StakeholderCard {
  const definition = personaById(persona);
  return {
    persona,
    title: overrides[persona]?.trim() || definition.title,
    question: definition.question,
    focus: definition.focus,
    ...parts,
  };
}

function buildCfoCard(
  facts: StakeholderFacts,
  overrides: PersonaTitleOverrides,
): StakeholderCard {
  const { cost, savings, esr, currency } = facts;

  return assemble("cfo", overrides, {
    headline: `${formatCurrency(savings.totalPotentialAnnual, currency)} per year in identified savings against a run rate of ${formatCurrency(cost.annualizedRunRate, currency)}.`,
    whyItMatters: `The environment currently runs at ${formatCurrency(cost.total30d, currency)} per month, a ${formatSignedPercent(cost.momChangePercent)} change from the previous period. The effective discount already negotiated is ${formatPercent(esr.effectiveSavingsRate)}. Each month of delay leaves ${formatCurrency(savings.totalPotentialMonthly, currency)} unclaimed.`,
    nextAction: `Approve the ${formatCurrency(savings.totalPotentialAnnual, currency)} capture target in the budget cycle, separating the ${formatCurrency(savings.noPrereqMonthly, currency)}/month with no prerequisite from the ${formatCurrency(savings.requiresValidationMonthly, currency)}/month that depends on engineering validation.`,
    metrics: [
      metric(
        "Annualized run rate",
        formatCurrency(cost.annualizedRunRate, currency),
        "Cost from the last 30 days projected over 12 months. It is the baseline against which any savings are a percentage.",
        cost.annualizedRunRate,
        "cost.annualizedRunRate",
      ),
      metric(
        "Month-over-month change",
        formatSignedPercent(cost.momChangePercent),
        "Comparison of the last 30 days with the preceding 30. It measures trend, not efficiency.",
        cost.momChangePercent,
        "cost.momChangePercent",
      ),
      metric(
        "Identified annual savings",
        formatCurrency(savings.totalPotentialAnnual, currency),
        "Annual recurrence of identified monthly savings. Identified is not contracted — see caveats.",
        savings.totalPotentialAnnual,
        "savings.totalPotentialAnnual",
      ),
      metric(
        "Effective Savings Rate",
        formatPercent(esr.effectiveSavingsRate),
        "Effective discount already obtained against list price. It measures what has been negotiated, not what is missing.",
        esr.effectiveSavingsRate,
        "esr.effectiveSavingsRate",
      ),
      metric(
        "Cost of delaying one month",
        formatCurrency(savings.totalPotentialMonthly, currency),
        "Identified monthly savings not captured while the decision is pending.",
        savings.totalPotentialMonthly,
        "savings.totalPotentialMonthly",
      ),
    ],
    caveats: [
      CAVEAT_SPLIT_EXECUCAO,
      CAVEAT_COMMITMENT_MODELADO,
      "Identified savings are not revenue: they reduce future OPEX only after execution.",
      ...coverageCaveats(facts),
    ],
  });
}

function buildCioCard(
  facts: StakeholderFacts,
  overrides: PersonaTitleOverrides,
): StakeholderCard {
  const { idle, commitment, governance, currency } = facts;

  return assemble("cio", overrides, {
    headline: `${formatCount(idle.count, "resources")} continue to incur charges without meaningful use, at ${formatCurrency(idle.monthlyCost, currency)} per month.`,
    whyItMatters: `Commitment coverage is ${formatPercent(commitment.coveragePercent)}, meaning capacity is paid at retail price. Tag compliance is ${formatPercent(governance.overallCompliance)}, and without tags there is no owner — neither to charge nor to turn a resource off. These are two different debts: one is contractual and the other is governance.`,
    nextAction: `Assign an owner and deadline for the ${formatCount(idle.count, "idle resources")} and raise tag compliance above ${formatPercent(governance.tagCoveragePercent)} before the next purchasing cycle.`,
    metrics: [
      metric(
        "Idle resources",
        formatCount(idle.count),
        "Resources billed for at least 25 days with average daily cost below the idle threshold.",
        idle.count,
        "idle.count",
      ),
      metric(
        "Monthly cost tied up in idle resources",
        formatCurrency(idle.monthlyCost, currency),
        "MEASURED spend for these resources — not a model, but an invoice.",
        idle.monthlyCost,
        "idle.monthlyCost",
      ),
      metric(
        "Commitment coverage",
        formatPercent(commitment.coveragePercent),
        "Percentage of consumption covered by reservations or savings plans. Below target means stable capacity is paid as if it were temporary.",
        commitment.coveragePercent,
        "commitment.coveragePercent",
      ),
      metric(
        "Tag compliance",
        formatPercent(governance.overallCompliance),
        "Percentage of resources with required tags. Without tags there is no owner or allocation.",
        governance.overallCompliance,
        "governance.overallCompliance",
      ),
      metric(
        "Active policies",
        formatCount(governance.policiesActive),
        "Number of distinct policies applied. It measures existing control, not compliance.",
        governance.policiesActive,
        "governance.policiesActive",
      ),
    ],
    caveats: [
      "Tag compliance and policies describe control, not availability risk — neither was evaluated against resilience requirements.",
      "Idle is a conclusion about billed cost, not criticality: a low-cost resource may be essential.",
      ...coverageCaveats(facts),
    ],
  });
}

function buildArchitectCard(
  facts: StakeholderFacts,
  overrides: PersonaTitleOverrides,
): StakeholderCard {
  const { savings, idle, anomalies, currency } = facts;

  return assemble("architect", overrides, {
    headline: `${formatCount(savings.requiresValidationActionCount, "actions")} require engineering validation before they can deliver ${formatCurrency(savings.requiresValidationMonthly, currency)} per month.`,
    whyItMatters: `The largest individual item is ${formatText(idle.topResourceName)}, at ${formatCurrency(idle.topResourceMonthlyCost, currency)} per month. In the last 30 days, ${formatCount(anomalies.last30d, "cost anomalies")} were observed, with a maximum deviation of ${formatCurrency(anomalies.largestDeviation, currency)} — a sign of a behavior change, not necessarily a failure.`,
    nextAction: `Size the ${formatCount(savings.requiresValidationActionCount, "actions")} that depend on validation, starting with ${formatText(idle.topResourceName)}, and confirm dependencies before any shutdown.`,
    metrics: [
      metric(
        "Actions pending engineering validation",
        formatCount(savings.requiresValidationActionCount),
        "Actions that change resource state. None are drop-in.",
        savings.requiresValidationActionCount,
        "savings.requiresValidationActionCount",
      ),
      metric(
        "Savings subject to validation",
        formatCurrency(savings.requiresValidationMonthly, currency),
        "Monthly value realized only after engineering confirms it is safe to turn off.",
        savings.requiresValidationMonthly,
        "savings.requiresValidationMonthly",
      ),
      metric(
        "Largest idle resource",
        formatCurrency(idle.topResourceMonthlyCost, currency),
        "Monthly cost of the most expensive idle resource. This is where sizing starts.",
        idle.topResourceMonthlyCost,
        "idle.topResourceMonthlyCost",
      ),
      metric(
        "Anomalies in 30 days",
        formatCount(anomalies.last30d),
        "Days when cost departed from the expected range. Indicates a behavior change to investigate.",
        anomalies.last30d,
        "anomalies.last30d",
      ),
      metric(
        "Largest observed deviation",
        formatCurrency(anomalies.largestDeviation, currency),
        "Maximum difference between actual cost and baseline on a single day.",
        anomalies.largestDeviation,
        "anomalies.largestDeviation",
      ),
    ],
    caveats: [
      "No technical limit (IOPS, quota, regional capacity) was assessed: the analysis uses billed cost, not runtime telemetry.",
      "A cost anomaly is not an incident: detection is statistical over the spend series.",
      ...coverageCaveats(facts),
    ],
  });
}

function buildProcurementCard(
  facts: StakeholderFacts,
  overrides: PersonaTitleOverrides,
): StakeholderCard {
  const { commitment, esr, savings, currency } = facts;

  const unusedText =
    esr.unusedCommitmentCost === null
      ? NAO_AVALIADO
      : formatCurrency(esr.unusedCommitmentCost, currency);

  return assemble("procurement", overrides, {
    headline: `${formatCurrency(commitment.onDemandCost, currency)} of on-demand consumption is in ${formatCount(commitment.servicesBelowTarget, "services")} below the coverage target.`,
    whyItMatters: `There is already ${formatCurrency(commitment.committedCost, currency)} under commitment, and commitment that covered nothing totals ${unusedText}. Before expanding the purchase, ${formatCurrency(savings.idleResources, currency)} per month in idle resources must be cleaned up — buying a discount on waste only locks that waste into a contract.`,
    nextAction: `Clean up the ${formatCurrency(savings.idleResources, currency)}/month in idle resources, then negotiate coverage for ${formatText(commitment.topGapService)}, the largest on-demand block.`,
    metrics: [
      metric(
        "Eligible on-demand consumption",
        formatCurrency(commitment.onDemandCost, currency),
        "Retail-price spend in the analyzed services. It is the negotiation baseline, not savings.",
        commitment.onDemandCost,
        "commitment.onDemandCost",
      ),
      metric(
        "Already under commitment",
        formatCurrency(commitment.committedCost, currency),
        "Spend currently covered by reservations or a savings plan.",
        commitment.committedCost,
        "commitment.committedCost",
      ),
      metric(
        "Services below target",
        formatCount(commitment.servicesBelowTarget),
        "Services with commitment coverage below 80%.",
        commitment.servicesBelowTarget,
        "commitment.servicesBelowTarget",
      ),
      metric(
        "Unused commitment",
        unusedText,
        "Paid commitment that covered no consumption. It is pure waste, has no baseline, and is excluded from ESR.",
        esr.unusedCommitmentCost,
        "esr.unusedCommitmentCost",
      ),
      metric(
        "Waste to remediate before purchasing",
        formatCurrency(savings.idleResources, currency),
        "Measured spend on idle resources. Buying coverage for this consumption contracts the waste.",
        savings.idleResources,
        "savings.idleResources",
      ),
    ],
    caveats: [
      CAVEAT_COMMITMENT_MODELADO,
      "No reservation price was read from the contract: every purchase scenario must be confirmed against the price sheet.",
      ...coverageCaveats(facts),
    ],
  });
}

function buildAppOwnerCard(
  facts: StakeholderFacts,
  overrides: PersonaTitleOverrides,
  scope: ScopeRollup | null,
  scopeIndex: number,
): StakeholderCard {
  const { currency, cost } = facts;

  if (!scope) {
    return assemble("app-owner", overrides, {
      headline:
        "No application scope could be isolated from the loaded data.",
      whyItMatters:
        "Without cost attributed by subscription, it is not possible to say what changes in your application. This is missing data, not an absence of risk: corporate actions still apply and may reach this scope.",
      nextAction:
        "Confirm cost attribution by subscription before assuming nothing changes here.",
      metrics: [
        metric(
          "Available scopes",
          formatCount(cost.subscriptionCount),
          "Subscriptions seen in the period. Without an attributed rollup, the card isolates none.",
          cost.subscriptionCount,
          "cost.subscriptionCount",
        ),
      ],
      caveats: [
        "Scope not assessed — never read this as 'no impact'.",
        ...coverageCaveats(facts),
      ],
    });
  }

  const base = `scopes[${scopeIndex}]`;

  return assemble("app-owner", overrides, {
    headline: `${formatText(scope.subscriptionName)} costs ${formatCurrency(scope.cost, currency)} in the period and contains ${formatCount(scope.idleCount, "idle resources")}.`,
    whyItMatters: `This scope represents ${formatPercent(scope.sharePercent)} of the environment. Actions that affect your application are worth ${formatCurrency(scope.idleMonthlyCost, currency)} per month and are all shutdowns — none is applied without engineering validation and dependency confirmation. Nothing here changes application behavior by itself.`,
    nextAction: `Confirm which of this scope's ${formatCount(scope.idleCount, "idle resources")} can be turned off and under what validation window.`,
    metrics: [
      metric(
        "Cost of my scope",
        formatCurrency(scope.cost, currency),
        `Cost attributed to ${scope.subscriptionName} in the analyzed period.`,
        scope.cost,
        `${base}.cost`,
      ),
      metric(
        "Share of the environment",
        formatPercent(scope.sharePercent),
        "This scope's weight in total cost. It contextualizes priority, not risk.",
        scope.sharePercent,
        `${base}.sharePercent`,
      ),
      metric(
        "Idle resources in scope",
        formatCount(scope.idleCount),
        "Resources in this scope billed without meaningful use.",
        scope.idleCount,
        `${base}.idleCount`,
      ),
      metric(
        "Savings in scope, pending validation",
        formatCurrency(scope.idleMonthlyCost, currency),
        "Monthly value of these resources. It is realized only after engineering validation — not an automatic gain.",
        scope.idleMonthlyCost,
        `${base}.idleMonthlyCost`,
      ),
      metric(
        "Scopes in the environment",
        formatCount(cost.subscriptionCount),
        "Number of subscriptions in the period, to contextualize your slice.",
        cost.subscriptionCount,
        "cost.subscriptionCount",
      ),
    ],
    caveats: [
      "This slice describes your workload; it does not relax any verified conclusion about the environment. Collection coverage, compliance, and technical limits are inherited from the corporate level.",
      "Commitment savings are corporate and were not allocated to this scope: allocation is exact only when pricing is per unit.",
      ...coverageCaveats(facts),
    ],
  });
}

/**
 * Builds the five deterministic cards.
 *
 * Order goes from money to execution, following how decisions move through an
 * organization.
 */
export function buildStakeholderCards(
  facts: StakeholderFacts,
  options: {
    scope?: string | null;
    titleOverrides?: PersonaTitleOverrides;
  } = {},
): { cards: StakeholderCard[]; scope: ScopeRollup | null } {
  const overrides = options.titleOverrides ?? {};
  const scope = resolveScope(facts.scopes, options.scope ?? null);
  const scopeIndex = scope
    ? facts.scopes.findIndex(
        (s) => s.subscriptionName === scope.subscriptionName,
      )
    : -1;

  return {
    cards: [
      buildCfoCard(facts, overrides),
      buildCioCard(facts, overrides),
      buildArchitectCard(facts, overrides),
      buildProcurementCard(facts, overrides),
      buildAppOwnerCard(facts, overrides, scope, scopeIndex),
    ],
    scope,
  };
}
