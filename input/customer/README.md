# Customer collection folder

This folder holds the approved unified customer collector output and the local
working files it produces.

## One folder per customer, input separate from output

Each customer gets its own folder in each tree, so two collections never merge
into a single dataset, and rebuilding the datasets never touches the collected
evidence:

```
input/customer/                  <- INPUT: what the collector writes
├── contoso/
│   └── <raw export files>
└── fabrikam/
    └── <raw export files>

output/customer/                 <- OUTPUT: what the dashboard reads
├── contoso/
│   ├── manifest.json            <- coverage, period, row counts
│   ├── rows.ndjson              <- normalized cost rows
│   └── advisor.json, resource-graph.json, ...
├── fabrikam/
└── registry.json                <- who was ingested, and when
```

The collector creates the input folder for you (`-CustomerName "Contoso"`
writes to `input\customer\contoso`), and `npm run ingest:customer -- "Contoso"`
reads only that folder and writes only to `output\customer\contoso`. Both paths
are printed as `Input:` and `Output:` at the end of every ingestion. Pick the
active customer in the dashboard sidebar.

Deleting `output/` is always safe: re-run the ingest to rebuild it. Deleting a
folder under `input/` throws away collected evidence.

## Approved collector

Use `input\collectAzureDashboardData.ps1` to collect the customer snapshot.
It is read-only and writes only under `input\customer\<slug>`, which stays
git-ignored except for this README and `.gitkeep`.

### Prerequisites

- PowerShell 7 (`pwsh`)
- Azure CLI (`az`)
- An authenticated Azure session
- Explicit `SubscriptionIds` passed on every run

### Local example

```powershell
pwsh -File .\input\collectAzureDashboardData.ps1 `
  -SubscriptionIds "<sub-id-1>","<sub-id-2>" `
  -CustomerName "Contoso"
```

### Cloud Shell example

```powershell
pwsh -File .\input\collectAzureDashboardData.ps1 `
  -SubscriptionIds "<sub-id-1>","<sub-id-2>" `
  -CustomerName "Contoso"
```

## What it collects

- Cost Details per subscription/month, with a manual FOCUS fallback when Cost
  Details is not available
- Resource inventory
- Azure Advisor recommendations
- Policy, security, health, patch, and operations signals
- Bounded metrics, budgets, and commitments

The collector is best-effort. The collection manifest records what succeeded,
what was skipped, and why permissions or scope prevented more data.

## AWS FOCUS exports

This folder is not Azure-only. Drop an **AWS Data Exports** file that uses the
FOCUS 1.0 schema inside the customer's own folder — `input\customer\<customer>\`,
subfolders per account are fine — and `npm run ingest:customer -- "<customer>"`
reads it with the same pipeline. There is no flag to set: the format is detected
from the file's columns and the cloud from the FOCUS `ProviderName` column.

Put each customer's files under that customer's folder. Files dropped loose at
the root of `input\customer` belong to no customer, and ingestion refuses to
guess when other customer folders already exist.

Azure and AWS rows share one dataset and a **Provider** filter appears in the
dashboard whenever both are present. The two pages backed by Azure-specific
evidence (**reservation detail** and **AI insights**) show a banner and are
filtered to the Azure rows, so their totals match that caption.
`resourceGroupName` does not exist on AWS and is left empty rather than
invented — AWS spend is grouped by sub-account and tags.

Resource Graph and Advisor have no AWS equivalent, so on an AWS-only dataset
they are recorded as `not-applicable` instead of `missing`.

## Behaviors to expect

- The Azure Resource Graph extension asks for confirmation interactively the
  first time it is needed.
- `-NonInteractive` fails fast with install guidance instead of prompting.
- The collector does not remediate anything; it only gathers evidence.
- Identifiable data stays local. Only sanitized aggregates leave for Foundry and
  Microsoft Learn grounding.
- The UI shows coverage and freshness from the collection manifest.
- Azure Pricing, Cost Simulator, and execution-history views are not driven by
  the collector.

## Output and cleanup

Each customer's processed dataset is `output\customer\<slug>`. Both trees are
ignored by git.

To rebuild every dataset from the collected evidence, delete the output tree and
re-run the ingest — nothing collected is lost:

```powershell
Remove-Item -Recurse -Force .\output\customer
```

To drop a single customer for good, delete it from both trees:

```powershell
Remove-Item -Recurse -Force .\input\customer\contoso, .\output\customer\contoso
```

After a demo, remove every collected file but keep this README and `.gitkeep`:

```powershell
Remove-Item -Recurse -Force .\input\customer\* -Exclude .gitkeep,README.md
Remove-Item -Recurse -Force .\output\customer
```
