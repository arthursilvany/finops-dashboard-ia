import type { ParsedFilters } from "../filter-schema";

const ALLOWED_CHARS = /^[a-zA-Z0-9 _.\-:/,@()]+$/;

function escapeKql(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function safeValue(value: string): string {
  const trimmed = value.trim();
  if (!ALLOWED_CHARS.test(trimmed)) return "";
  return escapeKql(trimmed);
}

/**
 * UI provider values are normalized ("Azure", "AWS"), but FOCUS `ProviderName`
 * is free text and each vendor spells itself differently — Azure exports say
 * "Microsoft", not "Azure". Filtering on the literal UI value would return zero
 * rows against a real FinOps Hub, so each provider expands to its known
 * spellings. Mirrors `normalizeProvider()` in `customer-data/contract.ts`.
 */
const PROVIDER_KQL_SPELLINGS: Record<string, string[]> = {
  azure: ["Microsoft", "Azure", "Microsoft Azure"],
  aws: ["AWS", "Amazon", "Amazon Web Services"],
  gcp: ["Google", "Google Cloud", "GCP"],
};

export function buildFilterClauses(filters: ParsedFilters): string {
  const clauses: string[] = [];

  if (filters.dateFrom) {
    const d = safeValue(filters.dateFrom);
    if (d) clauses.push(`ChargePeriodStart >= datetime('${d}')`);
  }
  if (filters.dateTo) {
    const d = safeValue(filters.dateTo);
    if (d) clauses.push(`ChargePeriodStart <= datetime('${d}T23:59:59')`);
  }
  if (filters.providers.length > 0) {
    const vals = filters.providers
      .flatMap((provider) => {
        const spellings = PROVIDER_KQL_SPELLINGS[provider.trim().toLowerCase()];
        return spellings ?? [provider];
      })
      .map(safeValue)
      .filter(Boolean);
    if (vals.length > 0) {
      clauses.push(
        `ProviderName in~ (${vals.map((v) => `'${v}'`).join(", ")})`,
      );
    }
  }
  if (filters.subscriptions.length > 0) {
    const vals = filters.subscriptions.map(safeValue).filter(Boolean);
    if (vals.length > 0) {
      clauses.push(
        `SubAccountName in (${vals.map((v) => `'${v}'`).join(", ")})`,
      );
    }
  }
  if (filters.regions.length > 0) {
    const vals = filters.regions.map(safeValue).filter(Boolean);
    if (vals.length > 0) {
      clauses.push(`RegionName in (${vals.map((v) => `'${v}'`).join(", ")})`);
    }
  }
  if (filters.services.length > 0) {
    const vals = filters.services.map(safeValue).filter(Boolean);
    if (vals.length > 0) {
      clauses.push(`ServiceName in (${vals.map((v) => `'${v}'`).join(", ")})`);
    }
  }
  if (filters.resourceGroups.length > 0) {
    const vals = filters.resourceGroups.map(safeValue).filter(Boolean);
    if (vals.length > 0) {
      clauses.push(
        `x_ResourceGroupName in (${vals.map((v) => `'${v}'`).join(", ")})`,
      );
    }
  }
  if (filters.tags.length > 0) {
    for (const tag of filters.tags) {
      const key = safeValue(tag.key);
      if (!key) continue;
      const vals = tag.values.map(safeValue).filter(Boolean);
      if (vals.length > 0) {
        clauses.push(
          `tostring(todynamic(Tags)['${key}']) in (${vals.map((v: string) => `'${v}'`).join(", ")})`,
        );
      }
    }
  }

  if (clauses.length === 0) return "";
  return clauses.map((c) => `| where ${c}`).join("\n");
}

export function costColumn(currency: string): string {
  return currency === "usd" ? "x_EffectiveCostInUsd" : "EffectiveCost";
}
