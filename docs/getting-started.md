# Getting started

**You do not need an Azure subscription to run this dashboard locally.** When
`ADX_CLUSTER_URI` is not configured the server-side `isMockMode()` function
returns `true` and every API route serves synthetic data. Every view is
explorable immediately after `npm install`.

---

## Prerequisites

| Requirement | Version | Why |
|---|---|---|
| Node.js | **≥ 22** | The `engines` field in `apps/finops-dashboard/package.json` enforces this. Node 20 reached end-of-life on 2026-04-30 and no longer receives security patches. CI pins Node 22 for the same reason. |
| npm | ≥ 10 | Bundled with Node 22. |
| Python | ≥ 3.10 (optional) | Only required if you want to run the Azure Pricing MCP server locally. |
| Azure CLI | 2.50+ (optional) | Only required when connecting to a real ADX cluster or Foundry endpoint. |

Check your Node version:

```bash
node --version
```

If it is below 22, install the current LTS from <https://nodejs.org> or use a
version manager such as `nvm` or `fnm`.

---

## Install and run in mock mode

```bash
cd apps/finops-dashboard
npm install
npm run dev
```

Open <http://localhost:3000>.

Because `ADX_CLUSTER_URI` is not set, the app's `isMockMode()` returns `true`
and all API routes return bundled sample data. Auth enforcement is also off by
default, so the app runs as a synthetic "Local Dev" Admin — no login required.

---

## Pointing at real data

Copy the example file:

```bash
cp .env.local.example .env.local
```

The minimum set of variables needed to connect to a real FinOps Hub:

```env
ADX_CLUSTER_URI=https://your-finops-hub.region.kusto.windows.net
ADX_DATABASE=Hub
```

Authentication against ADX uses `DefaultAzureCredential`. Run `az login` before
starting the dev server. Your account needs at least the **Database Viewer**
role on the ADX database.

To enable AI features (chat, daily insights, Stakeholder Cards):

```env
AZURE_OPENAI_ENDPOINT=https://<your-foundry-resource>.cognitiveservices.azure.com
AZURE_OPENAI_DEPLOYMENT=model-router
```

Authentication here is also `DefaultAzureCredential`. You need the
**Cognitive Services OpenAI User** role on the Foundry resource.

For the full variable reference — including all optional tunables, the mock
mode override, dashboard defaults, and auth configuration — see
[`./reference/configuration.md`](./reference/configuration.md).

---

## The other workspaces

### Azure Pricing MCP server

The Python MCP server in `mcp/azure-pricing-mcp` answers pricing queries for
the calculator and the RI comparison features. It is **not** required for mock
mode or for queries against a real ADX cluster.

To start it manually:

```bash
cd mcp/azure-pricing-mcp
pip install -e .
python -m azure_pricing_mcp --transport http --port 8080
```

Then set `AZURE_PRICING_MCP_URL=http://localhost:8080` in your `.env.local`.

### `npm run dev:full`

This script starts both the Python pricing server and the Next.js dev server in
parallel using `concurrently`. It runs `pip install -e .` inline on every
invocation, which is convenient but slow on cold starts:

```bash
# From apps/finops-dashboard
npm run dev:full
```

The equivalent of running the two commands above separately. Use it when you
need pricing features and want a single terminal tab.

---

## Common first-run problems

For the full troubleshooting guide see [`./operations/troubleshooting.md`](./operations/troubleshooting.md).

One pitfall worth calling out here because it is non-obvious and silent:

> **Do not run `npm run build` while `npm run dev` is running.**
>
> Both commands write to the same `.next/` directory. If the build runs while
> the dev server is up, the dev server starts serving stale chunk references.
> Pages respond with HTTP 200 but render blank because their JavaScript and CSS
> assets return 404. Stop `npm run dev` first, then run `npm run build`. If you
> have already hit this, `rm -rf .next` and restart the dev server.

See also [`../AGENTS.md`](../AGENTS.md) (Common Pitfalls) and
[`../CONTRIBUTING.md`](../CONTRIBUTING.md) for setup guidance that this page
deliberately does not duplicate.

---

## Where to go next

- **Architecture** — [`./architecture/overview.md`](./architecture/overview.md) explains
  the data flow from ADX through the API layer to the React UI.
- **Hands-on guide** — [`./guides/hands-on.md`](./guides/hands-on.md) walks through
  configuring the dashboard against a real FinOps Hub, including ADX role
  assignments and the Azure AI Foundry setup.
- **Deploy to Azure** — [`../apps/finops-dashboard/DEPLOY.md`](../apps/finops-dashboard/DEPLOY.md)
  covers the Container App deployment and RBAC steps.
