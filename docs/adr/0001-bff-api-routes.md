# ADR-0001: BFF Pattern (API Routes as Backend-for-Frontend)

- **Status:** Accepted

## Context

The dashboard needs to query Azure Data Explorer (ADX) on behalf of the browser. ADX access requires
Azure credentials (`DefaultAzureCredential`). Allowing the browser to call ADX directly would expose
those credentials and require CORS configuration on the ADX cluster. KQL queries would also be visible
to any client-side inspector, creating a potential injection surface.

The project is a Next.js 16 application, which ships a built-in Route Handlers mechanism on the same
Node.js process as the frontend.

## Decision

Use Next.js API Routes as a server-side proxy to ADX (Backend-for-Frontend pattern) instead of direct
browser-to-ADX calls. All 51 dashboard endpoints follow the pattern:

```typescript
// 1. Validate query params with Zod
// 2. Check isMockMode() → return mock data OR execute KQL
// 3. Map ADX response to typed interface
// 4. Return { data: T, metadata: { queriedAt, isMock } }
```

## Consequences

- **ADX tokens stay server-side** — `DefaultAzureCredential` is never sent to the browser.
- **KQL queries are server-only** — prevents KQL injection from client-supplied strings.
- **Mock data fallback is centralised** — `isMockMode()` is checked once per route, with no client-side
  branching.
- **Single deployment unit** — frontend and BFF are packaged and deployed as one Container App, which
  simplifies infrastructure.
- **Rejected: Direct ADX REST API from browser** — exposes credentials, requires CORS configuration on
  the cluster.
- **Rejected: Separate Express backend** — adds deployment complexity (second Container App, separate
  CI/CD) for no benefit in this architecture.

See also: [Security Model](../architecture/blueprint.md#security-model),
[Configuration Reference](../reference/configuration.md).
