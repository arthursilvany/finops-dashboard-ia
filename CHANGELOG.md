# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries before the first tagged release are grouped under **Unreleased**.

## [Unreleased]

### Added

- Versioned public GHCR images for the dashboard and Azure Pricing MCP server.
- A clean Deploy to Azure path that does not require a registry bootstrap.
- Repository governance: MIT `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
  `SUPPORT.md`, and this changelog.
- Issue templates (bug report, feature request, documentation), a pull request template,
  `CODEOWNERS`, and Dependabot for npm, pip, and GitHub Actions.
- Continuous integration on pull requests: application lint and build, Azure Pricing MCP tests,
  a secret scan, and a check that fails when `infra/arm/azuredeploy.json` has drifted from the
  Bicep it is compiled from.
- `.gitattributes` and `.editorconfig` for consistent line endings and formatting.
- `AZURE_SUBSCRIPTION_ID` is now injected into the Container App, so the Agentic FinOps view
  queries Azure Advisor through Resource Graph instead of silently falling back to mock data.
- Application secrets are stored in Azure Key Vault and reached through Container App Key Vault
  references.
- Support for deploying the dashboard into a resource group that already hosts a FinOps Hub,
  reusing the Hub as the data backend.
- Multicloud cost-benefit comparison, including AWS cost ingestion.
- Stakeholder Cards: a deterministic insight layer with AI guardrails on top.
- Customer POC mode — ingests an Azure Cost Export (including Parquet/Snappy) into a populated
  dashboard, covering budgets, reservations, AI costs, and insights.
- Azure AI Foundry integration using the `model-router` deployment.
- `grant-adx-access` helper script for post-deployment ADX role assignments.

### Changed

- Deployment now consumes full image URIs and no longer creates an empty ACR.
- Azure SKU Advisor remains an external endpoint integration because its source
  and image build are maintained outside this repository.
- The image parameter contract changed; existing deployments must follow the
  migration and legacy-resource cleanup procedure in `docs/operations/deployment.md`.

- Upgraded the dashboard runtime from Next.js 14 / React 18 to Next.js 16 / React 19 and moved
  the request authorization entry point from the retired middleware convention to
  `src/proxy.ts`.
- Entra ID sign-in is required to reach the dashboard. Authorization is enforced in two layers:
  Container Apps Easy Auth at the ingress and the application proxy behind it.
- The public ingress is protected by Easy Auth; the `AcrPull` role assignment is now optional so
  the template can be deployed with Contributor-only rights.
- Cost aggregation understands multi-day charge periods, with corrected date filtering.
- Client caches are reloaded when switching customer workspace, so data from one workspace
  cannot leak into another.
- Documentation translated to English throughout, and the price sheet comparison note renamed
  from `consideracoes-pricesheet-vs-calculadora.md` to `price-sheet-vs-calculator.md`.

### Fixed

- Sign-in failed at `/.auth/login/aad/callback` with HTTP 401 (substatus 73). Easy Auth uses the
  hybrid OIDC flow, which requires `enableIdTokenIssuance` on the app registration; without it
  Entra ID never issues an `id_token` and Easy Auth rejects the callback locally.
- The customer POC savings baseline was collapsing onto cost instead of being resolved
  independently.
- Tag coverage is reported per tag, using the latest complete month.
- Real token usage is reported for AI features, and reasoning-token cost is controlled.
- KQL execution paths hardened.
- Corrected the `AcrPull` role definition GUID.
- Removed the `publicNetworkAccess` property from the ACR configuration, which caused
  SKU-related deployment errors.

### Security

- Production dependency audits now run in CI for both npm and Python. The public-release
  baseline has no known critical, high, or moderate npm advisories and no known Python
  dependency advisories.
- Added tracked-tree publication guardrails, CodeQL for the public repository, private
  vulnerability reporting guidance, and a clean-history publication process that excludes
  deleted internal artifacts.
- Real customer names and lab data removed from the repository, with documentation explaining
  why they must stay out.
- No admin credentials on the container registry — image pulls use a User-Assigned Managed
  Identity holding `AcrPull`.

[Unreleased]: https://github.com/arthursilvany/finops-dashboard-ia/commits/main
