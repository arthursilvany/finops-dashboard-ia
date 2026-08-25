# Manual Azure data collection

This guide shows how to run the read-only collector
`collectAzureDashboardData.ps1`. The script collects evidence for the dashboard,
records coverage in a manifest, and does not change Azure resources.

## Prerequisites

- PowerShell 7 or later (`pwsh`)
- Azure CLI (`az`)
- Read access to the subscriptions that will be analyzed
- Explicit subscription IDs
- HTTPS connectivity to `management.azure.com`

Validate the tools:

```powershell
pwsh --version
az version
```

Authenticate to the customer's tenant:

```powershell
az login --tenant "<tenant-id>"
az account show
```

If needed, install the Azure Resource Graph extension:

```powershell
az extension add --name resource-graph
```

## Recommended permissions

The collector runs in best-effort mode. `Reader` on the subscription covers the
basic inventory, but some sources require additional permissions.

| Source | Recommended permission |
| --- | --- |
| Resource Graph, Advisor and Resource Health | `Reader` |
| Azure Monitor metrics | `Monitoring Reader` |
| Policy compliance | `Reader` on the subscription |
| Defender for Cloud | `Security Reader` |
| Cost Details and budgets | `Cost Management Reader` |
| Reservations and Savings Plans | Read access on the corresponding billing scope |

Missing permissions do not necessarily stop the whole collection. The
`collection-manifest.json` file records each source as `collected`, `empty`,
`skipped`, `forbidden` or `failed`.

## Running the collector

Open PowerShell at the root of this repository.

### One subscription

```powershell
pwsh -File .\input\collectAzureDashboardData.ps1 `
  -CustomerName "Contoso" `
  -SubscriptionIds "00000000-0000-0000-0000-000000000001"
```

### Multiple subscriptions

```powershell
pwsh -File .\input\collectAzureDashboardData.ps1 `
  -CustomerName "Contoso" `
  -SubscriptionIds @(
    "00000000-0000-0000-0000-000000000001",
    "00000000-0000-0000-0000-000000000002"
  ) `
  -Months 3 `
  -MetricsDays 7 `
  -NonInteractive
```

By default, files are written to `input\customer`. To separate data by customer,
provide another directory:

```powershell
pwsh -File .\input\collectAzureDashboardData.ps1 `
  -CustomerName "Contoso" `
  -SubscriptionIds "<subscription-id>" `
  -OutputDirectory .\input\customer\contoso
```

## Parameters

| Parameter | Description | Default |
| --- | --- | --- |
| `-CustomerName` | Name displayed for the customer | Required |
| `-SubscriptionIds` | One or more subscriptions to collect | Required |
| `-OutputDirectory` | Destination folder | `input\customer` |
| `-Months` | Months of Cost Details, from 1 to 12 | `3` |
| `-MetricsDays` | Metrics window, from 1 to 30 days | `7` |
| `-NonInteractive` | Does not show prompts; fails with guidance when a local action is required | Disabled |
| `-Force` | Replaces recognized outputs from a previous collection | Disabled |

Use `-Force` only when you want to replace the existing collection:

```powershell
pwsh -File .\input\collectAzureDashboardData.ps1 `
  -CustomerName "Contoso" `
  -SubscriptionIds "<subscription-id>" `
  -Force
```

## Validating the collection

When it finishes, review this first:

```powershell
Get-Content .\input\customer\collection-manifest.json -Raw |
  ConvertFrom-Json |
  ConvertTo-Json -Depth 10
```

The main outputs are:

- `resource-graph.json`
- `advisor.json`
- `policy.json`
- `security.json`
- `health.json`
- `patch.json`
- `operations.json`
- `metrics.json`
- `budgets.json`
- `commitments.json`
- `cost-details-subNN-YYYY-MM.csv`
- `collection-manifest.json`

If Cost Details is not available, manually export a FOCUS file from Azure Cost
Management and place it in the same directory before ingestion.

## Feeding the dashboard

After collection, run the ingestion:

```powershell
Set-Location .\apps\finops-dashboard
npm run ingest:customer -- "Contoso"
```

This command normalizes the data and generates the AI Narrative using Azure AI
Foundry, grounded on CAF and WAF through Microsoft Learn MCP.

To start the dashboard:

```powershell
npm run dev
```

## Troubleshooting

- **Azure CLI not logged in:** run `az login` and confirm with `az account show`.
- **Subscription not found:** confirm the active tenant and the provided IDs.
- **Resource Graph unavailable:** install the extension with
  `az extension add --name resource-graph`.
- **Status `forbidden`:** request the indicated permission for the affected source and
  run again with `-Force`.
- **Existing outputs:** use another `-OutputDirectory` or confirm replacement with
  `-Force`.
- **Cost Details missing:** use a manual FOCUS export as fallback.

Identifiable data remains local in `input\customer`, which is ignored by Git.
The collector does not print or persist access tokens.