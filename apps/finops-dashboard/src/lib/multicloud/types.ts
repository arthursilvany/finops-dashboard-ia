/**
 * Types for the multicloud cost-benefit comparison.
 *
 * `MulticloudFacts` is the single source of truth for this feature. Every
 * number rendered in the UI, written to the Markdown export or quoted by the
 * AI narrative must already exist here, at a declared path. Presentation
 * layers select and format; they never compute.
 *
 * This mirrors the `facts.ts` / `builders.ts` split in `src/lib/stakeholder/`,
 * which exists so that "no new number is invented downstream" is mechanically
 * checkable by a test rather than a matter of reviewer diligence.
 */

import type { CloudProvider } from "../customer-data/contract";

/**
 * The unit a rate is expressed in after normalization.
 *
 * FOCUS `PricingUnit` is vendor-authored free text — "1 Hour", "Hrs", "hour",
 * "100 Hours" all occur — so it cannot be compared across providers directly.
 * Every observation is converted into exactly one of these before any
 * arithmetic happens.
 */
export type CanonicalUnit =
  | "vcpu-hour"
  | "gib-month"
  | "gib-hour"
  | "cluster-hour"
  | "million-requests"
  | "thousand-tokens"
  | "gb-egress"
  | "tb-scanned";

/** Human label for a canonical unit, used by the UI and the Markdown export. */
export const CANONICAL_UNIT_LABELS: Record<CanonicalUnit, string> = {
  "vcpu-hour": "vCPU-hour",
  "gib-month": "GiB-month",
  "gib-hour": "GiB-hour",
  "cluster-hour": "cluster-hour",
  "million-requests": "1M requests",
  "thousand-tokens": "1K tokens",
  "gb-egress": "GB egress",
  "tb-scanned": "TB scanned",
};

/**
 * A comparable class of workload, independent of vendor.
 *
 * The claim that an Azure D-series VM, an EC2 m-series instance and a GCE
 * n2-standard belong to the same archetype is an engineering opinion, not a
 * fact read from the data. It is therefore declared explicitly in
 * `taxonomy.ts`, versioned, and surfaced in the UI so a reader can disagree
 * with it — never inferred by a language model at request time.
 */
export type ArchetypeId =
  | "general-purpose-compute"
  | "object-storage"
  | "managed-kubernetes"
  | "relational-database"
  | "serverless-functions"
  | "data-warehouse"
  | "ai-inference"
  | "network-egress";

/**
 * How the capacity was purchased.
 *
 * These are deliberately coarse. Azure Reservations, AWS Savings Plans and GCP
 * Committed Use Discounts all collapse into `1-year` / `3-year` here because
 * FOCUS reports them under one `PricingCategory`, but they are *not* the same
 * instrument — they differ in scope, flexibility and exchange rights. Anything
 * comparing them must carry the qualitative caveat from
 * `COMMITMENT_COMPARABILITY_CAVEAT`.
 */
export type CommitmentTerm = "on-demand" | "1-year" | "3-year";

export const COMMITMENT_TERM_LABELS: Record<CommitmentTerm, string> = {
  "on-demand": "On-demand",
  "1-year": "1-year commitment",
  "3-year": "3-year commitment",
};

/**
 * Why a comparison is only ever as fair as the instruments behind it.
 *
 * Rendered wherever committed rates are compared across providers. Comparing
 * the rate alone, without this, is misleading: a 3-year Azure Reservation is
 * scoped to a VM family in a region, while an AWS Compute Savings Plan floats
 * across families, regions and even Fargate. The cheaper rate may be the less
 * valuable instrument.
 */
export const COMMITMENT_COMPARABILITY_CAVEAT =
  "Reservations, Savings Plans and Committed Use Discounts are reported under " +
  "one FOCUS pricing category but are different instruments, differing in " +
  "scope, flexibility and exchange rights. Compare the rate together with the " +
  "commitment it locks in, not on price alone.";

/**
 * Why a cell has no rate.
 *
 * A missing cell is never rendered as zero, blank or "—". The reason is
 * carried all the way to the UI, because "we have no AWS data at all" and "we
 * have AWS data but nothing matching this archetype" lead the reader to
 * completely different next actions.
 */
export type UnobservedReason =
  /** No rows at all from this provider in the dataset. */
  | "provider-absent"
  /** Provider present, but no row matched this archetype's FOCUS matchers. */
  | "archetype-absent"
  /** Rows matched, but none in this commitment term. */
  | "term-absent"
  /**
   * Rows matched and carried cost, but reported no usable quantity, so no
   * rate can be derived. Dividing by zero here would manufacture an infinite
   * or absurd unit price out of a reporting gap.
   */
  | "quantity-missing"
  /**
   * Rows exist but fall entirely outside the common comparison window. Using
   * them would compare a month of one cloud against a year of another.
   */
  | "outside-common-window";

export const UNOBSERVED_REASON_LABELS: Record<UnobservedReason, string> = {
  "provider-absent": "No data for this provider",
  "archetype-absent": "No matching workload",
  "term-absent": "Not purchased on this term",
  "quantity-missing": "No quantity reported",
  "outside-common-window": "Outside the common period",
};

/**
 * One provider × archetype × term measurement.
 *
 * A cell is either observed with a rate, or unobserved with a reason. There is
 * no third state, and `rate` is not optional on the observed branch — the
 * discriminated union makes "render a rate that was never measured"
 * unrepresentable rather than merely discouraged.
 */
export type ComparisonCell =
  | {
      observed: true;
      /** Cost per `unit`, in the report currency. */
      rate: number;
      unit: CanonicalUnit;
      /** Total cost behind the rate, in the report currency. */
      cost: number;
      /** Total normalized quantity behind the rate. */
      quantity: number;
      /**
       * Distinct source rows aggregated into this cell. Surfaced because a
       * rate derived from three rows deserves less confidence than one derived
       * from thirty thousand.
       */
      rowCount: number;
      /**
       * Discount against the row's own baseline (list or contracted cost),
       * 0-1. Null when no row in the cell carried a usable baseline.
       */
      discountVsBaseline: number | null;
    }
  | { observed: false; reason: UnobservedReason };

/** One row of the comparison matrix: an archetype across all providers. */
export interface ArchetypeComparison {
  archetypeId: ArchetypeId;
  label: string;
  unit: CanonicalUnit;
  /**
   * The vendor SKU families this archetype was taken to mean, per provider.
   * Shown in the UI so the equivalence claim is auditable at the point of use.
   */
  equivalence: Partial<Record<CloudProvider, string>>;
  /** Cells keyed by provider, then by commitment term. */
  cells: Partial<Record<CloudProvider, Record<CommitmentTerm, ComparisonCell>>>;
  /**
   * Cheapest provider on the on-demand rate, or null when fewer than two
   * providers were observed — with one provider there is nothing to win.
   */
  cheapestProvider: CloudProvider | null;
  /**
   * Rate spread between cheapest and dearest observed provider, 0-1. Null for
   * the same reason as `cheapestProvider`.
   */
  spread: number | null;
}

/** The four indices that make up the composite score. */
export type ScoreIndexId = "price" | "performance" | "sla" | "egress";

export const SCORE_INDEX_LABELS: Record<ScoreIndexId, string> = {
  price: "Price",
  performance: "Performance per unit cost",
  sla: "Published SLA",
  egress: "Egress cost",
};

/** Weights are user-adjustable: an egress-heavy workload scores differently. */
export type ScoreWeights = Record<ScoreIndexId, number>;

/**
 * One index's contribution to a provider's score.
 *
 * `weightApplied` differs from the configured weight whenever some index was
 * excluded for lack of data and the remainder renormalized. Exposing both is
 * what stops a score from looking authoritative while resting on one index.
 */
export interface ScoreComponent {
  indexId: ScoreIndexId;
  /** Normalized 0-100, higher is better. Null when not evaluated. */
  value: number | null;
  weightApplied: number;
  contribution: number;
  /** Present when `value` is null: why this index did not participate. */
  omittedReason?: string;
}

export interface ScoreBreakdown {
  provider: CloudProvider;
  /** Weighted total, 0-100. Higher is better. */
  score: number;
  components: ScoreComponent[];
  /** Indices that actually participated. Never empty when a score exists. */
  participatingIndices: ScoreIndexId[];
}

/**
 * The window every provider is compared over.
 *
 * Providers are onboarded at different times, so a naive average would put
 * three months of AWS against twelve of Azure and call the difference a price
 * gap. The comparison is therefore restricted to the period where all compared
 * providers have data, and that restriction is reported rather than silent.
 */
export interface ComparisonWindow {
  from: string;
  toExclusive: string;
  /** Full observed span per provider, before the intersection was taken. */
  providerSpans: Array<{
    provider: CloudProvider;
    from: string;
    toExclusive: string;
  }>;
  /** True when at least one provider's data was clipped to fit the window. */
  clipped: boolean;
}

/** Provenance of a reference table that is not derived from customer data. */
export interface ReferenceSource {
  name: string;
  /** ISO date the values were captured. */
  capturedAt: string;
  note: string;
}

/**
 * Everything the comparison knows. The single source of truth.
 *
 * Every downstream surface — the matrix, the chart, the Markdown export, the
 * AI narrative — reads from here and only from here.
 */
export interface MulticloudFacts {
  /** Providers with at least one row in the dataset. */
  providersPresent: CloudProvider[];
  /** Providers with at least one observed rate. A subset of the above. */
  providersCompared: CloudProvider[];
  window: ComparisonWindow;
  currency: string;
  archetypes: ArchetypeComparison[];
  scores: ScoreBreakdown[];
  weights: ScoreWeights;
  totalsByProvider: Array<{
    provider: CloudProvider;
    cost: number;
    share: number;
  }>;
  coverage: {
    totalCells: number;
    observedCells: number;
    /** 0-1. Drives how strongly the UI qualifies the conclusion. */
    ratio: number;
  };
  references: ReferenceSource[];
  /**
   * Set when the comparison cannot support a migration recommendation — most
   * commonly a single-provider dataset. The UI renders the matrix regardless,
   * but suppresses any "move to X" conclusion.
   */
  insufficientForRecommendation: string | null;
}
