/**
 * Stakeholder Cards — types.
 *
 * See `docs/product/prd-stakeholder-cards.md` for the specification.
 *
 * Central invariant: **a card reframes, it never recalculates**. Every metric is
 * read from `StakeholderFacts` — which in turn only holds values produced by the
 * existing aggregators — and is merely formatted.
 */

export type PersonaId =
  | "cfo"
  | "cio"
  | "architect"
  | "procurement"
  | "app-owner";

/** A metric in a card. */
export interface CardMetric {
  label: string;
  /** Already formatted for pt-BR: this is what the human reads. */
  value: string;
  /**
   * Required. An unexplained metric becomes an orphan number in front of the
   * customer, and an orphan number is always read in the speaker's favor.
   */
  tip: string;
  /**
   * Original number for auditing. `null` when the layer was not assessed:
   * absence of evidence is not evidence of absence.
   */
  raw: number | null;
  /**
   * Fact path in `StakeholderFacts` (for example, `savings.commitmentGap`).
   * Makes it possible to prove mechanically that the card invented nothing.
   */
  factPath: string;
}

export interface StakeholderCard {
  persona: PersonaId;
  title: string;
  question: string;
  focus: string;
  /** One sentence. AI-refinable. */
  headline: string;
  /** Two to three sentences. AI-refinable. */
  whyItMatters: string;
  /** Action that THIS person can authorize. AI-refinable. */
  nextAction: string;
  /** IMMUTABLE — AI cannot alter it. */
  metrics: CardMetric[];
  /** IMMUTABLE — AI cannot alter it. */
  caveats: string[];
}

/** Per-card AI refinement state. */
export type RefinementState = "deterministic" | "refined" | "rejected";

export interface CardRefinementLog {
  persona: PersonaId;
  state: RefinementState;
  /** Guardrail that rejected the card when `state === "rejected"`. */
  failedGuardrail?: string;
  reason?: string;
}

export interface CoverageReport {
  costExport: boolean;
  governance: boolean;
  anomalies: boolean;
  commitments: boolean;
  /** Layers that the dashboard cannot assess from the loaded data. */
  limitations: string[];
}

export interface StakeholderCardsPayload {
  schemaVersion: string;
  generatedAtUtc: string;
  currency: string;
  /**
   * Source customer, or `null` in demo mode. It is included in the exported
   * package because two `stakeholder-cards.md` files in Downloads are otherwise
   * indistinguishable.
   */
  customerName: string | null;
  /** Application Owner card scope (subscription name). */
  scope: string | null;
  scopeOptions: string[];
  /**
   * Collection coverage. A missing layer appears in the package and is never
   * treated as an absence of risk.
   */
  coverage: CoverageReport;
  cards: StakeholderCard[];
  /** Present only when AI refinement has run. */
  refinement?: {
    model: string;
    log: CardRefinementLog[];
  };
}

/**
 * A subscription slice.
 *
 * Describes the workload; it **never relaxes** a verified worst-case floor.
 * Coverage and governance conclusions are inherited from the corporate level.
 */
export interface ScopeRollup {
  subscriptionName: string;
  /** Period cost verified by `aggregateCostBySubscription`. */
  cost: number;
  sharePercent: number;
  idleCount: number;
  /**
   * Savings identified in the scope. It comes from idle resources: turning an
   * idle resource off **requires engineering validation**. Commitment savings
   * are corporate and are not allocated by subscription because allocating
   * money is exact only when pricing is per unit.
   */
  idleMonthlyCost: number;
}

/**
 * Verified facts — the single source of truth for cards.
 *
 * ALL arithmetic lives here. Builders only select and format. This separation
 * makes the "no new numbers are created" rule verifiable: the test flattens
 * this object and requires every card's `raw` value to exist in it.
 *
 * `null` means **not assessed**, never zero and never "no risk".
 */
export interface StakeholderFacts {
  currency: string;
  dataSource: "adx" | "customer" | "mock";
  customerName: string | null;
  coverage: CoverageReport;

  cost: {
    total30d: number;
    momChangePercent: number;
    momChangeDelta: number;
    subscriptionCount: number;
    resourceCount: number;
    topSubscription: string;
    topSubscriptionCost: number;
    annualizedRunRate: number;
  };

  savings: {
    /** MODELED at 30% of on-demand cost — an assumption, not a measurement. */
    commitmentGap: number;
    /** MEASURED: spend on resources that are actually idle. */
    idleResources: number;
    /** Verified by `aggregateSavingsSummary`. Buckets are not recombined. */
    totalPotentialMonthly: number;
    totalPotentialAnnual: number;
    /** Split between "ready" and "requires engineering validation" (outcome #4). */
    noPrereqMonthly: number;
    requiresValidationMonthly: number;
    actionCount: number;
    noPrereqActionCount: number;
    requiresValidationActionCount: number;
  };

  esr: {
    effectiveSavingsRate: number;
    totalSavings: number;
    listCost: number;
    effectiveCost: number;
    /** `null` when the source does not report it (ADX path). */
    unusedCommitmentCost: number | null;
  };

  commitment: {
    coveragePercent: number | null;
    onDemandCost: number;
    committedCost: number;
    topGapService: string;
    topGapOnDemandCost: number;
    servicesBelowTarget: number;
  };

  idle: {
    count: number;
    monthlyCost: number;
    topResourceName: string;
    topResourceMonthlyCost: number;
  };

  governance: {
    overallCompliance: number | null;
    taggedResources: number | null;
    totalResources: number | null;
    policiesActive: number | null;
    tagCoveragePercent: number | null;
  };

  anomalies: {
    last7d: number | null;
    last30d: number | null;
    largestDeviation: number | null;
    lastAnomalyDate: string;
  };

  /** Rollup by subscription — basis for the Application Owner card. */
  scopes: ScopeRollup[];
}
