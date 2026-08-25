<#
.SYNOPSIS
    Registers the Easy Auth redirect URI on the FinOps Dashboard app
    registration, after the Container App has been deployed.

.DESCRIPTION
    The Container App FQDN only exists after the deployment, so the reply URL
    cannot be set by setup-entra-app.ps1. Idempotent: existing redirect URIs are
    preserved.

.EXAMPLE
    ./finish-entra-app.ps1 -ResourceGroup rg-finops -DeploymentName finops-deploy -AppId <clientId>

.EXAMPLE
    ./finish-entra-app.ps1 -AppUrl https://app-finops-prod.eastus.azurecontainerapps.io -AppId <clientId>
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$AppId,
    [string]$ResourceGroup,
    [string]$DeploymentName,
    [string]$AppUrl
)

$ErrorActionPreference = "Stop"

if (-not $AppUrl) {
    if (-not $ResourceGroup -or -not $DeploymentName) {
        throw "Provide -AppUrl, or both -ResourceGroup and -DeploymentName."
    }

    Write-Host "Reading containerAppUrl from deployment '$DeploymentName'..." -ForegroundColor Cyan
    $AppUrl = az deployment group show `
        --resource-group $ResourceGroup `
        --name $DeploymentName `
        --query properties.outputs.containerAppUrl.value -o tsv --only-show-errors
}

if ([string]::IsNullOrWhiteSpace($AppUrl)) {
    throw "Could not determine the Container App URL."
}

$redirectUri = "$($AppUrl.TrimEnd('/'))/.auth/login/aad/callback"

$existing = az ad app show --id $AppId --query "web.redirectUris" -o json --only-show-errors |
    ConvertFrom-Json

# @(...) around the whole pipeline: a pipeline emitting 0 or 1 items returns a
# scalar, and `+=` on a scalar string concatenates instead of appending — which
# would send the redirect URI to az one character at a time.
$uris = @(@($existing) | Where-Object { $_ })
if ($uris -contains $redirectUri) {
    Write-Host "Redirect URI already registered: $redirectUri" -ForegroundColor Yellow
    exit 0
}

[string[]]$uris = @($uris) + $redirectUri

Write-Host "Registering redirect URI $redirectUri..." -ForegroundColor Cyan
az ad app update --id $AppId --web-redirect-uris $uris --only-show-errors | Out-Null

Write-Host "Done. Sign-in is now available at $AppUrl" -ForegroundColor Green
