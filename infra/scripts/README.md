# Infra Scripts

Helper scripts for post-deployment configuration of the FinOps Dashboard.

These automate the manual RBAC steps that the Bicep/ARM template cannot perform
because the analytics backend (e.g. an Azure Data Explorer cluster) is external
to the deployment.

| Script                  | Purpose                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| `grant-adx-access.sh`   | Grants the Managed Identity `Database Viewer` on the ADX database(s).    |

---

## `grant-adx-access.sh`

Grants the FinOps Dashboard's User-Assigned Managed Identity the ADX
**Database Viewer** role on one or more Kusto databases.

This is the manual step described in
[docs/operations/security.md](../../docs/operations/security.md)
(Step 2) and
[docs/guides/hands-on.md](../../docs/guides/hands-on.md).

> **Why is this needed?** When you deploy with `analyticsBackend=ADX`, the
> template injects `ADX_CLUSTER_URI` / `ADX_DATABASE` and creates the Managed
> Identity, but it does **not** grant access on the (external) ADX cluster.
> Until this RBAC is in place, `isMockMode()` effectively can't reach data and
> queries fail with `403`. The FinOps Hub uses **two** databases — `Hub` and
> `Ingestion` — so both must be granted.

### Prerequisites

- Azure CLI installed and logged in (`az login`).
- **Kusto cluster `Contributor`** on the target ADX cluster (required to create
  principal assignments).
- The dashboard already deployed with `analyticsBackend=ADX`.

### Usage

```bash
chmod +x infra/scripts/grant-adx-access.sh

./infra/scripts/grant-adx-access.sh \
  --resource-group         rg-finops-dashboard \
  --cluster-name           mykustocluster \
  --cluster-resource-group rg-adx
```

By default it grants access on the `Hub` and `Ingestion` databases. The script
reads the Managed Identity object id from the deployment output
`managedIdentityPrincipalId` and verifies the assignments at the end.

### Options

| Flag                        | Env var                  | Default        | Description                                                       |
| --------------------------- | ------------------------ | -------------- | ---------------------------------------------------------------- |
| `--resource-group`          | `RESOURCE_GROUP`         | _(required\*)_ | Resource group of the dashboard deployment.                      |
| `--deployment-name`         | `DEPLOYMENT_NAME`        | `main`         | Name of the `az deployment group` deployment.                    |
| `--cluster-name`            | `CLUSTER_NAME`           | _(required)_   | ADX (Kusto) cluster name.                                        |
| `--cluster-resource-group`  | `CLUSTER_RESOURCE_GROUP` | _(required)_   | Resource group of the ADX cluster.                               |
| `--databases`               | `DATABASES`              | `Hub Ingestion`| Space-separated list of databases to grant Viewer on.            |
| `--principal-id`            | `PRINCIPAL_ID`           | _(auto)_       | Managed Identity object id; skips the deployment lookup.         |
| `--help`                    | —                        | —              | Print usage and exit.                                            |

\* `--resource-group` is required only when `--principal-id` is not provided
(the script uses it to look the identity up from the deployment outputs).

### Examples

Grant on a single, non-Hub database:

```bash
./infra/scripts/grant-adx-access.sh \
  --resource-group rg-finops-dashboard \
  --cluster-name mykustocluster \
  --cluster-resource-group rg-adx \
  --databases "finops"
```

Skip the deployment lookup by passing the identity object id directly:

```bash
./infra/scripts/grant-adx-access.sh \
  --principal-id 00000000-0000-0000-0000-000000000000 \
  --cluster-name mykustocluster \
  --cluster-resource-group rg-adx
```

### Verifying

If the dashboard still shows mock or empty data after running the script:

1. Confirm the Container App was deployed with `analyticsBackend=ADX` and that
   `ADX_CLUSTER_URI` / `ADX_DATABASE` are set.
2. List the assignments to confirm the role landed:

   ```bash
   az kusto database-principal-assignment list \
     --cluster-name mykustocluster \
     --database-name Hub \
     --resource-group rg-adx -o table
   ```

See [docs/troubleshooting.md](../../docs/operations/troubleshooting.md)
for more diagnostics.
