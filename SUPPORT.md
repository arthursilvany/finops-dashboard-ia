# Support

## Getting help

| I want to… | Go here |
| --- | --- |
| Understand what the project does and how to deploy it | [README.md](README.md) |
| Deploy it to Azure, step by step | [DEPLOY.md](apps/finops-dashboard/DEPLOY.md) |
| Configure environment variables and data sources | [Configuration reference](./docs/reference/configuration.md) |
| Understand the architecture | [Architecture](./docs/architecture/overview.md) |
| Fix something that is broken | [Troubleshooting](./docs/operations/troubleshooting.md) |
| Operate it in production | [Operations guide](./docs/operations/runbook.md) |
| Contribute a change | [CONTRIBUTING.md](CONTRIBUTING.md) |

Start with [Troubleshooting](./docs/operations/troubleshooting.md) before opening an
issue. It covers the failures this project hits most often — sign-in returning HTTP 401, blank
pages after building over a running dev server, and Kusto or Azure OpenAI calls failing with
`Forbidden`.

## Opening an issue

If the documentation does not answer your question, open an issue using the right template:

- **[Bug report](https://github.com/arthursilvany/finops-dashboard-ia/issues/new?template=bug-report.yml)**
  — something behaves incorrectly
- **[Feature request](https://github.com/arthursilvany/finops-dashboard-ia/issues/new?template=feature-request.yml)**
  — something is missing
- **[Documentation](https://github.com/arthursilvany/finops-dashboard-ia/issues/new?template=documentation.yml)**
  — something is unclear, wrong, or absent

A good issue includes the version or commit you are on, what you expected, what happened, and
the exact commands or requests involved. Redact subscription IDs, tenant IDs, secrets, and
customer names before pasting logs.

## Security issues

**Never report a security vulnerability in a public issue.** Follow
[SECURITY.md](SECURITY.md).

## What is out of scope

This project is maintained on a best-effort basis. The following are outside what the
maintainers can help with:

- Debugging your Azure subscription's RBAC, networking, or quota configuration. Most
  `Forbidden` errors reported against this project turn out to be missing role assignments
  described in [DEPLOY.md](apps/finops-dashboard/DEPLOY.md).
- Support for Azure services themselves. Use
  [Azure Support](https://azure.microsoft.com/support/) for those.
- Building custom features on request. Open a feature request and discuss it, or contribute a
  pull request.
- Anything involving real customer cost data being shared in a public channel. Do not do this.

## Response expectations

This is not a commercially supported product and carries no SLA. Issues are triaged when time
allows. Well-described issues with reproduction steps get resolved faster than vague ones, and
pull requests get attention faster than either.
