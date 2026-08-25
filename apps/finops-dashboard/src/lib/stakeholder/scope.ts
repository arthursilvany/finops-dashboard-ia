import type { IdleResource, SubscriptionCost } from "../types";
import type { ScopeRollup } from "./types";

/**
 * Scope (subscription) rollup for the Application Owner card.
 *
 * A subset can **describe** a workload but can never **relax** a verified
 * worst-case floor. This rollup therefore slices only per-resource quantities
 * (cost and idleness). Coverage, compliance, and anomalies remain at the
 * corporate level and are **inherited** by the card.
 */
export function buildScopeRollups(
  subscriptions: SubscriptionCost[],
  idle: IdleResource[],
): ScopeRollup[] {
  const idleBySubscription = new Map<
    string,
    { count: number; monthlyCost: number }
  >();

  for (const resource of idle) {
    const key = resource.subscriptionName;
    const bucket = idleBySubscription.get(key) ?? { count: 0, monthlyCost: 0 };
    bucket.count += 1;
    bucket.monthlyCost += resource.monthlyCost;
    idleBySubscription.set(key, bucket);
  }

  return subscriptions
    .map((subscription) => {
      const bucket = idleBySubscription.get(subscription.subscriptionName);
      return {
        subscriptionName: subscription.subscriptionName,
        cost: subscription.cost,
        sharePercent: subscription.percentage,
        idleCount: bucket?.count ?? 0,
        idleMonthlyCost: Math.round((bucket?.monthlyCost ?? 0) * 100) / 100,
      };
    })
    .sort((a, b) => b.cost - a.cost);
}

/**
 * Resolves the requested scope. Without an explicit request, uses the largest
 * one because it is the slice most likely to have facts supporting the card.
 */
export function resolveScope(
  scopes: ScopeRollup[],
  requested: string | null,
): ScopeRollup | null {
  if (scopes.length === 0) return null;
  if (!requested) return scopes[0];

  const wanted = requested.trim().toLowerCase();
  return (
    scopes.find((s) => s.subscriptionName.toLowerCase() === wanted) ?? scopes[0]
  );
}
