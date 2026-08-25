# Architecture Decision Records

An **Architecture Decision Record (ADR)** captures a significant technical choice, the context that
made it necessary, and the consequences it carries. ADRs are immutable once accepted — if a decision
changes, a new ADR supersedes the old one rather than editing it in place. This keeps the history
of *why* the architecture looks the way it does.

This project uses ADRs for decisions that:

- are hard to reverse,
- affect multiple layers of the stack,
- or represent a non-obvious trade-off that future contributors need to understand.

For day-to-day implementation notes, use inline code comments or the docs under
[`docs/architecture/`](../architecture/blueprint.md).

---

## Decision Log

| # | Title | Status | Summary |
|---|-------|--------|---------|
| [ADR-0001](0001-bff-api-routes.md) | BFF Pattern (API Routes as Backend-for-Frontend) | Accepted | Next.js API Routes act as a server-side proxy to ADX; credentials and KQL queries never reach the browser. |
| [ADR-0002](0002-apache-echarts.md) | Apache ECharts over D3.js / Recharts | Accepted | ECharts chosen for native gauge support, dark-theme, and a declarative options API that fits React. |
| [ADR-0003](0003-swr-polling.md) | SWR over WebSocket / Server-Sent Events | Accepted | 60-second SWR polling is sufficient for hourly FinOps data; avoids WebSocket complexity. |
| [ADR-0004](0004-mock-data-fallback.md) | Mock Data Fallback | Accepted | Every API route serves mock data when ADX is unavailable, enabling development and demos without Azure access. |
| [ADR-0005](0005-simulator-pricing-fallback.md) | Source-Aware Defensive Pricing Fallback for Cost Simulator | Accepted | Simulator falls back to catalog-based math when ADX price rows are missing or invalid, preventing zero-baseline errors. |

---

## Adding a New ADR

1. Copy [`template.md`](template.md) to `docs/adr/000N-kebab-case-title.md`, incrementing the number.
2. Fill in Context, Decision, and Consequences.
3. Add a row to the table above.
4. If the new ADR supersedes an existing one, update the old ADR's **Status** line.
