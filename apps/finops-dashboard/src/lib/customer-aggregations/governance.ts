import type {
  BudgetVsActualBar,
  GovernanceKpi,
  TagComplianceBar,
  TagCoverage,
} from "../types";
import { getCustomerAssessment } from "../customer-assessment";
import type { CustomerCostRow } from "../customer-data/contract";
import { lookupTag } from "../customer-data/contract";
import type { AggregationContext } from "./context";
import { groupEntries, round2, sumBy } from "./filters";
import { resolveBudgetAllocation } from "./budgets";

/**
 * In-memory equivalents of `src/lib/queries/governance.ts`.
 *
 * Tag keys are normalized to lower case during ingestion, so the lookups here
 * use the same lower-case keys the KQL reads from the `Tags` dynamic column.
 */

const REQUIRED_TAGS = ["env", "owner", "cost-center"] as const;

function isCompliant(row: CustomerCostRow): boolean {
  return REQUIRED_TAGS.every((tag) => Boolean(lookupTag(row.tags, tag)));
}

/**
 * Coverage of each required tag on its own.
 *
 * `isCompliant` is all-or-nothing, so one tag a customer never adopted takes
 * the headline to zero while three quarters of their spend is in fact tagged.
 * Measured on a real export: env 75.9%, cost-center 74.7% (84.5% of cost),
 * owner 0.8% -> combined 0.8%. Reporting "0% compliance" from that would be
 * read as "you govern nothing", which is both wrong and unrecoverable in a
 * customer meeting. The per-tag split names the gap instead of hiding it.
 */
function tagCoverageFor(rows: CustomerCostRow[]): TagCoverage[] {
  const totalCost = sumBy(rows, (r) => r.effectiveCost);

  return REQUIRED_TAGS.map((tag) => {
    const present = rows.filter((r) => Boolean(lookupTag(r.tags, tag)));
    const presentCost = sumBy(present, (r) => r.effectiveCost);

    return {
      tag,
      pct: rows.length > 0 ? Math.round((present.length / rows.length) * 1000) / 10 : 0,
      costPct: totalCost > 0 ? Math.round((presentCost / totalCost) * 1000) / 10 : 0,
    };
  });
}

function relevantPolicyRows(ctx: AggregationContext) {
  const policyRows = getCustomerAssessment(ctx.customerSlug)?.policy ?? [];
  if (policyRows.length === 0) return [];

  const scopedFilters =
    ctx.filters.subscriptions.length > 0 ||
    ctx.filters.regions.length > 0 ||
    ctx.filters.services.length > 0 ||
    ctx.filters.resourceGroups.length > 0 ||
    ctx.filters.tags.length > 0;

  if (!scopedFilters) return policyRows;

  const resourceIds = new Set(
    ctx.rows
      .map((row) => row.resourceId.trim().toLowerCase())
      .filter(Boolean),
  );
  const requestedSubscriptions = new Set(
    ctx.filters.subscriptions
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );

  return policyRows.filter((row) => {
    const resourceId = row.resourceId.trim().toLowerCase();
    const subscriptionId = row.subscriptionId.trim().toLowerCase();
    return (
      resourceIds.has(resourceId) ||
      requestedSubscriptions.has(subscriptionId)
    );
  });
}

/** Mirrors `governanceKpiKql`. */
export function aggregateGovernanceKpi(
  ctx: AggregationContext,
): GovernanceKpi {
  const total = ctx.rows.length;
  const compliant = ctx.rows.filter(isCompliant).length;
  const policiesActive = new Set(
    relevantPolicyRows(ctx)
      .map((row) => row.policyAssignmentId.trim())
      .filter(Boolean),
  ).size;

  return {
    overallCompliance:
      total > 0 ? Math.round((compliant / total) * 1000) / 10 : 0,
    taggedResources: compliant,
    totalResources: total,
    policiesActive,
    tagCoverage: tagCoverageFor(ctx.rows),
  };
}

/** Mirrors `tagComplianceKql`. */
export function aggregateTagCompliance(
  ctx: AggregationContext,
): TagComplianceBar[] {
  return groupEntries(ctx.rows, (r) => r.subAccountName)
    .map(([subscriptionName, rows]) => {
      const compliant = rows.filter(isCompliant).length;
      return {
        subscriptionName,
        compliancePct: Math.round((compliant / rows.length) * 1000) / 10,
        total: rows.length,
        tagCoverage: tagCoverageFor(rows),
      };
    })
    .sort((a, b) => a.compliancePct - b.compliancePct);
}

/** Mirrors `budgetVsActualKql`. */
export function aggregateBudgetVsActual(
  ctx: AggregationContext,
): BudgetVsActualBar[] {
  const allocation = resolveBudgetAllocation(ctx);
  const actualBySubscription = new Map<string, number>();

  for (const row of ctx.rows) {
    actualBySubscription.set(
      row.subAccountName,
      (actualBySubscription.get(row.subAccountName) ?? 0) + ctx.cost(row),
    );
  }

  const subscriptions = new Set<string>([
    ...Array.from(actualBySubscription.keys()),
    ...Array.from(allocation.bySubscription.keys()),
  ]);

  return Array.from(subscriptions)
    .map((subscriptionName) => {
      const budget = round2(allocation.bySubscription.get(subscriptionName) ?? 0);
      const actual = round2(actualBySubscription.get(subscriptionName) ?? 0);
      return {
        subscriptionName,
        budget,
        actual,
        variance: budget > 0 ? round2(actual - budget) : 0,
      };
    })
    .sort((a, b) => b.actual - a.actual);
}