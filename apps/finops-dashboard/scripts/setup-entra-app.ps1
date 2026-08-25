<#
.SYNOPSIS
    Creates (or updates) the Microsoft Entra ID app registration used by the
    FinOps Dashboard's Easy Auth layer.

.DESCRIPTION
    Idempotent. Creates a single-tenant app registration, exposes the
    FinOps.Reader and FinOps.Admin app roles, requires role assignment on the
    enterprise application, and issues a client secret.

    Run this BEFORE deploying the Bicep/ARM template: the deployment needs the
    resulting client ID and secret. After the deployment, run
    finish-entra-app.ps1 to register the redirect URI.

.PARAMETER DisplayName
    Display name of the app registration.

.PARAMETER AssignAdminToCurrentUser
    Assigns FinOps.Admin to the account running the script. Strongly
    recommended: with authDefaultRole = 'none' a deployment with no role
    assignments locks everyone out.

.EXAMPLE
    ./setup-entra-app.ps1 -DisplayName "FinOps Dashboard - Prod"
#>
[CmdletBinding()]
param(
    [string]$DisplayName = "FinOps Dashboard",
    [switch]$AssignAdminToCurrentUser
)

$ErrorActionPreference = "Stop"

function Assert-AzCli {
    if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
        throw "Azure CLI (az) is required but was not found in PATH."
    }
    $account = az account show --only-show-errors 2>$null
    if (-not $account) {
        throw "Not signed in. Run 'az login' first."
    }
}

Assert-AzCli

# Stable role IDs: reusing them keeps the script idempotent, so re-running it
# does not revoke existing role assignments.
$readerRoleId = "3f2b6a5e-9d1c-4a7b-8f60-2b1c9e5d4a11"
$adminRoleId = "7c4d8e2a-1b53-4f92-a6d7-5e8c3f0b9a22"

$appRoles = @(
    @{
        id                 = $readerRoleId
        allowedMemberTypes = @("User")
        description        = "Read-only access to the FinOps Dashboard."
        displayName        = "FinOps Reader"
        isEnabled          = $true
        value              = "FinOps.Reader"
    },
    @{
        id                 = $adminRoleId
        allowedMemberTypes = @("User")
        description        = "Full access, including remediation, configuration and data ingestion."
        displayName        = "FinOps Admin"
        isEnabled          = $true
        value              = "FinOps.Admin"
    }
)

Write-Host "Looking up app registration '$DisplayName'..." -ForegroundColor Cyan
$appId = az ad app list --display-name $DisplayName --query "[0].appId" -o tsv --only-show-errors

if ([string]::IsNullOrWhiteSpace($appId)) {
    Write-Host "Creating app registration..." -ForegroundColor Cyan
    $appId = az ad app create `
        --display-name $DisplayName `
        --sign-in-audience AzureADMyOrg `
        --query appId -o tsv --only-show-errors
}
else {
    Write-Host "Reusing existing app registration $appId." -ForegroundColor Yellow
}

$objectId = az ad app show --id $appId --query id -o tsv --only-show-errors

# App roles must be patched through Graph: the az ad app update --set path does
# not handle nested collections reliably.
$rolesFile = New-TemporaryFile
try {
    # enableIdTokenIssuance must be on: Container Apps Easy Auth drives the
    # hybrid OIDC flow (response_type=code+id_token). Without it Entra ID
    # never returns an id_token to /.auth/login/aad/callback, and Easy Auth
    # rejects the callback with HTTP 401 (substatus 73) before any network
    # call is made -- no useful error appears in the container logs.
    @{
        appRoles       = $appRoles
        identifierUris = @("api://$appId")
        web            = @{
            implicitGrantSettings = @{
                enableIdTokenIssuance    = $true
                enableAccessTokenIssuance = $false
            }
        }
    } |
        ConvertTo-Json -Depth 6 |
        Set-Content -Path $rolesFile -Encoding utf8

    Write-Host "Publishing app roles (FinOps.Reader, FinOps.Admin) and enabling ID token issuance..." -ForegroundColor Cyan
    az rest --method PATCH `
        --uri "https://graph.microsoft.com/v1.0/applications/$objectId" `
        --headers "Content-Type=application/json" `
        --body "@$rolesFile" --only-show-errors | Out-Null
}
finally {
    Remove-Item $rolesFile -ErrorAction SilentlyContinue
}

# Service principal (enterprise application)
$spId = az ad sp list --filter "appId eq '$appId'" --query "[0].id" -o tsv --only-show-errors
if ([string]::IsNullOrWhiteSpace($spId)) {
    Write-Host "Creating service principal..." -ForegroundColor Cyan
    $spId = az ad sp create --id $appId --query id -o tsv --only-show-errors
}

Write-Host "Requiring app role assignment to sign in..." -ForegroundColor Cyan
az rest --method PATCH `
    --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$spId" `
    --headers "Content-Type=application/json" `
    --body '{"appRoleAssignmentRequired": true}' --only-show-errors | Out-Null

if ($AssignAdminToCurrentUser) {
    $userId = az ad signed-in-user show --query id -o tsv --only-show-errors
    Write-Host "Assigning FinOps.Admin to the current user..." -ForegroundColor Cyan
    $assignment = @{
        principalId = $userId
        resourceId  = $spId
        appRoleId   = $adminRoleId
    } | ConvertTo-Json -Compress

    az rest --method POST `
        --uri "https://graph.microsoft.com/v1.0/users/$userId/appRoleAssignments" `
        --headers "Content-Type=application/json" `
        --body $assignment --only-show-errors 2>$null | Out-Null
}

Write-Host "Creating a client secret..." -ForegroundColor Cyan
$secret = az ad app credential reset --id $appId --append --years 1 `
    --query password -o tsv --only-show-errors

$tenantId = az account show --query tenantId -o tsv --only-show-errors

Write-Host ""
Write-Host "App registration ready. Deployment parameters:" -ForegroundColor Green
Write-Host "  enableEasyAuth      = true"
Write-Host "  easyAuthClientId    = $appId"
Write-Host "  easyAuthTenantId    = $tenantId"
Write-Host "  easyAuthClientSecret = $secret"
Write-Host ""
Write-Host "The secret is shown once and is not stored by this script." -ForegroundColor Yellow
Write-Host "Assign FinOps.Reader / FinOps.Admin to your users or groups in the" -ForegroundColor Yellow
Write-Host "enterprise application, then run finish-entra-app.ps1 after deploying." -ForegroundColor Yellow
