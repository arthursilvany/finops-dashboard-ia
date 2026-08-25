import type { ParsedFilters } from "@/lib/filter-schema";
import { buildFilterClauses, costColumn } from "@/lib/queries/filter-builder";
import { TAG_ALIASES } from "@/lib/customer-data/contract";

/**
 * Every spelling of a logical tag that a customer plausibly uses.
 *
 * Reading `Tags['cost-center']` literally reports a tenant that spells it
 * `costcenter` as 100% non-compliant. That looks like a governance finding
 * rather than a bug, so it is the worst kind of wrong to put in front of a
 * customer.
 *
 * KQL has no cheap way to canonicalize bag keys without `mv-apply`, and
 * `mv-apply` drops records whose bag is empty — untagged rows would vanish from
 * the denominator and *inflate* compliance, which is the dangerous direction to
 * be wrong in. So the alias list is expanded here into the concrete separator
 * and casing variants instead, and matched with set operations that leave the
 * row count untouched.
 */
function tagKeyVariants(logicalTag: keyof typeof TAG_ALIASES): string[] {
  const aliases = TAG_ALIASES[logicalTag] ?? [logicalTag];
  const variants = new Set<string>();

  for (const alias of aliases) {
    const words = alias.split(/[^a-zA-Z0-9]+/).filter(Boolean);
    for (const sep of ["-", "_", "", " "]) {
      const joined = words.join(sep);
      variants.add(joined.toLowerCase());
      variants.add(joined.toUpperCase());
      // Title case per word, the spelling portals tend to produce.
      variants.add(words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(sep));
      // camelCase, common when tags are applied from code.
      variants.add(
        words
          .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
          .join(sep),
      );
    }
  }

  return Array.from(variants).sort();
}

/**
 * True when the row carries any spelling of the tag. `set_intersect` over
 * `bag_keys` keeps every row, including rows with no tags at all.
 */
function hasTagExpr(logicalTag: keyof typeof TAG_ALIASES): string {
  const set = tagKeyVariants(logicalTag)
    .map((v) => `"${v}"`)
    .join(", ");
  return `array_length(set_intersect(_tagKeys, dynamic([${set}]))) > 0`;
}

/** Projects the tag keys once so each check does not re-parse the bag. */
const TAG_KEYS = `| extend _tagKeys = bag_keys(todynamic(Tags))`;

// Overall governance KPI — tag compliance across all resources
export function governanceKpiKql(filters: ParsedFilters): string {
  const where = buildFilterClauses(filters);
  const cost = costColumn(filters.currency);
  return `
Costs()
| ${where ? `where ${where}` : "where true"}
${TAG_KEYS}
| extend hasEnv        = ${hasTagExpr("env")}
| extend hasOwner      = ${hasTagExpr("owner")}
| extend hasCostCenter = ${hasTagExpr("cost-center")}
| extend compliant     = iff(hasEnv and hasOwner and hasCostCenter, 1.0, 0.0)
| extend _cost         = todouble(${cost})
| summarize
    OverallCompliance  = round(avg(compliant) * 100, 1),
    TaggedResources    = countif(compliant == 1),
    TotalResources     = count(),
    TotalCost          = sum(_cost),
    EnvPct             = round(countif(hasEnv) * 100.0 / count(), 1),
    OwnerPct           = round(countif(hasOwner) * 100.0 / count(), 1),
    CostCenterPct      = round(countif(hasCostCenter) * 100.0 / count(), 1),
    EnvCostPct         = round(sumif(_cost, hasEnv) * 100.0 / sum(_cost), 1),
    OwnerCostPct       = round(sumif(_cost, hasOwner) * 100.0 / sum(_cost), 1),
    CostCenterCostPct  = round(sumif(_cost, hasCostCenter) * 100.0 / sum(_cost), 1)
`.trim();
}

// Per-subscription tag compliance
export function tagComplianceKql(filters: ParsedFilters): string {
  const where = buildFilterClauses(filters);
  const cost = costColumn(filters.currency);
  return `
Costs()
| ${where ? `where ${where}` : "where true"}
${TAG_KEYS}
| extend hasEnv        = ${hasTagExpr("env")}
| extend hasOwner      = ${hasTagExpr("owner")}
| extend hasCostCenter = ${hasTagExpr("cost-center")}
| extend compliant     = iff(hasEnv and hasOwner and hasCostCenter, 1.0, 0.0)
| extend _cost         = todouble(${cost})
| summarize
    CompliancePct     = round(avg(compliant) * 100, 1),
    Total             = count(),
    EnvPct            = round(countif(hasEnv) * 100.0 / count(), 1),
    OwnerPct          = round(countif(hasOwner) * 100.0 / count(), 1),
    CostCenterPct     = round(countif(hasCostCenter) * 100.0 / count(), 1),
    EnvCostPct        = round(sumif(_cost, hasEnv) * 100.0 / sum(_cost), 1),
    OwnerCostPct      = round(sumif(_cost, hasOwner) * 100.0 / sum(_cost), 1),
    CostCenterCostPct = round(sumif(_cost, hasCostCenter) * 100.0 / sum(_cost), 1)
  by SubAccountName
| order by CompliancePct asc
`.trim();
}

// Per-subscription budget vs actual (budget = static param for now)
export function budgetVsActualKql(filters: ParsedFilters): string {
  const where = buildFilterClauses(filters);
  const cost = costColumn(filters.currency);
  return `
Costs()
| ${where ? `where ${where}` : "where true"}
| summarize Actual = sum(todouble(${cost})) by SubAccountName
| order by Actual desc
`.trim();
}

export { buildFilterClauses, costColumn };
