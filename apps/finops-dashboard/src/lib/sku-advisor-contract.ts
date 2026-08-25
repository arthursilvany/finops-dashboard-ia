import { z } from "zod";

/**
 * Contract for the Azure SKU Advisor payload.
 *
 * The advisor (github.com/arthursilvany/Azure-SKU-Advisor) exposes this exact
 * shape twice: as `recommendations.json` written by its CLI, and as the body of
 * `GET /api/recommendations` on its FastAPI microservice. One schema therefore
 * covers both of this view's data sources.
 *
 * The payload is wide — around sixty summary keys — and it grows on the
 * advisor's release cadence, not ours. So the schema is deliberately permissive:
 * every field this view does not render is optional, objects pass unknown keys
 * through, and numeric fields tolerate `null`. A new advisor field must never
 * turn into a 500 here.
 */

/** Numbers arrive as `null` whenever an axis was not measured in that run. */
const num = z.number().nullable().optional();
const str = z.string().nullable().optional();
const bool = z.boolean().nullable().optional();

/** Per-lever block shared by `disks`, `idle`, `spot`, `schedule`, `commitment`. */
const leverSchema = z
  .object({
    evaluated: bool,
    source: str,
    reason: str,
    monthly_savings: num,
    annual_savings: num,
    counted_in_total_monthly: num,
    deferred_to_other_track_monthly: num,
  })
  .passthrough();

const trackSchema = z
  .object({
    track: str,
    label: str,
    monthly_savings: num,
    workloads: num,
  })
  .passthrough();

const lifecycleStateSchema = z
  .object({
    status: str,
    series: str,
    retirement_date: str,
    days_remaining: num,
    capacity_limited: bool,
    replacement: str,
    migration_guide: str,
  })
  .passthrough();

/**
 * One retiring or previous-generation SKU series the estate still runs on.
 * The advisor reports these as a list, not a single number.
 */
const lifecycleExposureSchema = z
  .object({
    series: str,
    status: str,
    retirement_date: str,
    vms: num,
    current_monthly: num,
    source: str,
    live_confirmed: bool,
  })
  .passthrough();

const summarySchema = z
  .object({
    currency: str,
    os_type: str,
    savings_threshold_pct: num,
    pricing_basis: str,
    workloads_evaluated: num,
    recommendations_count: num,

    total_current_monthly: num,
    total_projected_monthly: num,
    total_monthly_savings: num,
    total_annual_savings: num,
    effective_savings_rate_pct: num,
    // An object describing how the ESR was scoped (estate vs addressable
    // spend), not a label. Kept permissive: the view reads the headline rate
    // from `effective_savings_rate_pct` and does not depend on this breakdown.
    esr_scope: z.record(z.unknown()).nullable().optional(),

    savings_by_track: z.record(trackSchema).nullable().optional(),

    // Capacity and quota blockers.
    quota_blocked_workloads: num,
    quota_blocked_monthly_savings: num,
    capacity_checked_workloads: num,
    capacity_available_count: num,
    capacity_restricted_count: num,
    capacity_not_offered_count: num,
    capacity_quota_blocked_count: num,
    capacity_unknown_count: num,

    // SKU lifecycle exposure.
    lifecycle_retiring_workloads: num,
    lifecycle_retiring_vms: num,
    lifecycle_retiring_monthly: num,
    lifecycle_previous_gen_workloads: num,
    lifecycle_previous_gen_vms: num,
    lifecycle_previous_gen_monthly: num,
    lifecycle_retiring_targets: num,
    lifecycle_retiring_target_vms: num,
    lifecycle_exposure: z.array(lifecycleExposureSchema).nullable().optional(),
    lifecycle_catalog_source: str,
    lifecycle_source: str,

    // Savings levers.
    disks: leverSchema.nullable().optional(),
    idle: leverSchema.nullable().optional(),
    commitment: leverSchema.nullable().optional(),
    spot: leverSchema.nullable().optional(),
    schedule: leverSchema.nullable().optional(),
  })
  .passthrough();

const recommendationSchema = z
  .object({
    current_size: z.string(),
    recommended_size: str,
    region: str,
    count: num,

    current_monthly: num,
    recommended_monthly: num,
    monthly_savings: num,
    annual_savings: num,
    savings_pct: num,

    status: str,
    track: str,
    headline: str,
    workload_type: str,
    os_type: str,
    cluster: str,
    power_state: str,
    architecture: str,
    compat_risk: str,
    compat_note: str,
    actionability: str,
    is_new_sku: bool,

    quota_ok: bool,
    quota_required_cores: num,
    quota_available_cores: num,
    quota_note: str,

    capacity: z.record(z.unknown()).nullable().optional(),
    lifecycle: z
      .object({
        current: lifecycleStateSchema.nullable().optional(),
        target: lifecycleStateSchema.nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

export const skuAdvisorPayloadSchema = z
  .object({
    generated_at: str,
    summary: summarySchema,
    recommendations: z.array(recommendationSchema).default([]),
  })
  .passthrough();

export type SkuAdvisorPayload = z.infer<typeof skuAdvisorPayloadSchema>;
export type SkuAdvisorSummary = z.infer<typeof summarySchema>;
export type SkuAdvisorRecommendation = z.infer<typeof recommendationSchema>;
export type SkuAdvisorLever = z.infer<typeof leverSchema>;
export type SkuAdvisorLifecycleExposure = z.infer<typeof lifecycleExposureSchema>;

/**
 * Parses an advisor payload, returning `null` instead of throwing.
 *
 * A malformed export on disk, or an advisor version that renamed a required
 * field, must degrade to the next data source rather than take the page down.
 */
/**
 * Summary keys the view actually renders figures from.
 *
 * The contract is permissive on purpose — the advisor payload is wide and
 * evolving, and a new field must never 500 this page. But permissiveness has a
 * failure mode: if the advisor renamed every summary key, an empty `summary`
 * would still parse, and the page would show a confident "$0 monthly savings"
 * under a live badge instead of falling back. Requiring one recognizable
 * anchor separates "schema drifted a little" from "we no longer understand
 * this payload at all".
 */
const VIABILITY_ANCHORS = [
  "total_monthly_savings",
  "total_current_monthly",
  "effective_savings_rate_pct",
  "workloads_evaluated",
] as const;

function isViable(payload: SkuAdvisorPayload): boolean {
  const summary = payload.summary as Record<string, unknown>;
  // Presence, not value: the advisor uses `null` for "this axis was not
  // measured", which is a real answer. A renamed schema is different — the key
  // is simply gone — and that is what must fall through.
  return (
    VIABILITY_ANCHORS.some((key) => key in summary) ||
    payload.recommendations.length > 0
  );
}

export function parseSkuAdvisorPayload(value: unknown): SkuAdvisorPayload | null {
  const result = skuAdvisorPayloadSchema.safeParse(value);
  if (!result.success) {
    console.error(
      "[sku-advisor] payload did not match the expected contract:",
      result.error.issues.slice(0, 5),
    );
    return null;
  }
  if (!isViable(result.data)) {
    console.error(
      "[sku-advisor] payload parsed but carries none of the expected summary " +
        "figures; treating it as unusable rather than rendering zeroes.",
    );
    return null;
  }
  return result.data;
}
