# Security Policy

## Reporting a vulnerability

**Do not report security vulnerabilities through public GitHub issues, discussions, or pull
requests.**

Use GitHub's private vulnerability reporting flow:

[Report a vulnerability privately](https://github.com/arthursilvany/finops-dashboard-ia/security/advisories/new)

If that flow is unavailable, contact the maintainer through their GitHub profile,
[@arthursilvany](https://github.com/arthursilvany), and clearly mark the message as a security
report.

Please include as much of the following as you can:

- The type of issue (authentication bypass, secret exposure, injection, privilege escalation,
  and so on)
- The affected component — dashboard application, Bicep/ARM templates, the Azure Pricing MCP
  server, or the Easy Auth configuration
- Full paths of the source files involved
- The location of the affected code (tag, branch, commit, or a direct URL)
- Step-by-step instructions to reproduce
- Proof-of-concept or exploit code, if you have it
- The impact, including how an attacker might exploit it

This helps triage the report faster.

## What to expect

| Stage | Target |
| --- | --- |
| Acknowledgement of your report | Within 5 business days |
| Initial assessment and severity | Within 10 business days |
| Fix or documented mitigation | Depends on severity and complexity |

You will be kept informed as the report progresses. Please give a reasonable window for a fix
before any public disclosure.

## Supported versions

This project is developed on `main`. Security fixes are applied to `main` and published in the
next tagged release. Older tags are not patched.

| Version | Supported |
| --- | --- |
| `main` | Yes |
| Latest tagged release | Yes |
| Earlier releases | No |

## Scope

In scope:

- The dashboard application in `apps/finops-dashboard`
- The infrastructure templates in `infra/`
- The Azure Pricing MCP server in `mcp/azure-pricing-mcp`
- The authentication and authorization layers (Easy Auth configuration, middleware, route
  policy)

Out of scope:

- Vulnerabilities in Azure services themselves — report those to
  [Microsoft MSRC](https://msrc.microsoft.com/create-report)
- Misconfiguration of a deployment you control that is not caused by a defect in this
  repository's templates or defaults
- Findings that require an attacker to already hold privileged access to your subscription

## Security design of this project

The deployment is built around a few deliberate choices:

- **No admin credentials on the container registry.** Image pulls use a User-Assigned Managed
  Identity holding `AcrPull`.
- **Secrets live in Azure Key Vault** and reach the Container App through Key Vault references,
  or are avoided entirely by using Managed Identity.
- **Entra ID sign-in is required** to reach the dashboard. Authorization is enforced in two
  layers: Container Apps Easy Auth at the ingress, and application middleware behind it.
- **No customer or lab data in the repository.** Cost exports are gitignored.

For the full baseline and the post-deployment checklist, see
[docs/operations/security.md](./docs/operations/security.md).

## If you find an exposed secret

If you believe a credential has been committed to this repository, report it privately using the
channel above and **do not** open a public issue. Rotate the credential first if it is yours to
rotate.
