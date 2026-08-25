import type { CustomerCostRow } from "../customer-data/contract";
import type { CustomerDatasetManifest } from "../customer-data/contract";
import type { ParsedFilters } from "../filter-schema";
import { getCustomerDataset } from "../customer-dataset";
import {
  resolveActiveCustomerSlug,
} from "../customer-data/workspace";
import { LEGACY_WORKSPACE_SLUG } from "../customer-data/paths";
import { addDays, applyFilters, costOf, datasetAnchor, rowsOverlapping } from "./filters";

/**
 * Everything an aggregator needs: the filtered rows, the currency-aware cost
 * accessor, and the relative-window boundaries anchored to the dataset instead
 * of the wall clock (see `datasetAnchor`).
 */
export interface AggregationContext {
  customerSlug?: string;
  manifest: CustomerDatasetManifest;
  /** Rows after `ParsedFilters` have been applied. */
  rows: CustomerCostRow[];
  filters: ParsedFilters;
  /** Latest charge date present in the *unfiltered* dataset (ISO date). */
  anchor: string;
  cost: (row: CustomerCostRow) => number;
  /** Rows overlapping the last `days` before the anchor, cost-prorated. */
  lastDays: (days: number) => CustomerCostRow[];
  /** Rows in the window `[anchor-2n, anchor-n)`, for MoM comparisons. */
  previousDays: (days: number) => CustomerCostRow[];
  /**
   * Rows whose charge period overlaps `[from, to)` — `to` exclusive, matching
   * the KQL windows. A row that straddles a boundary is returned with its cost
   * fields scaled to the overlapping fraction of its period, so no window can
   * drop it and no two adjacent windows can both count it in full.
   */
  between: (from: string, toExclusive: string) => CustomerCostRow[];
}

/**
 * Builds the aggregation context, or returns null when no customer dataset is
 * loaded — in which case the caller falls back to the static mock data.
 */
export function getAggregationContext(
  filters: ParsedFilters,
  customerSlug?: string | null,
): AggregationContext | null {
  const resolvedSlug =
    resolveActiveCustomerSlug(customerSlug) ?? LEGACY_WORKSPACE_SLUG;
  const dataset = getCustomerDataset(resolvedSlug);
  if (!dataset) return null;

  const anchor = datasetAnchor(dataset.rows);
  const rows = applyFilters(dataset.rows, filters);
  const cost = (row: CustomerCostRow) => costOf(row, filters.currency);

  const between = (from: string, toExclusive: string) =>
    rowsOverlapping(rows, from, toExclusive);

  // `ago(Nd)` in KQL is inclusive of the anchor day, so the window is
  // [anchor - (N-1) days, anchor + 1 day).
  const lastDays = (days: number) =>
    between(addDays(anchor, -(days - 1)), addDays(anchor, 1));

  const previousDays = (days: number) =>
    between(addDays(anchor, -(days * 2 - 1)), addDays(anchor, -(days - 1)));

  return {
    customerSlug: resolvedSlug,
    manifest: dataset.manifest,
    rows,
    filters,
    anchor,
    cost,
    lastDays,
    previousDays,
    between,
  };
}
