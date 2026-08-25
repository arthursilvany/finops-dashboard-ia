import type { SanitizedAssessmentFacts } from "./customer-narrative-contract";

/**
 * Numbers up to this value are treated as generic ordinals or time units
 * (quarters, months, zones, priority ranks) instead of customer measurements.
 */
const GENERIC_NUMBER_CEILING = 12;

const NUMBER_PATTERN =
  /(?<![A-Za-z0-9])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?(%|k|m|bn|b)?(?![A-Za-z0-9%])/gi;

const SUFFIX_MULTIPLIER: Record<string, number> = {
  k: 1_000,
  m: 1_000_000,
  b: 1_000_000_000,
  bn: 1_000_000_000,
};

const WEAK_COMMITMENT_PATTERNS = [
  /\bwhat do you think\b/i,
  /\blet'?s think\b/i,
  /\bjust a suggestion\b/i,
  /\bas a suggestion\b/i,
  /\bwe could consider\b/i,
  /\bmaybe we\b/i,
  /\bfeel free to\b/i,
  /\bif you want\b/i,
  /\bat your convenience\b/i,
];

const ASSERTIVE_OPENERS = [
  /^my recommendation is\b/i,
  /^the (suggested|recommended) next step is\b/i,
  /^can we\b/i,
  /^who (should|needs to)\b/i,
  /^which\b/i,
  /^shall we\b/i,
  /^does it make sense to\b/i,
  /^is there any reason not to\b/i,
];

export interface AllowedNumbers {
  values: number[];
  percentages: number[];
}

function push(target: number[], value: number | undefined | null): void {
  if (typeof value !== "number" || !Number.isFinite(value)) return;
  target.push(Math.abs(value));
}

function ratio(part: number, total: number): number | null {
  if (!total) return null;
  return (part / total) * 100;
}

export function buildAllowedNumbers(
  facts: SanitizedAssessmentFacts,
): AllowedNumbers {
  const values: number[] = [];
  const percentages: number[] = [];

  push(values, facts.cost.periodDays);
  push(values, facts.cost.totalEffectiveCost);

  let topServicesCost = 0;
  let topServicesPercentage = 0;
  for (const service of facts.cost.topServices) {
    push(values, service.cost);
    push(percentages, service.percentage);
    topServicesCost += service.cost;
    topServicesPercentage += service.percentage;
  }
  push(values, topServicesCost);
  push(percentages, topServicesPercentage);

  let inventoryCount = 0;
  for (const item of facts.inventory) {
    push(values, item.count);
    inventoryCount += item.count;
  }
  push(values, inventoryCount);

  let advisorCount = 0;
  let advisorSavings = 0;
  for (const item of facts.advisor) {
    push(values, item.count);
    advisorCount += item.count;
    if (typeof item.annualSavings === "number") {
      push(values, item.annualSavings);
      advisorSavings += item.annualSavings;
    }
  }
  push(values, advisorCount);
  push(values, advisorSavings);

  const policy = facts.governance.policyStates;
  push(values, policy.total);
  push(values, policy.compliant);
  push(values, policy.nonCompliant);
  push(values, policy.unknown);
  push(percentages, ratio(policy.nonCompliant, policy.total));
  push(percentages, ratio(policy.compliant, policy.total));

  const security = facts.security.assessments;
  push(values, security.total);
  push(values, security.unhealthy);
  push(values, security.highSeverity);
  push(percentages, ratio(security.unhealthy, security.total));
  push(percentages, ratio(security.highSeverity, security.total));

  const health = facts.reliability.healthStates;
  push(values, health.total);
  push(values, health.unavailable);
  push(values, health.degraded);
  push(percentages, ratio(health.unavailable, health.total));
  push(percentages, ratio(health.degraded, health.total));

  const backup = facts.reliability.backupSignals;
  push(values, backup.total);
  push(values, backup.unhealthy);
  push(percentages, ratio(backup.unhealthy, backup.total));

  const operations = facts.operations;
  push(values, operations.monitoredResources);
  push(values, operations.inventoryResources);
  push(values, operations.diagnosticSignals);
  push(values, operations.alertSignals);
  push(values, operations.missingCriticalPatches);
  push(values, operations.missingSecurityPatches);
  push(percentages, operations.metricCoveragePercentage);
  push(percentages, 100 - operations.metricCoveragePercentage);

  for (const budget of facts.financialGovernance.budgets) {
    push(values, budget.count);
    push(values, budget.totalAmount);
  }
  push(values, facts.financialGovernance.commitments.recommendationCount);
  for (const commitment of facts.financialGovernance.commitments
    .annualSavingsByCurrency) {
    push(values, commitment.annualSavings);
  }

  return {
    values: Array.from(new Set([...values, ...percentages])).sort((a, b) => a - b),
    percentages: Array.from(new Set([...percentages, 100])).sort((a, b) => a - b),
  };
}

interface ExtractedNumber {
  raw: string;
  value: number;
  isPercentage: boolean;
}

export function extractNumbers(text: string): ExtractedNumber[] {
  const found: ExtractedNumber[] = [];
  const pattern = new RegExp(NUMBER_PATTERN.source, NUMBER_PATTERN.flags);
  let match: RegExpExecArray | null = pattern.exec(text);
  while (match !== null) {
    const parsed = Number.parseFloat(match[1].replace(/,/g, ""));
    if (Number.isFinite(parsed)) {
      const suffix = match[2]?.toLowerCase();
      const isPercentage = suffix === "%";
      const multiplier =
        suffix && !isPercentage ? SUFFIX_MULTIPLIER[suffix] ?? 1 : 1;
      found.push({
        raw: match[0].trim(),
        value: parsed * multiplier,
        isPercentage,
      });
    }
    match = pattern.exec(text);
  }
  return found;
}

function isCalendarYear(value: number): boolean {
  return Number.isInteger(value) && value >= 1900 && value <= 2100;
}

function isTraceable(value: number, allowed: number[]): boolean {
  if (value <= GENERIC_NUMBER_CEILING && Number.isInteger(value)) return true;
  // Calendar years are narration, not measurements.
  if (isCalendarYear(value)) return true;
  return allowed.some((candidate) => {
    const tolerance = Math.max(1, Math.abs(candidate) * 0.05);
    if (Math.abs(value - candidate) <= tolerance) return true;
    // Allow annualization and monthly derivations of a traceable figure.
    const annual = candidate * 12;
    const monthly = candidate / 12;
    return (
      Math.abs(value - annual) <= Math.max(1, Math.abs(annual) * 0.05) ||
      Math.abs(value - monthly) <= Math.max(1, Math.abs(monthly) * 0.05)
    );
  });
}

export interface QuantifiedImpactCandidate {
  title: string;
  businessImpact: string;
}

/**
 * Rejects any figure in `businessImpact` that cannot be traced back to the
 * sanitized aggregate facts. Purely qualitative impact statements are allowed,
 * but `assertNarrativeIsQuantified` still requires the narrative as a whole to
 * carry at least one traceable measurement.
 */
export function assertQuantifiedImpact(
  action: QuantifiedImpactCandidate,
  allowed: AllowedNumbers,
): number {
  const numbers = extractNumbers(action.businessImpact);
  let traceableCount = 0;
  for (const number of numbers) {
    const pool = number.isPercentage ? allowed.percentages : allowed.values;
    if (!isTraceable(number.value, pool)) {
      throw new Error(
        `Narrative action "${action.title}" quantified business impact with "${number.raw}", which is not traceable to the sanitized assessment facts`,
      );
    }
    if (number.value > GENERIC_NUMBER_CEILING && !isCalendarYear(number.value)) {
      traceableCount += 1;
    }
  }
  return traceableCount;
}

export function assertNarrativeIsQuantified(traceableCount: number): void {
  if (traceableCount === 0) {
    throw new Error(
      "Narrative business impact is not quantified: no action cited a measurement from the sanitized assessment facts",
    );
  }
}

/**
 * Enforces Take Control language: the ask must be assertive and must request a
 * decision, validation, or working session from the customer.
 */
export function assertTakeControlCommitment(
  text: string,
  label: string,
): void {
  const normalized = text.trim();
  for (const pattern of WEAK_COMMITMENT_PATTERNS) {
    if (pattern.test(normalized)) {
      throw new Error(
        `${label} uses non-committal language ("${normalized}"); ask for a decision, validation, or working session instead`,
      );
    }
  }

  const isQuestion = normalized.endsWith("?");
  const hasAssertiveOpener = ASSERTIVE_OPENERS.some((pattern) =>
    pattern.test(normalized),
  );
  if (!isQuestion && !hasAssertiveOpener) {
    throw new Error(
      `${label} must close with a concrete ask: phrase it as a question or open with "My recommendation is", "The suggested next step is", "Can we validate", or "Who should"`,
    );
  }
}
