# ADR-0003: SWR over WebSocket / Server-Sent Events

- **Status:** Accepted

## Context

The dashboard displays near-real-time FinOps data from Azure Data Explorer. The ingestion cadence of
the underlying FinOps Hub means cost data changes at most hourly — it does not update sub-second or
even sub-minute. Two categories of data exist:

- **Cost and operational data** (Cost Summary, Rate Optimization, Anomalies, Budgets, Workload,
  Chargeback, AI Insights): tolerable staleness of one minute.
- **Remediation Impact cards** (Advisor recommendations): these change infrequently, so a 15-minute
  refresh is sufficient.

## Decision

Use **SWR** (stale-while-revalidate) polling for all data fetching:

- Default revalidation interval: **60 seconds** for cost pages.
- Extended revalidation interval: **15 minutes** for Remediation Impact cards.

## Consequences

- **Sufficient freshness** — 60-second polling matches the FinOps data ingestion cadence; no real-time
  streaming is needed or useful.
- **SWR built-ins** — stale-while-revalidate semantics, automatic request deduplication, and error retry
  are available without custom infrastructure.
- **Simpler infrastructure** — no WebSocket server or SSE endpoint to maintain; polling works over
  standard HTTP.
- **Rejected: WebSocket connections** — require a persistent server-side connection manager; the
  complexity is unjustified when data changes hourly at most.
- **Rejected: Server-Sent Events** — one-directional but still requires an open HTTP connection per
  client; overhead not justified for hourly-cadence data.
