# Documentation

Everything documented about this project lives in this folder. All documentation is
written in **English**.

Start with [Getting started](./getting-started.md) if you want the dashboard running
locally, or with [Architecture overview](./architecture/overview.md) if you want to
understand how it fits together first.

## Getting started

| Document | Description |
| --- | --- |
| [Getting started](./getting-started.md) | Prerequisites, install, and running locally in mock mode with no Azure access. |
| [Hands-on guide](./guides/hands-on.md) | A guided walkthrough of the dashboard's views and what each one answers. |

## Architecture

| Document | Description |
| --- | --- |
| [Overview](./architecture/overview.md) | How the pieces fit together: the Next.js app, ADX, and the Azure services around them. |
| [Blueprint](./architecture/blueprint.md) | The detailed design, component by component. |
| [AI architecture](./architecture/ai.md) | The model layer, prompting, and how AI output is constrained. |
| [Data model](./architecture/data-model.md) | The ADX / FinOps Hub schema the dashboard queries, and the KQL layer that builds those queries. |
| [Decision records](./adr/README.md) | Architecture decisions, with the context and consequences of each. |

## Guides

| Document | Description |
| --- | --- |
| [Customer POC mode](./guides/customer-poc.md) | Load a customer's own cost export and run the dashboard against it. |
| [Stakeholder Cards](./guides/stakeholder-cards.md) | One card per decision persona over a shared set of reconciled facts. |
| [SKU Advisor](./guides/sku-advisor.md) | Rightsizing and SKU recommendations. |
| [Multicloud comparison](./guides/multicloud-compare.md) | Comparing Azure against other providers. |
| [Price sheet vs. calculator](./guides/price-sheet-vs-calculator.md) | Why the two disagree, and which to trust when. |

## Reference

| Document | Description |
| --- | --- |
| [API reference](./reference/api.md) | Every HTTP endpoint, its method, and the role required to call it. |
| [Configuration](./reference/configuration.md) | Environment variables and what each one changes. |
| [Infrastructure](./reference/infrastructure.md) | The Bicep modules, their parameters, and how they compose. |
| [Glossary](./reference/glossary.md) | FinOps terminology as this dashboard uses it. |

## Operations

| Document | Description |
| --- | --- |
| [Deployment](./operations/deployment.md) | Deploying to Azure. |
| [Runbook](./operations/runbook.md) | Running it in production. |
| [Security](./operations/security.md) | The security baseline and the post-deployment checklist. |
| [Testing](./operations/testing.md) | The verification scripts, what each proves, and which need live credentials. |
| [Troubleshooting](./operations/troubleshooting.md) | Diagnosing common failures. |

## Product

| Document | Description |
| --- | --- |
| [Stakeholder Cards PRD](./product/prd-stakeholder-cards.md) | Product requirements for the Stakeholder Cards feature. |

## Elsewhere in the repository

| I want to… | Go here |
| --- | --- |
| Deploy to Azure step by step | [apps/finops-dashboard/DEPLOY.md](../apps/finops-dashboard/DEPLOY.md) |
| Contribute a change | [CONTRIBUTING.md](../CONTRIBUTING.md) |
| Report a vulnerability | [SECURITY.md](../SECURITY.md) |
| Understand the repo layout and invariants | [AGENTS.md](../AGENTS.md) |
