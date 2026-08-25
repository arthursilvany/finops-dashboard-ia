import type {
  SkuAdvisorLever,
  SkuAdvisorPayload,
  SkuAdvisorRecommendation,
} from "./sku-advisor-contract";

/**
 * Pure mappers from the raw advisor payload to the view models rendered by
 * `/sku-advisor`.
 *
 * Both data sources (the live service and a `recommendations.json` export)
 * carry the identical shape, so every figure on the page is produced here and
 * nowhere else. The advisor already did the arithmetic — these functions
 * select and label, they never re-derive savings, so the page can never
 * disagree with the advisor's own report.
 */

export interface SkuAdvisorKpi {
  currency: string;
  monthlySavings: number;
  annualSavings: number;
  currentMonthly: number;
  projectedMonthly: number;
  effectiveSavingsRatePct: number;
  workloadsEvaluated: number;
  recommendationsCount: number;
  savingsThresholdPct: number;
  pricingBasis: string;
  generatedAt: string;
}

export interface SkuAdvisorRow extends Record<string, unknown> {
  currentSize: string;
  recommendedSize: string;
  region: string;
  count: number;
  currentMonthly: number;
  recommendedMonthly: number;
  monthlySavings: number;
  annualSavings: number;
  savingsPct: number;
  track: string;
  compatRisk: string;
  actionability: string;
  workloadType: string;
  osType: string;
  headline: string;
  blocked: boolean;
}

export interface SkuAdvisorLeverRow extends Record<string, unknown> {
  key: string;
  label: string;
  evaluated: boolean;
  monthlySavings: number;
  annualSavings: number;
  countedMonthly: number;
  workloads: number;
  note: string;
}

export interface SkuAdvisorLifecycle {
  retiringWorkloads: number;
  retiringVms: number;
  retiringMonthly: number;
  previousGenWorkloads: number;
  previousGenVms: number;
  previousGenMonthly: number;
  retiringTargets: number;
  retiringTargetVms: number;
  /** Monthly spend on the exposed SKU series. */
  exposureMonthly: number;
  catalogSource: string;
  items: SkuAdvisorLifecycleItem[];
}

export interface SkuAdvisorLifecycleItem extends Record<string, unknown> {
  series: string;
  status: string;
  retirementDate: string;
  vms: number;
  monthly: number;
  source: string;
  /** False when the date comes from the curated catalog rather than a live notice. */
  liveConfirmed: boolean;
}

export interface SkuAdvisorCapacity {
  /** False when the advisor never ran the capacity/quota pass at all. */
  checked: boolean;
  checkedWorkloads: number;
  available: number;
  restricted: number;
  notOffered: number;
  quotaBlocked: number;
  unknown: number;
  quotaBlockedWorkloads: number;
  quotaBlockedMonthlySavings: number;
  blockers: SkuAdvisorBlocker[];
}

export interface SkuAdvisorBlocker extends Record<string, unknown> {
  currentSize: string;
  recommendedSize: string;
  region: string;
  reason: string;
  detail: string;
  monthlySavingsAtRisk: number;
}

const LEVER_LABELS: Record<string, string> = {
  disks: "Managed disks",
  idle: "Idle & stopped VMs",
  commitment: "Reservations & savings plans",
  spot: "Spot eligibility",
  schedule: "Scheduled shutdown",
};

/** Coerces the advisor's nullable numerics to a renderable number. */
function n(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function s(value: string | null | undefined, fallback = ""): string {
  return typeof value === "string" && value !== "" ? value : fallback;
}

export function selectKpi(payload: SkuAdvisorPayload): SkuAdvisorKpi {
  const summary = payload.summary;
  return {
    currency: s(summary.currency, "USD"),
    monthlySavings: n(summary.total_monthly_savings),
    annualSavings: n(summary.total_annual_savings),
    currentMonthly: n(summary.total_current_monthly),
    projectedMonthly: n(summary.total_projected_monthly),
    effectiveSavingsRatePct: n(summary.effective_savings_rate_pct),
    workloadsEvaluated: n(summary.workloads_evaluated),
    recommendationsCount: n(summary.recommendations_count),
    savingsThresholdPct: n(summary.savings_threshold_pct),
    pricingBasis: s(summary.pricing_basis, "unknown"),
    generatedAt: s(payload.generated_at),
  };
}

/**
 * A recommendation is blocked when the advisor could not clear quota or found
 * the target SKU unavailable. Those rows still carry savings, so the table
 * flags them instead of hiding them — an unreachable saving presented as
 * actionable is exactly what erodes trust in a FinOps report.
 */
function isBlocked(rec: SkuAdvisorRecommendation): boolean {
  if (rec.quota_ok === false) return true;
  const capacityStatus = capacityStatusOf(rec);
  return capacityStatus === "quota_blocked" || capacityStatus === "not_offered";
}

function capacityStatusOf(rec: SkuAdvisorRecommendation): string {
  const capacity = rec.capacity;
  if (!capacity) return "";
  const status = (capacity as Record<string, unknown>).status;
  return typeof status === "string" ? status : "";
}

export function selectRecommendations(
  payload: SkuAdvisorPayload,
): SkuAdvisorRow[] {
  return payload.recommendations
    .map((rec) => ({
      currentSize: rec.current_size,
      recommendedSize: s(rec.recommended_size, "—"),
      region: s(rec.region, "—"),
      count: n(rec.count),
      currentMonthly: n(rec.current_monthly),
      recommendedMonthly: n(rec.recommended_monthly),
      monthlySavings: n(rec.monthly_savings),
      annualSavings: n(rec.annual_savings),
      savingsPct: n(rec.savings_pct),
      track: s(rec.track, "rightsizing"),
      compatRisk: s(rec.compat_risk, "unknown"),
      actionability: s(rec.actionability, "—"),
      workloadType: s(rec.workload_type, "—"),
      osType: s(rec.os_type, "—"),
      headline: s(rec.headline),
      blocked: isBlocked(rec),
    }))
    .sort((a, b) => b.monthlySavings - a.monthlySavings);
}

export function selectLevers(payload: SkuAdvisorPayload): SkuAdvisorLeverRow[] {
  const summary = payload.summary;
  const tracks = summary.savings_by_track ?? {};

  // Track workload counts are keyed by track name, levers by block name. Map
  // the two vocabularies so each lever can show how many workloads it touches.
  const trackForLever: Record<string, string> = {
    disks: "storage",
    idle: "decommission",
    schedule: "schedule",
    commitment: "commitment",
    spot: "spot",
  };

  return Object.entries(LEVER_LABELS).map(([key, label]) => {
    const lever = summary[key as keyof typeof summary] as
      | SkuAdvisorLever
      | null
      | undefined;
    const track = tracks[trackForLever[key] ?? key];

    return {
      key,
      label,
      evaluated: lever?.evaluated === true,
      monthlySavings: n(lever?.monthly_savings),
      annualSavings: n(lever?.annual_savings),
      // What the advisor actually added to the headline total: a lever can
      // compute a saving and then defer it to another track to avoid
      // double-counting the same VM.
      countedMonthly:
        typeof lever?.counted_in_total_monthly === "number"
          ? lever.counted_in_total_monthly
          : n(lever?.monthly_savings),
      workloads: n(track?.workloads),
      note: s(lever?.reason) || s(lever?.source),
    };
  });
}

export function selectLifecycle(
  payload: SkuAdvisorPayload,
): SkuAdvisorLifecycle {
  const summary = payload.summary;

  // The advisor reports exposure as one entry per affected SKU series. When
  // that list is absent (older export), fall back to the per-recommendation
  // lifecycle block and collapse it to the same series-level shape, so the
  // table means the same thing either way.
  const items =
    (summary.lifecycle_exposure ?? []).length > 0
      ? (summary.lifecycle_exposure ?? []).map((entry) => ({
          series: s(entry.series, "—"),
          status: s(entry.status, "—"),
          retirementDate: s(entry.retirement_date, "—"),
          vms: n(entry.vms),
          monthly: n(entry.current_monthly),
          source: s(entry.source, "—"),
          liveConfirmed: entry.live_confirmed === true,
        }))
      : exposureFromRecommendations(payload);

  return {
    retiringWorkloads: n(summary.lifecycle_retiring_workloads),
    retiringVms: n(summary.lifecycle_retiring_vms),
    retiringMonthly: n(summary.lifecycle_retiring_monthly),
    previousGenWorkloads: n(summary.lifecycle_previous_gen_workloads),
    previousGenVms: n(summary.lifecycle_previous_gen_vms),
    previousGenMonthly: n(summary.lifecycle_previous_gen_monthly),
    retiringTargets: n(summary.lifecycle_retiring_targets),
    retiringTargetVms: n(summary.lifecycle_retiring_target_vms),
    exposureMonthly: items.reduce((total, item) => total + item.monthly, 0),
    catalogSource: s(
      summary.lifecycle_catalog_source,
      s(summary.lifecycle_source, "—"),
    ),
    items: items.sort((a, b) => b.monthly - a.monthly),
  };
}

/** Series-level exposure rebuilt from per-recommendation lifecycle blocks. */
function exposureFromRecommendations(
  payload: SkuAdvisorPayload,
): SkuAdvisorLifecycleItem[] {
  const bySeries = new Map<string, SkuAdvisorLifecycleItem>();

  for (const rec of payload.recommendations) {
    const current = rec.lifecycle?.current;
    const status = s(current?.status);
    // "current" means the SKU is healthy: only exposure belongs here.
    if (status === "" || status === "current") continue;

    const series = s(current?.series, rec.current_size);
    const existing = bySeries.get(series);
    if (existing) {
      existing.vms += n(rec.count);
      existing.monthly += n(rec.current_monthly);
      continue;
    }

    bySeries.set(series, {
      series,
      status,
      retirementDate: s(current?.retirement_date, "—"),
      vms: n(rec.count),
      monthly: n(rec.current_monthly),
      source: "recommendations",
      liveConfirmed: false,
    });
  }

  return Array.from(bySeries.values());
}

export function selectCapacity(payload: SkuAdvisorPayload): SkuAdvisorCapacity {
  const summary = payload.summary;

  const blockers = payload.recommendations
    .filter(isBlocked)
    .map((rec) => {
      const capacityStatus = capacityStatusOf(rec);
      const reason =
        rec.quota_ok === false ? "quota" : capacityStatus || "capacity";
      const capacityNote = rec.capacity
        ? (rec.capacity as Record<string, unknown>).note
        : undefined;

      return {
        currentSize: rec.current_size,
        recommendedSize: s(rec.recommended_size, "—"),
        region: s(rec.region, "—"),
        reason,
        detail:
          s(rec.quota_note) ||
          (typeof capacityNote === "string" ? capacityNote : "") ||
          "No detail reported by the advisor.",
        monthlySavingsAtRisk: n(rec.monthly_savings),
      };
    })
    .sort((a, b) => b.monthlySavingsAtRisk - a.monthlySavingsAtRisk);

  return {
    // `capacity_checked_workloads` is absent when the advisor was never asked
    // to run the capacity pass. That is not the same as "checked and found
    // nothing", and the panel must not present it as an all-clear.
    checked: summary.capacity_checked_workloads !== undefined &&
      summary.capacity_checked_workloads !== null,
    checkedWorkloads: n(summary.capacity_checked_workloads),
    available: n(summary.capacity_available_count),
    restricted: n(summary.capacity_restricted_count),
    notOffered: n(summary.capacity_not_offered_count),
    quotaBlocked: n(summary.capacity_quota_blocked_count),
    unknown: n(summary.capacity_unknown_count),
    quotaBlockedWorkloads: n(summary.quota_blocked_workloads),
    quotaBlockedMonthlySavings: n(summary.quota_blocked_monthly_savings),
    blockers,
  };
}
