# ADR-0005: Source-Aware Defensive Pricing Fallback for Cost Simulator

- **Status:** Accepted

## Context

The Cost Simulator (`/cost-simulator`) lets users choose between **retail** and **contract** price
sources. Prices are looked up via the `/api/simulator/estimate` route, which queries ADX for pricing
rows (`Prices_v1_2()` function, EA/MCA PriceSheet) for the selected service, region, SKU, and quantity.

For certain SKU/region combinations, ADX pricing rows may return missing or invalid baseline fields
(null, zero, or negative values). Without a fallback, those responses would produce:

- **Zero-baseline** calculations that yield negative savings figures.
- **Null percentage** values that break the UI.
- An unusable simulator for any SKU not yet covered by the customer's price sheet.

## Decision

The Cost Simulator API applies the user-selected price source (retail or contract) and falls back to
**deterministic catalog-based math** when ADX pricing rows return missing or invalid baseline fields.

The source selection is preserved whenever valid ADX data is available; the fallback activates only
when the selected-source data is incomplete for the given SKU/region combination.

## Consequences

- **Prevents zero-baseline responses** — negative savings and null percentages no longer appear in the
  UI.
- **Simulator stays usable** — SKUs or regions not covered by the customer's price sheet still produce
  a meaningful estimate via the catalog fallback.
- **Source selection is honoured** — retail vs contract preference is respected when the data is valid;
  the fallback is a last resort, not a default.
- **Stable UX** — users see consistent output regardless of price-sheet completeness.
- **Transparency limitation** — the UI does not currently distinguish between an ADX-sourced estimate
  and a catalog-fallback estimate; a future enhancement could surface this distinction.

See also: [Price Sheet vs Calculator Guide](../guides/price-sheet-vs-calculator.md),
[Architecture Blueprint](../architecture/blueprint.md).
