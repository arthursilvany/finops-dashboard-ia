<#
.SYNOPSIS
Collects read-only Azure dashboard evidence into input\customer-compatible files.

.DESCRIPTION
Uses Azure CLI, Azure Resource Graph, az rest, and management-plane HTTP polling
to collect inventory, Advisor, optional assessment snapshots, and monthly Cost
Details CSVs for the dashboard's manual customer-ingestion flow.

The script writes all generated artifacts to a staging folder first and promotes
only recognized output files into the destination when collection completes.

.EXAMPLE
pwsh -File .\input\collectAzureDashboardData.ps1 `
  -CustomerName "Contoso" `
  -SubscriptionIds "00000000-0000-0000-0000-000000000001" `
  -NonInteractive

.EXAMPLE
pwsh -File .\input\collectAzureDashboardData.ps1 `
  -CustomerName "Contoso" `
  -SubscriptionIds @(
    "00000000-0000-0000-0000-000000000001",
    "00000000-0000-0000-0000-000000000002"
  ) `
  -OutputDirectory .\input\customer\contoso `
  -Months 3 `
  -MetricsDays 7 `
  -Force

.NOTES
- Requires PowerShell 7+
- Requires Azure CLI and an active az login
- Uses only read-only collection operations
- Does not persist or print access tokens
- Without -OutputDirectory, writes to input\customer\<slug of CustomerName> so
  each customer keeps an isolated workspace
- This is the input tree. `npm run ingest:customer` reads it and writes the
  processed dataset to output\customer\<slug>, which the dashboard reads.
#>
[CmdletBinding()]
param(
    [string]$CustomerName,
    [string[]]$SubscriptionIds,
    [string]$OutputDirectory,
    [ValidateRange(1, 12)]
    [int]$Months = 3,
    [ValidateRange(1, 30)]
    [int]$MetricsDays = 7,
    [switch]$NonInteractive,
    [switch]$Force,

    [Parameter(DontShow = $true)]
    [scriptblock]$AzCommandRunner,
    [Parameter(DontShow = $true)]
    [scriptblock]$WebRequestRunner,
    [Parameter(DontShow = $true)]
    [scriptblock]$DelayRunner,
    [Parameter(DontShow = $true)]
    [scriptblock]$PromptRunner
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'

$script:CollectorSchemaVersion = '1.0.0'
$script:ResourceGraphFileName = 'resource-graph.json'
$script:AdvisorFileName = 'advisor.json'
$script:CollectionManifestFileName = 'collection-manifest.json'
$script:FixedOutputFileNames = @(
    $script:ResourceGraphFileName,
    $script:AdvisorFileName,
    'policy.json',
    'security.json',
    'health.json',
    'patch.json',
    'operations.json',
    'metrics.json',
    'budgets.json',
    'commitments.json',
    $script:CollectionManifestFileName
)
$script:GeneratedCostFilePattern = '^cost-details-sub\d{2}-\d{4}-\d{2}\.csv$'
$script:CollectorContext = @{
    AzCommandRunner = $null
    WebRequestRunner = $null
    DelayRunner = $null
    PromptRunner = $null
    AccessToken = $null
}

function Get-UtcTimestamp {
    return (Get-Date).ToUniversalTime().ToString('o')
}

function ConvertFrom-JsonText {
    param(
        [AllowNull()]
        [string]$Json
    )

    if ([string]::IsNullOrWhiteSpace($Json)) {
        return $null
    }

    return $Json | ConvertFrom-Json -Depth 64 -AsHashtable
}

function Get-DeepValue {
    param(
        [AllowNull()]
        $InputObject,
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if ($null -eq $InputObject) {
        return $null
    }

    $current = $InputObject
    foreach ($segment in $Path -split '\.') {
        if ($null -eq $current) {
            return $null
        }

        if ($current -is [System.Collections.IDictionary]) {
            if (-not $current.Contains($segment)) {
                return $null
            }
            $current = $current[$segment]
            continue
        }

        $property = $current.PSObject.Properties[$segment]
        if ($null -eq $property) {
            return $null
        }
        $current = $property.Value
    }

    return $current
}

function ConvertTo-StringValue {
    param([AllowNull()]$Value)
    if ($null -eq $Value) { return '' }
    return [string]$Value
}

function ConvertTo-DoubleValue {
    param([AllowNull()]$Value)
    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) {
        return 0.0
    }

    $number = 0.0
    if ([double]::TryParse([string]$Value, [System.Globalization.NumberStyles]::Any, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$number)) {
        return $number
    }

    return 0.0
}

function ConvertTo-IntValue {
    param([AllowNull()]$Value)
    return [int][math]::Round((ConvertTo-DoubleValue -Value $Value), 0, [MidpointRounding]::AwayFromZero)
}

function ConvertTo-StringMap {
    param([AllowNull()]$Value)

    if ($null -eq $Value) {
        return @{}
    }

    if ($Value -is [string]) {
        if ([string]::IsNullOrWhiteSpace($Value)) {
            return @{}
        }
        try {
            $Value = $Value | ConvertFrom-Json -Depth 64 -AsHashtable
        }
        catch {
            return @{}
        }
    }

    if ($Value -isnot [System.Collections.IDictionary]) {
        return @{}
    }

    $map = [ordered]@{}
    foreach ($entry in $Value.GetEnumerator()) {
        $map[[string]$entry.Key] = ConvertTo-StringValue -Value $entry.Value
    }

    return $map
}

function Normalize-ResourceGraphRecord {
    param(
        [Parameter(Mandatory = $true)]
        [System.Collections.IDictionary]$Row
    )

    return [ordered]@{
        id = ConvertTo-StringValue -Value $Row['id']
        name = ConvertTo-StringValue -Value $Row['name']
        type = ConvertTo-StringValue -Value $Row['type']
        subscriptionId = ConvertTo-StringValue -Value $Row['subscriptionId']
        resourceGroup = ConvertTo-StringValue -Value $Row['resourceGroup']
        location = ConvertTo-StringValue -Value $Row['location']
        sku = ConvertTo-StringValue -Value $Row['sku']
        tags = ConvertTo-StringMap -Value $Row['tags']
    }
}

function Normalize-AdvisorRecord {
    param(
        [Parameter(Mandatory = $true)]
        [System.Collections.IDictionary]$Row
    )

    return [ordered]@{
        id = ConvertTo-StringValue -Value $Row['id']
        category = ConvertTo-StringValue -Value $Row['category']
        impact = ConvertTo-StringValue -Value $Row['impact']
        title = ConvertTo-StringValue -Value $Row['title']
        description = ConvertTo-StringValue -Value $Row['description']
        resourceId = ConvertTo-StringValue -Value $Row['resourceId']
        resourceType = ConvertTo-StringValue -Value $Row['resourceType']
        recommendationTypeId = ConvertTo-StringValue -Value $Row['recommendationTypeId']
        annualSavingsAmount = ConvertTo-DoubleValue -Value $Row['annualSavingsAmount']
        currency = ConvertTo-StringValue -Value $Row['currency']
        extendedProperties = ConvertTo-StringMap -Value $Row['extendedProperties']
    }
}

function New-SourceEntry {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [string]$OutputFile
    )

    return [ordered]@{
        name = $Name
        outputFile = $OutputFile
        state = 'skipped'
        counts = [ordered]@{}
        startedAtUtc = $null
        finishedAtUtc = $null
        errors = @()
        actions = @()
        artifacts = @()
    }
}

function Start-SourceEntry {
    param([Parameter(Mandatory = $true)][System.Collections.IDictionary]$Entry)
    $Entry['startedAtUtc'] = Get-UtcTimestamp
}

function Complete-SourceEntry {
    param(
        [Parameter(Mandatory = $true)]
        [System.Collections.IDictionary]$Entry,
        [Parameter(Mandatory = $true)]
        [string]$State,
        [hashtable]$Counts,
        [string[]]$Artifacts,
        [string[]]$Errors,
        [string[]]$Actions
    )

    $Entry['state'] = $State
    $Entry['counts'] = if ($Counts) { $Counts } else { [ordered]@{} }

    $artifactList = [System.Collections.ArrayList]::new()
    foreach ($item in @($Artifacts)) { [void]$artifactList.Add($item) }
    $errorList = [System.Collections.ArrayList]::new()
    foreach ($item in @($Errors)) { [void]$errorList.Add($item) }
    $actionList = [System.Collections.ArrayList]::new()
    foreach ($item in @($Actions)) { [void]$actionList.Add($item) }

    $Entry['artifacts'] = $artifactList
    $Entry['errors'] = $errorList
    $Entry['actions'] = $actionList
    $Entry['finishedAtUtc'] = Get-UtcTimestamp
}

function Get-SanitizedCommandFailureMessage {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Operation,
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    $text = ($Message -replace '\s+', ' ').Trim()
    if ($text.Length -gt 500) {
        $text = $text.Substring(0, 500)
    }
    return "$Operation failed. $text"
}

function Invoke-DefaultAzCommandRunner {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $output = & az @Arguments 2>&1
    $exitCode = $LASTEXITCODE
    $joined = ($output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
    return [pscustomobject]@{
        ExitCode = $exitCode
        StdOut = if ($exitCode -eq 0) { $joined } else { '' }
        StdErr = if ($exitCode -eq 0) { '' } else { $joined }
    }
}

function Invoke-AzCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [Parameter(Mandatory = $true)]
        [string]$Operation
    )

    $runner = $script:CollectorContext.AzCommandRunner
    $result = & $runner $Arguments
    if ($null -eq $result) {
        throw (Get-SanitizedCommandFailureMessage -Operation $Operation -Message 'No response was returned by the Azure CLI runner.')
    }

    $exitCode = 0
    $stdOut = ''
    $stdErr = ''

    if ($result -is [System.Collections.IDictionary]) {
        $exitCode = [int]($result['ExitCode'] ?? 0)
        $stdOut = [string]($result['StdOut'] ?? '')
        $stdErr = [string]($result['StdErr'] ?? '')
    }
    else {
        $exitProperty = $result.PSObject.Properties['ExitCode']
        $outProperty = $result.PSObject.Properties['StdOut']
        $errProperty = $result.PSObject.Properties['StdErr']
        $exitCode = if ($exitProperty) { [int]$exitProperty.Value } else { 0 }
        $stdOut = if ($outProperty) { [string]$outProperty.Value } else { [string]$result }
        $stdErr = if ($errProperty) { [string]$errProperty.Value } else { '' }
    }

    if ($exitCode -ne 0) {
        $message = if (-not [string]::IsNullOrWhiteSpace($stdErr)) { $stdErr } else { $stdOut }
        throw (Get-SanitizedCommandFailureMessage -Operation $Operation -Message $message)
    }

    return $stdOut
}

function Invoke-AzJsonCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [Parameter(Mandatory = $true)]
        [string]$Operation
    )

    $output = Invoke-AzCommand -Arguments $Arguments -Operation $Operation
    return ConvertFrom-JsonText -Json $output
}

function Invoke-AzRestJson {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('get', 'post')]
        [string]$Method,
        [Parameter(Mandatory = $true)]
        [string]$Url,
        [AllowNull()]
        $Body,
        [Parameter(Mandatory = $true)]
        [string]$Operation
    )

    $arguments = @('rest', '--method', $Method, '--url', $Url, '--only-show-errors', '--output', 'json')
    if ($null -ne $Body) {
        $arguments += @('--body', ($Body | ConvertTo-Json -Depth 64 -Compress))
    }

    return Invoke-AzJsonCommand -Arguments $arguments -Operation $Operation
}

function Test-IsForbiddenMessage {
    param([Parameter(Mandatory = $true)][string]$Message)
    return $Message -match '\b403\b' -or
        $Message -match 'AuthorizationFailed' -or
        $Message -match 'Forbidden' -or
        $Message -match 'does not have authorization'
}

function Resolve-SourceFailureState {
    param(
        [Parameter(Mandatory = $true)]
        [System.Exception]$Exception,
        [switch]$AllowSkippedUnavailable
    )

    $message = $Exception.Message
    if (Test-IsForbiddenMessage -Message $message) {
        return 'forbidden'
    }

    if ($AllowSkippedUnavailable -and ($message -match '\b404\b' -or $message -match '\b400\b' -or $message -match 'not found' -or $message -match 'unsupported' -or $message -match 'not available')) {
        return 'skipped'
    }

    return 'failed'
}

function Confirm-Install {
    param([Parameter(Mandatory = $true)][string]$Message)

    if ($NonInteractive.IsPresent) {
        return $false
    }

    $runner = $script:CollectorContext.PromptRunner
    $response = & $runner $Message
    return [string]$response -match '^(y|yes)$'
}

function Test-PowerShellAndAzPrerequisites {
    param(
        [switch]$SkipAzExecutableCheck
    )

    if ($PSVersionTable.PSVersion.Major -lt 7) {
        throw 'PowerShell 7 or later is required.'
    }

    if ($SkipAzExecutableCheck.IsPresent) {
        return
    }

    $command = Get-Command -Name az -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        throw 'Azure CLI was not found. Install Azure CLI and retry.'
    }
}

function Test-ActiveAzLogin {
    [void](Invoke-AzJsonCommand -Arguments @('account', 'show', '--output', 'json', '--only-show-errors') -Operation 'Validate active az login')
}

function Get-ValidatedSubscriptions {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$RequestedSubscriptionIds
    )

    if ($RequestedSubscriptionIds.Count -eq 0) {
        throw 'SubscriptionIds is required and must contain at least one subscription ID.'
    }

    $trimmed = New-Object System.Collections.Generic.List[string]
    foreach ($subscriptionId in $RequestedSubscriptionIds) {
        $value = ($subscriptionId ?? '').Trim()
        if ([string]::IsNullOrWhiteSpace($value)) {
            throw 'SubscriptionIds cannot contain blank values.'
        }
        if (-not $trimmed.Contains($value)) {
            [void]$trimmed.Add($value)
        }
    }

    $allSubscriptions = Invoke-AzJsonCommand -Arguments @('account', 'list', '--all', '--output', 'json', '--only-show-errors') -Operation 'List accessible subscriptions'
    $index = @{}
    foreach ($subscription in @($allSubscriptions)) {
        $index[[string]$subscription['id']] = $subscription
    }

    $validated = @()
    for ($i = 0; $i -lt $trimmed.Count; $i++) {
        $subscriptionId = $trimmed[$i]
        if (-not $index.ContainsKey($subscriptionId)) {
            throw "Subscription validation failed. The Azure login cannot access subscription '$subscriptionId'."
        }

        $subscription = $index[$subscriptionId]
        $state = ConvertTo-StringValue -Value $subscription['state']
        if (-not [string]::IsNullOrWhiteSpace($state) -and $state -ne 'Enabled') {
            throw "Subscription validation failed. Subscription '$subscriptionId' is in state '$state'."
        }

        $validated += [ordered]@{
            id = $subscriptionId
            label = ('sub{0:d2}' -f ($i + 1))
        }
    }

    return ,$validated
}

function Ensure-ResourceGraphExtension {
    try {
        [void](Invoke-AzJsonCommand -Arguments @('extension', 'show', '--name', 'resource-graph', '--output', 'json', '--only-show-errors') -Operation 'Check resource-graph Azure CLI extension')
    }
    catch {
        if ($NonInteractive.IsPresent) {
            throw 'The Azure CLI resource-graph extension is required. Run "az extension add --name resource-graph" and retry.'
        }

        if (-not (Confirm-Install -Message 'Install the Azure CLI resource-graph extension now? [y/N]')) {
            throw 'The Azure CLI resource-graph extension is required. Run "az extension add --name resource-graph" and retry.'
        }

        [void](Invoke-AzCommand -Arguments @('extension', 'add', '--name', 'resource-graph', '--only-show-errors') -Operation 'Install resource-graph Azure CLI extension')
    }
}

function Invoke-AzGraphQueryPaged {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Query,
        [Parameter(Mandatory = $true)]
        [string[]]$SubscriptionIds,
        [Parameter(Mandatory = $true)]
        [string]$Operation
    )

    $allRows = New-Object System.Collections.Generic.List[object]
    $seenTokens = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
    $skipToken = $null

    do {
        $arguments = @('graph', 'query', '-q', $Query, '--first', '1000', '--subscriptions') + $SubscriptionIds + @('--output', 'json', '--only-show-errors')
        if (-not [string]::IsNullOrWhiteSpace($skipToken)) {
            $arguments += @('--skip-token', $skipToken)
        }

        $response = Invoke-AzJsonCommand -Arguments $arguments -Operation $Operation
        foreach ($row in @($response['data'])) {
            [void]$allRows.Add($row)
        }

        $nextToken = ConvertTo-StringValue -Value $response['skipToken']
        if ([string]::IsNullOrWhiteSpace($nextToken)) {
            $skipToken = $null
            continue
        }

        if (-not $seenTokens.Add($nextToken)) {
            throw "Repeated skip token detected while paging $Operation."
        }

        $skipToken = $nextToken
    } while ($skipToken)

    return ,($allRows.ToArray())
}

function Get-RecognizedExistingFiles {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return ,@()
    }

    $recognized = New-Object System.Collections.Generic.List[string]
    foreach ($file in Get-ChildItem -LiteralPath $Path -File -ErrorAction Stop) {
        if ($script:FixedOutputFileNames -contains $file.Name -or $file.Name -match $script:GeneratedCostFilePattern) {
            [void]$recognized.Add($file.FullName)
        }
    }

    return ,($recognized.ToArray())
}

function Get-CollectionPeriods {
    param([Parameter(Mandatory = $true)][int]$MonthCount)

    $periods = @()
    $currentMonthStart = Get-Date -Date ((Get-Date).ToString('yyyy-MM-01T00:00:00'))
    for ($offset = $MonthCount - 1; $offset -ge 0; $offset--) {
        $monthStart = $currentMonthStart.AddMonths(-$offset)
        $monthEnd = $monthStart.AddMonths(1).AddDays(-1)
        $periods += [ordered]@{
            key = $monthStart.ToString('yyyy-MM')
            start = $monthStart.ToString('yyyy-MM-dd')
            end = $monthEnd.ToString('yyyy-MM-dd')
        }
    }

    return ,$periods
}

function Write-JsonFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        $Data
    )

    if ($Data -is [System.Array]) {
        $json = $Data | ConvertTo-Json -Depth 64 -AsArray
    }
    else {
        $json = $Data | ConvertTo-Json -Depth 64
    }
    [System.IO.File]::WriteAllText($Path, $json, [System.Text.UTF8Encoding]::new($false))
}

function Write-TextFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Text
    )

    [System.IO.File]::WriteAllText($Path, $Text, [System.Text.UTF8Encoding]::new($false))
}

function Get-AzureManagementAccessToken {
    if (-not [string]::IsNullOrWhiteSpace($script:CollectorContext.AccessToken)) {
        return $script:CollectorContext.AccessToken
    }

    $tokenResponse = Invoke-AzJsonCommand -Arguments @(
        'account', 'get-access-token',
        '--resource', 'https://management.azure.com/',
        '--output', 'json',
        '--only-show-errors'
    ) -Operation 'Get Azure management access token'

    $token = ConvertTo-StringValue -Value $tokenResponse['accessToken']
    if ([string]::IsNullOrWhiteSpace($token)) {
        throw 'Azure CLI returned an empty management access token.'
    }

    $script:CollectorContext.AccessToken = $token
    return $token
}

function Invoke-DefaultWebRequestRunner {
    param(
        [Parameter(Mandatory = $true)]
        [System.Collections.IDictionary]$Request
    )

    $invokeParameters = @{
        Uri = $Request['Uri']
        Method = $Request['Method']
        Headers = $Request['Headers']
        SkipHttpErrorCheck = $true
    }
    if ($Request.Contains('Body') -and $null -ne $Request['Body']) {
        $invokeParameters['Body'] = $Request['Body']
        $invokeParameters['ContentType'] = 'application/json'
    }

    $response = Invoke-WebRequest @invokeParameters
    return [pscustomobject]@{
        StatusCode = [int]$response.StatusCode
        Headers = $response.Headers
        Content = [string]$response.Content
    }
}

function Invoke-HttpRequest {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Method,
        [Parameter(Mandatory = $true)]
        [string]$Uri,
        [hashtable]$Headers,
        [AllowNull()]
        [string]$Body,
        [Parameter(Mandatory = $true)]
        [string]$Operation
    )

    $request = [ordered]@{
        Method = $Method
        Uri = $Uri
        Headers = if ($Headers) { $Headers } else { @{} }
    }
    if ($null -ne $Body) {
        $request['Body'] = $Body
    }

    $runner = $script:CollectorContext.WebRequestRunner
    $response = & $runner $request
    if ($null -eq $response) {
        throw "$Operation failed. No HTTP response was returned."
    }

    $statusCode = [int]$response.StatusCode
    $content = [string]($response.Content ?? '')
    $headers = if ($response.Headers -is [System.Collections.IDictionary]) {
        $response.Headers
    }
    else {
        $map = @{}
        foreach ($property in $response.Headers.PSObject.Properties) {
            $map[$property.Name] = $property.Value
        }
        $map
    }

    return [ordered]@{
        StatusCode = $statusCode
        Headers = $headers
        Content = $content
    }
}

function Invoke-AzureManagementRequest {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Method,
        [Parameter(Mandatory = $true)]
        [string]$Uri,
        [AllowNull()]
        [string]$Body,
        [Parameter(Mandatory = $true)]
        [string]$Operation
    )

    $token = Get-AzureManagementAccessToken
    $response = Invoke-HttpRequest -Method $Method -Uri $Uri -Body $Body -Operation $Operation -Headers @{
        Authorization = "Bearer $token"
    }

    return $response
}

function Invoke-Delay {
    param([Parameter(Mandatory = $true)][int]$Seconds)
    & $script:CollectorContext.DelayRunner $Seconds
}

function Get-CsvHeaderAndRows {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Texts
    )

    $header = $null
    $rows = New-Object System.Collections.Generic.List[string]
    foreach ($text in $Texts) {
        $normalized = ($text -replace "`r", '') -split "`n"
        foreach ($line in $normalized) {
            if ([string]::IsNullOrWhiteSpace($line)) {
                continue
            }

            if ($null -eq $header) {
                $header = $line
                continue
            }

            if ($line -eq $header) {
                continue
            }

            [void]$rows.Add($line)
        }
    }

    return [ordered]@{
        Header = $header
        Rows = $rows.ToArray()
    }
}

function Export-CostDetailsCsv {
    param(
        [Parameter(Mandatory = $true)]
        [System.Collections.IDictionary]$Subscription,
        [Parameter(Mandatory = $true)]
        [System.Collections.IDictionary]$Period,
        [Parameter(Mandatory = $true)]
        [string]$StageDirectory
    )

    $subscriptionId = [string]$Subscription['id']
    $fileName = "cost-details-$($Subscription['label'])-$($Period['key']).csv"
    $createUri = "https://management.azure.com/subscriptions/$subscriptionId/providers/Microsoft.CostManagement/generateCostDetailsReport?api-version=2025-03-01"
    $createBody = @{
        metric = 'AmortizedCost'
        timePeriod = @{
            start = $Period['start']
            end = $Period['end']
        }
    } | ConvertTo-Json -Depth 10 -Compress

    $createResponse = Invoke-AzureManagementRequest -Method 'POST' -Uri $createUri -Body $createBody -Operation "Generate Cost Details for $($Subscription['label']) $($Period['key'])"
    if ($createResponse['StatusCode'] -in 400, 404, 409) {
        return [ordered]@{
            state = 'skipped'
            fileName = $fileName
            rowCount = 0
            action = 'Request a manual Azure Cost Management export (FOCUS preferred) for this scope and month.'
            error = "Cost Details API unavailable for $($Subscription['label']) $($Period['key'])."
        }
    }
    if ($createResponse['StatusCode'] -eq 403) {
        return [ordered]@{
            state = 'forbidden'
            fileName = $fileName
            rowCount = 0
            action = 'Use a reader role that can access Cost Management or provide a manual FOCUS export.'
            error = "Cost Details API access was forbidden for $($Subscription['label']) $($Period['key'])."
        }
    }
    if ($createResponse['StatusCode'] -ne 202) {
        throw "Unexpected Cost Details create status $($createResponse['StatusCode']) for $($Subscription['label']) $($Period['key'])."
    }

    $pollUri = ConvertTo-StringValue -Value $createResponse['Headers']['Location']
    if ([string]::IsNullOrWhiteSpace($pollUri)) {
        return [ordered]@{
            state = 'skipped'
            fileName = $fileName
            rowCount = 0
            action = 'Request a manual Azure Cost Management export (FOCUS preferred) for this scope and month.'
            error = "Cost Details API did not return a poll location for $($Subscription['label']) $($Period['key'])."
        }
    }

    $retryAfter = ConvertTo-IntValue -Value $createResponse['Headers']['Retry-After']
    if ($retryAfter -lt 1) {
        $retryAfter = 5
    }

    $blobLinks = @()
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Invoke-Delay -Seconds $retryAfter
        $pollResponse = Invoke-AzureManagementRequest -Method 'GET' -Uri $pollUri -Body $null -Operation "Poll Cost Details for $($Subscription['label']) $($Period['key'])"
        if ($pollResponse['StatusCode'] -eq 202) {
            $retryAfter = ConvertTo-IntValue -Value $pollResponse['Headers']['Retry-After']
            if ($retryAfter -lt 1) {
                $retryAfter = 5
            }
            continue
        }
        if ($pollResponse['StatusCode'] -eq 403) {
            return [ordered]@{
                state = 'forbidden'
                fileName = $fileName
                rowCount = 0
                action = 'Use a reader role that can access Cost Management or provide a manual FOCUS export.'
                error = "Cost Details polling was forbidden for $($Subscription['label']) $($Period['key'])."
            }
        }
        if ($pollResponse['StatusCode'] -in 400, 404, 409) {
            return [ordered]@{
                state = 'skipped'
                fileName = $fileName
                rowCount = 0
                action = 'Request a manual Azure Cost Management export (FOCUS preferred) for this scope and month.'
                error = "Cost Details polling became unavailable for $($Subscription['label']) $($Period['key'])."
            }
        }
        if ($pollResponse['StatusCode'] -ne 200) {
            throw "Unexpected Cost Details poll status $($pollResponse['StatusCode']) for $($Subscription['label']) $($Period['key'])."
        }

        $pollBody = ConvertFrom-JsonText -Json $pollResponse['Content']
        foreach ($blob in @((Get-DeepValue -InputObject $pollBody -Path 'manifest.blobs'))) {
            $blobLink = ConvertTo-StringValue -Value $blob['blobLink']
            if (-not [string]::IsNullOrWhiteSpace($blobLink)) {
                $blobLinks += $blobLink
            }
        }

        break
    }

    if ($blobLinks.Count -eq 0) {
        return [ordered]@{
            state = 'skipped'
            fileName = $fileName
            rowCount = 0
            action = 'Request a manual Azure Cost Management export (FOCUS preferred) for this scope and month.'
            error = "Cost Details completed without CSV blobs for $($Subscription['label']) $($Period['key'])."
        }
    }

    $blobTexts = @()
    foreach ($blobLink in $blobLinks) {
        $blobResponse = Invoke-HttpRequest -Method 'GET' -Uri $blobLink -Headers @{} -Body $null -Operation "Download Cost Details CSV for $($Subscription['label']) $($Period['key'])"
        if ($blobResponse['StatusCode'] -ne 200) {
            throw "Unexpected blob download status $($blobResponse['StatusCode']) for $($Subscription['label']) $($Period['key'])."
        }
        $blobTexts += [string]$blobResponse['Content']
    }

    $csv = Get-CsvHeaderAndRows -Texts $blobTexts
    if ([string]::IsNullOrWhiteSpace([string]$csv['Header'])) {
        return [ordered]@{
            state = 'skipped'
            fileName = $fileName
            rowCount = 0
            action = 'Request a manual Azure Cost Management export (FOCUS preferred) for this scope and month.'
            error = "Downloaded Cost Details CSV had no header for $($Subscription['label']) $($Period['key'])."
        }
    }

    $destination = Join-Path $StageDirectory $fileName
    $csvText = $csv['Header']
    if (@($csv['Rows']).Count -gt 0) {
        $csvText += "`r`n" + (@($csv['Rows']) -join "`r`n")
    }
    Write-TextFile -Path $destination -Text $csvText

    return [ordered]@{
        state = 'collected'
        fileName = $fileName
        path = $destination
        rowCount = @($csv['Rows']).Count
    }
}

function Invoke-MetricsCollection {
    param(
        [Parameter(Mandatory = $true)]
        [System.Collections.IDictionary[]]$ResourceGraphRecords,
        [Parameter(Mandatory = $true)]
        [int]$Days
    )

    $targets = @($ResourceGraphRecords | Where-Object {
            $_['type'] -in @('microsoft.compute/virtualmachines', 'microsoft.compute/virtualmachinescalesets')
        } | Select-Object -First 25)

    if ($targets.Count -eq 0) {
        return ,@()
    }

    $start = (Get-Date).ToUniversalTime().AddDays(-$Days).ToString('o')
    $finish = (Get-Date).ToUniversalTime().ToString('o')
    $rows = @()
    foreach ($target in $targets) {
        $resourceId = [string]$target['id']
        $metricNamespace = if ([string]$target['type'] -eq 'microsoft.compute/virtualmachinescalesets') {
            'Microsoft.Compute/virtualMachineScaleSets'
        }
        else {
            'Microsoft.Compute/virtualMachines'
        }

        $encodedNamespace = [System.Uri]::EscapeDataString($metricNamespace)
        $url = "https://management.azure.com$resourceId/providers/microsoft.insights/metrics?api-version=2023-10-01&metricnames=Percentage%20CPU&timespan=$([System.Uri]::EscapeDataString("$start/$finish"))&interval=PT1H&aggregation=Average,Maximum&metricnamespace=$encodedNamespace"
        $response = Invoke-AzRestJson -Method 'get' -Url $url -Body $null -Operation "Collect CPU metrics for $([string]$target['name'])"

        $averages = New-Object System.Collections.Generic.List[double]
        $maximums = New-Object System.Collections.Generic.List[double]
        foreach ($metric in @($response['value'])) {
            foreach ($series in @($metric['timeseries'])) {
                foreach ($point in @($series['data'])) {
                    if ($null -ne $point['average']) {
                        [void]$averages.Add((ConvertTo-DoubleValue -Value $point['average']))
                    }
                    if ($null -ne $point['maximum']) {
                        [void]$maximums.Add((ConvertTo-DoubleValue -Value $point['maximum']))
                    }
                }
            }
        }

        $average = if ($averages.Count -gt 0) { ($averages | Measure-Object -Average).Average } else { 0.0 }
        $maximum = if ($maximums.Count -gt 0) { ($maximums | Measure-Object -Maximum).Maximum } else { 0.0 }
        $rows += [ordered]@{
            subscriptionId = ConvertTo-StringValue -Value $target['subscriptionId']
            resourceId = $resourceId
            resourceName = ConvertTo-StringValue -Value $target['name']
            resourceType = ConvertTo-StringValue -Value $target['type']
            resourceGroup = ConvertTo-StringValue -Value $target['resourceGroup']
            metricName = 'Percentage CPU'
            average = [math]::Round([double]$average, 4)
            maximum = [math]::Round([double]$maximum, 4)
            sampleCount = [int][math]::Max($averages.Count, $maximums.Count)
            startTimeUtc = $start
            endTimeUtc = $finish
        }
    }

    return ,$rows
}

function Save-ArrayOutput {
    param(
        [Parameter(Mandatory = $true)]
        [string]$StageDirectory,
        [Parameter(Mandatory = $true)]
        [string]$FileName,
        [Parameter(Mandatory = $true)]
        [string]$Source,
        [Parameter(Mandatory = $true)]
        [string]$Status,
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [object[]]$Records
    )

    $path = Join-Path $StageDirectory $FileName
    Write-JsonFile -Path $path -Data ([ordered]@{
            schemaVersion = $script:CollectorSchemaVersion
            capturedAtUtc = Get-UtcTimestamp
            source = $Source
            status = $Status
            records = @($Records)
        })
    return $path
}

function Clear-RecognizedOutputFiles {
    param([Parameter(Mandatory = $true)][string]$OutputPath)

    foreach ($existing in Get-RecognizedExistingFiles -Path $OutputPath) {
        Remove-Item -LiteralPath $existing -Force -ErrorAction Stop
    }
}

function Promote-StagedFiles {
    param(
        [Parameter(Mandatory = $true)]
        [string]$StageDirectory,
        [Parameter(Mandatory = $true)]
        [string]$OutputPath
    )

    foreach ($file in Get-ChildItem -LiteralPath $StageDirectory -File -ErrorAction Stop) {
        $destination = Join-Path $OutputPath $file.Name
        [System.IO.File]::Move($file.FullName, $destination, $true)
    }
}

function Get-CustomerSlug {
    <#
    .SYNOPSIS
    Folder-safe slug for a customer name.

    .DESCRIPTION
    Mirrors slugify() in src/lib/customer-data/paths.ts so the collector and the
    ingest agree on which folder a customer owns. Diacritics are stripped, so
    "Ação" and "Acao" resolve to the same workspace instead of two.
    #>
    param([Parameter(Mandatory = $true)][string]$Name)

    $normalized = $Name.Normalize([System.Text.NormalizationForm]::FormD)
    $withoutMarks = ($normalized.ToCharArray() | Where-Object {
        [System.Globalization.CharUnicodeInfo]::GetUnicodeCategory($_) -ne
            [System.Globalization.UnicodeCategory]::NonSpacingMark
    }) -join ''

    $slug = $withoutMarks.ToLowerInvariant()
    $slug = [regex]::Replace($slug, '[^a-z0-9]+', '-')
    $slug = $slug.Trim('-')
    if ($slug.Length -gt 64) { $slug = $slug.Substring(0, 64).Trim('-') }

    if ([string]::IsNullOrWhiteSpace($slug)) {
        throw "Could not derive a folder name from CustomerName '$Name'. Pass -OutputDirectory explicitly."
    }
    return $slug
}

function Invoke-AzureDashboardCollection {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$CustomerName,
        [Parameter(Mandatory = $true)]
        [string[]]$SubscriptionIds,
        [string]$OutputDirectory,
        [Parameter(Mandatory = $true)]
        [int]$Months,
        [Parameter(Mandatory = $true)]
        [int]$MetricsDays,
        [switch]$NonInteractive,
        [switch]$Force,
        [scriptblock]$AzCommandRunner,
        [scriptblock]$WebRequestRunner,
        [scriptblock]$DelayRunner,
        [scriptblock]$PromptRunner
    )

    if ([string]::IsNullOrWhiteSpace($CustomerName)) {
        throw 'CustomerName is required.'
    }

    # Each customer owns input\customer\<slug>. Collecting two customers into a
    # shared folder used to merge them into one dataset at ingest time.
    if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
        $OutputDirectory = Join-Path (Join-Path $PSScriptRoot 'customer') (Get-CustomerSlug -Name $CustomerName)
    }

    $script:CollectorContext = @{
        AzCommandRunner = if ($AzCommandRunner) { $AzCommandRunner } else { ${function:Invoke-DefaultAzCommandRunner} }
        WebRequestRunner = if ($WebRequestRunner) { $WebRequestRunner } else { ${function:Invoke-DefaultWebRequestRunner} }
        DelayRunner = if ($DelayRunner) { $DelayRunner } else { { param($Seconds) Start-Sleep -Seconds $Seconds } }
        PromptRunner = if ($PromptRunner) { $PromptRunner } else { { param($Message) Read-Host $Message } }
        AccessToken = $null
    }

    Test-PowerShellAndAzPrerequisites -SkipAzExecutableCheck:([bool]$AzCommandRunner)

    Test-ActiveAzLogin
    $validatedSubscriptions = Get-ValidatedSubscriptions -RequestedSubscriptionIds $SubscriptionIds
    Ensure-ResourceGraphExtension

    $resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
    if (Test-Path -LiteralPath $resolvedOutput -PathType Leaf) {
        throw "OutputDirectory '$resolvedOutput' points to a file. Provide a directory path instead."
    }
    New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null

    $existingRecognized = Get-RecognizedExistingFiles -Path $resolvedOutput
    if ($existingRecognized.Count -gt 0 -and -not $Force.IsPresent) {
        throw "Recognized collector outputs already exist in '$resolvedOutput'. Re-run with -Force to replace them."
    }

    $stageDirectory = Join-Path $resolvedOutput ('.collectAzureDashboardData.' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $stageDirectory -Force | Out-Null

    $sourceEntries = [ordered]@{
        resourceGraph = (New-SourceEntry -Name 'resourceGraph' -OutputFile $script:ResourceGraphFileName)
        advisor = (New-SourceEntry -Name 'advisor' -OutputFile $script:AdvisorFileName)
        policy = (New-SourceEntry -Name 'policy' -OutputFile 'policy.json')
        security = (New-SourceEntry -Name 'security' -OutputFile 'security.json')
        health = (New-SourceEntry -Name 'health' -OutputFile 'health.json')
        patch = (New-SourceEntry -Name 'patch' -OutputFile 'patch.json')
        operations = (New-SourceEntry -Name 'operations' -OutputFile 'operations.json')
        metrics = (New-SourceEntry -Name 'metrics' -OutputFile 'metrics.json')
        budgets = (New-SourceEntry -Name 'budgets' -OutputFile 'budgets.json')
        commitments = (New-SourceEntry -Name 'commitments' -OutputFile 'commitments.json')
        costDetails = (New-SourceEntry -Name 'costDetails' -OutputFile $null)
    }

    $recognizedThisRun = New-Object System.Collections.Generic.List[string]
    $resourceGraphRecords = @()

    try {
        $subscriptionIdValues = @($validatedSubscriptions | ForEach-Object { [string]$_['id'] })

        Start-SourceEntry -Entry $sourceEntries['resourceGraph']
        try {
            $resourceQuery = @"
resources
| project id, name, type, subscriptionId, resourceGroup, location, sku = tostring(sku.name), tags
"@
            $resourceRows = Invoke-AzGraphQueryPaged -Query $resourceQuery -SubscriptionIds $subscriptionIdValues -Operation 'Collect Resource Graph inventory'
            $resourceGraphRecords = @($resourceRows | ForEach-Object { Normalize-ResourceGraphRecord -Row $_ })
            if ($resourceGraphRecords.Count -gt 0) {
                [void](Save-ArrayOutput -StageDirectory $stageDirectory -FileName $script:ResourceGraphFileName -Source 'resourceGraph' -Status 'available' -Records $resourceGraphRecords)
                [void]$recognizedThisRun.Add($script:ResourceGraphFileName)
                Complete-SourceEntry -Entry $sourceEntries['resourceGraph'] -State 'collected' -Counts ([ordered]@{ rowCount = $resourceGraphRecords.Count }) -Artifacts @($script:ResourceGraphFileName) -Errors @() -Actions @()
            }
            else {
                [void](Save-ArrayOutput -StageDirectory $stageDirectory -FileName $script:ResourceGraphFileName -Source 'resourceGraph' -Status 'available' -Records @())
                [void]$recognizedThisRun.Add($script:ResourceGraphFileName)
                Complete-SourceEntry -Entry $sourceEntries['resourceGraph'] -State 'empty' -Counts ([ordered]@{ rowCount = 0 }) -Artifacts @($script:ResourceGraphFileName) -Errors @() -Actions @()
            }
        }
        catch {
            $state = Resolve-SourceFailureState -Exception $_.Exception
            [void](Save-ArrayOutput -StageDirectory $stageDirectory -FileName $script:ResourceGraphFileName -Source 'resourceGraph' -Status $state -Records @())
            [void]$recognizedThisRun.Add($script:ResourceGraphFileName)
            Complete-SourceEntry -Entry $sourceEntries['resourceGraph'] -State $state -Counts ([ordered]@{ rowCount = 0 }) -Artifacts @() -Errors @($_.Exception.Message) -Actions @()
        }

        Start-SourceEntry -Entry $sourceEntries['advisor']
        try {
            $advisorQuery = @"
advisorresources
| where type =~ 'microsoft.advisor/recommendations'
| extend p = properties
| project
    id,
    category = tostring(p.category),
    impact = tostring(p.impact),
    title = tostring(p.shortDescription.problem),
    description = tostring(p.shortDescription.solution),
    resourceId = tostring(p.resourceMetadata.resourceId),
    resourceType = tostring(p.impactedField),
    recommendationTypeId = tostring(p.recommendationTypeId),
    annualSavingsAmount = todouble(p.extendedProperties.annualSavingsAmount),
    currency = tostring(p.extendedProperties.savingsCurrency),
    extendedProperties = p.extendedProperties
"@
            $advisorRows = Invoke-AzGraphQueryPaged -Query $advisorQuery -SubscriptionIds $subscriptionIdValues -Operation 'Collect Azure Advisor recommendations'
            $advisorRecords = @($advisorRows | ForEach-Object { Normalize-AdvisorRecord -Row $_ })
            if ($advisorRecords.Count -gt 0) {
                [void](Save-ArrayOutput -StageDirectory $stageDirectory -FileName $script:AdvisorFileName -Source 'advisor' -Status 'available' -Records $advisorRecords)
                [void]$recognizedThisRun.Add($script:AdvisorFileName)
                Complete-SourceEntry -Entry $sourceEntries['advisor'] -State 'collected' -Counts ([ordered]@{ rowCount = $advisorRecords.Count }) -Artifacts @($script:AdvisorFileName) -Errors @() -Actions @()
            }
            else {
                [void](Save-ArrayOutput -StageDirectory $stageDirectory -FileName $script:AdvisorFileName -Source 'advisor' -Status 'available' -Records @())
                [void]$recognizedThisRun.Add($script:AdvisorFileName)
                Complete-SourceEntry -Entry $sourceEntries['advisor'] -State 'empty' -Counts ([ordered]@{ rowCount = 0 }) -Artifacts @($script:AdvisorFileName) -Errors @() -Actions @()
            }
        }
        catch {
            $state = Resolve-SourceFailureState -Exception $_.Exception
            [void](Save-ArrayOutput -StageDirectory $stageDirectory -FileName $script:AdvisorFileName -Source 'advisor' -Status $state -Records @())
            [void]$recognizedThisRun.Add($script:AdvisorFileName)
            Complete-SourceEntry -Entry $sourceEntries['advisor'] -State $state -Counts ([ordered]@{ rowCount = 0 }) -Artifacts @() -Errors @($_.Exception.Message) -Actions @()
        }

        $optionalGraphSources = @(
            @{
                Key = 'policy'
                FileName = 'policy.json'
                Query = @"
policyresources
| where type =~ 'microsoft.policyinsights/policystates'
| project
    subscriptionId,
    resourceId = tostring(properties.resourceId),
    policyAssignmentId = tostring(properties.policyAssignmentId),
    policyDefinitionId = tostring(properties.policyDefinitionId),
    complianceState = tostring(properties.complianceState)
"@
            },
            @{
                Key = 'security'
                FileName = 'security.json'
                Query = @"
securityresources
| where type == 'microsoft.security/assessments'
| project
    subscriptionId,
    resourceId = tostring(properties.resourceDetails.ResourceId),
    assessmentKey = tostring(name),
    displayName = tostring(properties.displayName),
    severity = tostring(properties.metadata.severity),
    status = tostring(properties.status.code)
"@
            },
            @{
                Key = 'health'
                FileName = 'health.json'
                Query = @"
healthresources
| where type =~ 'microsoft.resourcehealth/availabilitystatuses'
| project
    subscriptionId,
    resourceId = tostring(properties.targetResourceId),
    availabilityState = tostring(properties.availabilityState),
    reasonType = tostring(properties.reasonType)
"@
            },
            @{
                Key = 'patch'
                FileName = 'patch.json'
                Query = @"
patchassessmentresources
| where type !has 'softwarepatches'
| project
    subscriptionId,
    resourceId = tostring(coalesce(properties.resourceId, id)),
    status = tostring(properties.status),
    criticalCount = toint(coalesce(properties.availablePatchCountByClassification.critical, 0)),
    securityCount = toint(coalesce(properties.availablePatchCountByClassification.security, 0)),
    otherCount = toint(coalesce(properties.availablePatchCountByClassification.other, 0) + coalesce(properties.availablePatchCountByClassification.updates, 0) + coalesce(properties.availablePatchCountByClassification.tools, 0) + coalesce(properties.availablePatchCountByClassification.featurePack, 0) + coalesce(properties.availablePatchCountByClassification.updateRollup, 0) + coalesce(properties.availablePatchCountByClassification.servicePack, 0) + coalesce(properties.availablePatchCountByClassification.definition, 0))
"@
            },
            @{
                Key = 'operations'
                FileName = 'operations.json'
                Query = @"
union isfuzzy=true
(
resources
| where type in~ ('microsoft.recoveryservices/vaults', 'microsoft.dataprotection/backupvaults')
| project subscriptionId, resourceId = id, kind = 'backup', status = 'configured'
),
(
resources
| where type =~ 'microsoft.insights/diagnosticsettings'
| project subscriptionId, resourceId = id, kind = 'diagnostic', status = 'configured'
),
(
resources
| where type in~ ('microsoft.insights/activitylogalerts', 'microsoft.insights/metricalerts', 'microsoft.insights/scheduledqueryrules')
| project subscriptionId, resourceId = id, kind = 'alert', status = tostring(properties.enabled)
)
"@
            }
        )

        foreach ($source in $optionalGraphSources) {
            $entry = $sourceEntries[[string]$source['Key']]
            Start-SourceEntry -Entry $entry
            try {
                $rows = Invoke-AzGraphQueryPaged -Query ([string]$source['Query']) -SubscriptionIds $subscriptionIdValues -Operation "Collect $($source['Key']) evidence"
                $records = @($rows)
                if ($records.Count -gt 0) {
                    [void](Save-ArrayOutput -StageDirectory $stageDirectory -FileName ([string]$source['FileName']) -Source ([string]$source['Key']) -Status 'available' -Records $records)
                    [void]$recognizedThisRun.Add([string]$source['FileName'])
                    Complete-SourceEntry -Entry $entry -State 'collected' -Counts ([ordered]@{ rowCount = $records.Count }) -Artifacts @([string]$source['FileName']) -Errors @() -Actions @()
                }
                else {
                    [void](Save-ArrayOutput -StageDirectory $stageDirectory -FileName ([string]$source['FileName']) -Source ([string]$source['Key']) -Status 'available' -Records @())
                    [void]$recognizedThisRun.Add([string]$source['FileName'])
                    Complete-SourceEntry -Entry $entry -State 'empty' -Counts ([ordered]@{ rowCount = 0 }) -Artifacts @([string]$source['FileName']) -Errors @() -Actions @()
                }
            }
            catch {
                $state = Resolve-SourceFailureState -Exception $_.Exception
                [void](Save-ArrayOutput -StageDirectory $stageDirectory -FileName ([string]$source['FileName']) -Source ([string]$source['Key']) -Status $state -Records @())
                [void]$recognizedThisRun.Add([string]$source['FileName'])
                Complete-SourceEntry -Entry $entry -State $state -Counts ([ordered]@{ rowCount = 0 }) -Artifacts @() -Errors @($_.Exception.Message) -Actions @()
            }
        }

        Start-SourceEntry -Entry $sourceEntries['metrics']
        try {
            if ($sourceEntries['resourceGraph']['state'] -ne 'collected') {
                [void](Save-ArrayOutput -StageDirectory $stageDirectory -FileName 'metrics.json' -Source 'metrics' -Status 'skipped' -Records @())
                [void]$recognizedThisRun.Add('metrics.json')
                Complete-SourceEntry -Entry $sourceEntries['metrics'] -State 'skipped' -Counts ([ordered]@{ rowCount = 0; targetCount = 0 }) -Artifacts @() -Errors @() -Actions @('Collect resource inventory successfully before retrying metrics.')
            }
            else {
                $metricsRecords = Invoke-MetricsCollection -ResourceGraphRecords $resourceGraphRecords -Days $MetricsDays
                [void](Save-ArrayOutput -StageDirectory $stageDirectory -FileName 'metrics.json' -Source 'metrics' -Status 'available' -Records $metricsRecords)
                [void]$recognizedThisRun.Add('metrics.json')
                $metricsState = if ($metricsRecords.Count -gt 0) { 'collected' } else { 'empty' }
                Complete-SourceEntry -Entry $sourceEntries['metrics'] -State $metricsState -Counts ([ordered]@{ rowCount = $metricsRecords.Count; targetCount = [math]::Min($resourceGraphRecords.Count, 25) }) -Artifacts @('metrics.json') -Errors @() -Actions @()
            }
        }
        catch {
            $state = Resolve-SourceFailureState -Exception $_.Exception
            [void](Save-ArrayOutput -StageDirectory $stageDirectory -FileName 'metrics.json' -Source 'metrics' -Status $state -Records @())
            [void]$recognizedThisRun.Add('metrics.json')
            Complete-SourceEntry -Entry $sourceEntries['metrics'] -State $state -Counts ([ordered]@{ rowCount = 0 }) -Artifacts @() -Errors @($_.Exception.Message) -Actions @()
        }

        Start-SourceEntry -Entry $sourceEntries['budgets']
        try {
            $budgetRecords = @()
            foreach ($subscription in $validatedSubscriptions) {
                $budgetUrl = "https://management.azure.com/subscriptions/$($subscription['id'])/providers/Microsoft.Consumption/budgets?api-version=2024-08-01"
                $budgetResponse = Invoke-AzRestJson -Method 'get' -Url $budgetUrl -Body $null -Operation "Collect budgets for $($subscription['label'])"
                foreach ($item in @($budgetResponse['value'])) {
                    $budgetRecords += [ordered]@{
                        subscriptionId = [string]$subscription['id']
                        name = ConvertTo-StringValue -Value $item['name']
                        amount = ConvertTo-DoubleValue -Value (Get-DeepValue -InputObject $item -Path 'properties.amount')
                        currentSpend = ConvertTo-DoubleValue -Value (Get-DeepValue -InputObject $item -Path 'properties.currentSpend.amount')
                        currency = ConvertTo-StringValue -Value (Get-DeepValue -InputObject $item -Path 'properties.currentSpend.unit')
                        timeGrain = ConvertTo-StringValue -Value (Get-DeepValue -InputObject $item -Path 'properties.timeGrain')
                        startDateUtc = ConvertTo-StringValue -Value (Get-DeepValue -InputObject $item -Path 'properties.timePeriod.startDate')
                        endDateUtc = ConvertTo-StringValue -Value (Get-DeepValue -InputObject $item -Path 'properties.timePeriod.endDate')
                    }
                }
            }

            [void](Save-ArrayOutput -StageDirectory $stageDirectory -FileName 'budgets.json' -Source 'budgets' -Status 'available' -Records $budgetRecords)
            [void]$recognizedThisRun.Add('budgets.json')
            $state = if ($budgetRecords.Count -gt 0) { 'collected' } else { 'empty' }
            Complete-SourceEntry -Entry $sourceEntries['budgets'] -State $state -Counts ([ordered]@{ rowCount = $budgetRecords.Count }) -Artifacts @('budgets.json') -Errors @() -Actions @()
        }
        catch {
            $state = Resolve-SourceFailureState -Exception $_.Exception
            [void](Save-ArrayOutput -StageDirectory $stageDirectory -FileName 'budgets.json' -Source 'budgets' -Status $state -Records @())
            [void]$recognizedThisRun.Add('budgets.json')
            Complete-SourceEntry -Entry $sourceEntries['budgets'] -State $state -Counts ([ordered]@{ rowCount = 0 }) -Artifacts @() -Errors @($_.Exception.Message) -Actions @()
        }

        Start-SourceEntry -Entry $sourceEntries['commitments']
        try {
            $commitmentRecords = @()
            foreach ($subscription in $validatedSubscriptions) {
                $commitmentUrl = "https://management.azure.com/subscriptions/$($subscription['id'])/providers/Microsoft.CostManagement/benefitRecommendations?api-version=2025-03-01"
                $commitmentResponse = Invoke-AzRestJson -Method 'get' -Url $commitmentUrl -Body $null -Operation "Collect commitment recommendations for $($subscription['label'])"
                foreach ($item in @($commitmentResponse['value'])) {
                    $properties = if ($item['properties']) { $item['properties'] } else { @{} }
                    $annualSavings = Get-DeepValue -InputObject $properties -Path 'annualSavings.amount'
                    if ($null -eq $annualSavings) {
                        $annualSavings = Get-DeepValue -InputObject $properties -Path 'savingsAmount.amount'
                    }
                    $currency = Get-DeepValue -InputObject $properties -Path 'annualSavings.currency'
                    if ($null -eq $currency) {
                        $currency = Get-DeepValue -InputObject $properties -Path 'savingsAmount.currency'
                    }
                    $commitmentRecords += [ordered]@{
                        subscriptionId = [string]$subscription['id']
                        resourceType = ConvertTo-StringValue -Value (Get-DeepValue -InputObject $properties -Path 'resourceType')
                        recommendationType = ConvertTo-StringValue -Value ($item['kind'] ?? (Get-DeepValue -InputObject $properties -Path 'recommendationType'))
                        term = ConvertTo-StringValue -Value (Get-DeepValue -InputObject $properties -Path 'term')
                        lookBackPeriod = ConvertTo-StringValue -Value (Get-DeepValue -InputObject $properties -Path 'lookBackPeriod')
                        quantity = ConvertTo-DoubleValue -Value (Get-DeepValue -InputObject $properties -Path 'quantity')
                        annualSavings = ConvertTo-DoubleValue -Value $annualSavings
                        currency = ConvertTo-StringValue -Value $currency
                        utilizationPercentage = ConvertTo-DoubleValue -Value (Get-DeepValue -InputObject $properties -Path 'utilizationPercentage')
                    }
                }
            }

            [void](Save-ArrayOutput -StageDirectory $stageDirectory -FileName 'commitments.json' -Source 'commitments' -Status 'available' -Records $commitmentRecords)
            [void]$recognizedThisRun.Add('commitments.json')
            $state = if ($commitmentRecords.Count -gt 0) { 'collected' } else { 'empty' }
            Complete-SourceEntry -Entry $sourceEntries['commitments'] -State $state -Counts ([ordered]@{ rowCount = $commitmentRecords.Count }) -Artifacts @('commitments.json') -Errors @() -Actions @()
        }
        catch {
            $state = Resolve-SourceFailureState -Exception $_.Exception
            [void](Save-ArrayOutput -StageDirectory $stageDirectory -FileName 'commitments.json' -Source 'commitments' -Status $state -Records @())
            [void]$recognizedThisRun.Add('commitments.json')
            Complete-SourceEntry -Entry $sourceEntries['commitments'] -State $state -Counts ([ordered]@{ rowCount = 0 }) -Artifacts @() -Errors @($_.Exception.Message) -Actions @()
        }

        Start-SourceEntry -Entry $sourceEntries['costDetails']
        $periods = Get-CollectionPeriods -MonthCount $Months
        $costArtifacts = New-Object System.Collections.Generic.List[string]
        $costErrors = New-Object System.Collections.Generic.List[string]
        $costActions = New-Object System.Collections.Generic.List[string]
        $costCollectedCount = 0
        $costRowCount = 0
        $costSkippedCount = 0
        $costForbiddenCount = 0
        foreach ($subscription in $validatedSubscriptions) {
            foreach ($period in $periods) {
                try {
                    $result = Export-CostDetailsCsv -Subscription $subscription -Period $period -StageDirectory $stageDirectory
                    switch ($result['state']) {
                        'collected' {
                            [void]$recognizedThisRun.Add([string]$result['fileName'])
                            [void]$costArtifacts.Add([string]$result['fileName'])
                            $costCollectedCount += 1
                            $costRowCount += [int]$result['rowCount']
                        }
                        'forbidden' {
                            $costForbiddenCount += 1
                            [void]$costErrors.Add([string]$result['error'])
                            [void]$costActions.Add([string]$result['action'])
                        }
                        default {
                            $costSkippedCount += 1
                            [void]$costErrors.Add([string]$result['error'])
                            [void]$costActions.Add([string]$result['action'])
                        }
                    }
                }
                catch {
                    [void]$costErrors.Add($_.Exception.Message)
                }
            }
        }

        $costState = if ($costCollectedCount -gt 0) {
            'collected'
        }
        elseif ($costForbiddenCount -gt 0 -and $costSkippedCount -eq 0) {
            'forbidden'
        }
        elseif ($costSkippedCount -gt 0 -and $costForbiddenCount -eq 0 -and $costErrors.Count -eq $costSkippedCount) {
            'skipped'
        }
        elseif ($costErrors.Count -gt 0) {
            'failed'
        }
        else {
            'empty'
        }
        Complete-SourceEntry -Entry $sourceEntries['costDetails'] -State $costState -Counts ([ordered]@{
                requestedPeriods = $validatedSubscriptions.Count * $periods.Count
                collectedFiles = $costCollectedCount
                rowCount = $costRowCount
            }) -Artifacts $costArtifacts.ToArray() -Errors $costErrors.ToArray() -Actions $costActions.ToArray()

        $manifest = [ordered]@{
            schemaVersion = $script:CollectorSchemaVersion
            collectedAtUtc = Get-UtcTimestamp
            customerName = $CustomerName
            outputDirectory = $resolvedOutput
            parameters = [ordered]@{
                months = $Months
                metricsDays = $MetricsDays
                nonInteractive = [bool]$NonInteractive.IsPresent
                force = [bool]$Force.IsPresent
                subscriptionCount = $validatedSubscriptions.Count
            }
            sources = $sourceEntries
        }
        Write-JsonFile -Path (Join-Path $stageDirectory $script:CollectionManifestFileName) -Data $manifest
        [void]$recognizedThisRun.Add($script:CollectionManifestFileName)

        if ($Force.IsPresent) {
            Clear-RecognizedOutputFiles -OutputPath $resolvedOutput
        }
        Promote-StagedFiles -StageDirectory $stageDirectory -OutputPath $resolvedOutput

        $summaryCounts = @{}
        foreach ($entry in $sourceEntries.Values) {
            $state = [string]$entry['state']
            if (-not $summaryCounts.ContainsKey($state)) {
                $summaryCounts[$state] = 0
            }
            $summaryCounts[$state] += 1
        }

        Write-Host ("Collection complete. collected={0} empty={1} skipped={2} forbidden={3} failed={4}" -f `
            ($summaryCounts['collected'] ?? 0), `
            ($summaryCounts['empty'] ?? 0), `
            ($summaryCounts['skipped'] ?? 0), `
            ($summaryCounts['forbidden'] ?? 0), `
            ($summaryCounts['failed'] ?? 0))
        Write-Host "Output directory updated."
    }
    finally {
        if (Test-Path -LiteralPath $stageDirectory) {
            Remove-Item -LiteralPath $stageDirectory -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    Invoke-AzureDashboardCollection `
        -CustomerName $CustomerName `
        -SubscriptionIds $SubscriptionIds `
        -OutputDirectory $OutputDirectory `
        -Months $Months `
        -MetricsDays $MetricsDays `
        -NonInteractive:$NonInteractive `
        -Force:$Force `
        -AzCommandRunner $AzCommandRunner `
        -WebRequestRunner $WebRequestRunner `
        -DelayRunner $DelayRunner `
        -PromptRunner $PromptRunner
}
