# ADR-0004: Mock Data Fallback

- **Status:** Accepted

## Context

The dashboard's live data path requires an accessible Azure Data Explorer cluster (`ADX_CLUSTER_URI`),
valid Azure credentials, and the FinOps Hub schema. These are not available in every development
environment or demo scenario.

The team needs to:

1. Develop and iterate on the frontend without an ADX connection.
2. Demonstrate the dashboard to stakeholders without exposing live Azure subscription data.
3. Run automated checks and UI development in environments with no Azure access.

## Decision

Every API route returns realistic mock data when either:

- `ADX_CLUSTER_URI` is unset, or
- `NEXT_PUBLIC_USE_MOCK=true` is set.

The `isMockMode()` helper encapsulates this check. Mock data is defined alongside the real data shapes
and satisfies the same TypeScript interfaces.

## Consequences

- **Frontend development is unblocked** — engineers without ADX access can work on UI changes against
  realistic data.
- **Demo / showcase mode** — the dashboard can be presented without a live Azure subscription.
- **Type safety** — mock data matches real data shapes exactly (same TypeScript interfaces), so a type
  error in mock data surfaces immediately.
- **Metadata flag** — every API response includes `metadata.isMock: boolean` (and `metadata.dataSource`)
  so the UI can show a badge indicating mock or customer data.
- **Consistency requirement** — when real data shapes change, mock data must be updated in lockstep to
  avoid silent divergence.

See also: [Configuration Reference](../reference/configuration.md),
[Hands-On Guide](../guides/hands-on.md).
