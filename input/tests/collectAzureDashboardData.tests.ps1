Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$collectorPath = Join-Path $repoRoot 'input\collectAzureDashboardData.ps1'
. $collectorPath

$scratchRoot = Join-Path $PSScriptRoot '_scratch'

function Assert-True {
    param(
        [Parameter(Mandatory = $true)]
        [bool]$Condition,
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Assert-Equal {
    param(
        [Parameter(Mandatory = $true)]
        $Actual,
        [Parameter(Mandatory = $true)]
        $Expected,
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    if ($Actual -ne $Expected) {
        throw "$Message Expected='$Expected' Actual='$Actual'"
    }
}

function Assert-Match {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Actual,
        [Parameter(Mandatory = $true)]
        [string]$Pattern,
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    if ($Actual -notmatch $Pattern) {
        throw "$Message Pattern='$Pattern' Actual='$Actual'"
    }
}

function New-TestDirectory {
    param([Parameter(Mandatory = $true)][string]$Name)

    $path = Join-Path $scratchRoot $Name
    if (Test-Path -LiteralPath $path) {
        Remove-Item -LiteralPath $path -Recurse -Force
    }
    New-Item -ItemType Directory -Path $path -Force | Out-Null
    return $path
}

function ConvertTo-RunnerResult {
    param(
        [int]$ExitCode = 0,
        [string]$StdOut = '',
        [string]$StdErr = ''
    )

    return [ordered]@{
        ExitCode = $ExitCode
        StdOut = $StdOut
        StdErr = $StdErr
    }
}

function New-MockAzRunner {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Scenario
    )

    return {
        param([string[]]$Arguments)

        $json = {
            param($Object)
            return ($Object | ConvertTo-Json -Depth 20 -Compress)
        }

        if ($Arguments[0] -eq 'account' -and $Arguments[1] -eq 'show') {
            return ConvertTo-RunnerResult -StdOut (& $json @{ id = 'tenant-context'; user = @{ name = 'mock@contoso.test' } })
        }

        if ($Arguments[0] -eq 'account' -and $Arguments[1] -eq 'list') {
            return ConvertTo-RunnerResult -StdOut (& $json @(
                    @{ id = 'sub-a'; state = 'Enabled' }
                ))
        }

        if ($Arguments[0] -eq 'account' -and $Arguments[1] -eq 'get-access-token') {
            return ConvertTo-RunnerResult -StdOut (& $json @{ accessToken = 'mock-token' })
        }

        if ($Arguments[0] -eq 'extension' -and $Arguments[1] -eq 'show') {
            if ($Scenario['ExtensionInstalled']) {
                return ConvertTo-RunnerResult -StdOut (& $json @{ name = 'resource-graph' })
            }
            return ConvertTo-RunnerResult -ExitCode 1 -StdErr 'resource-graph extension not installed'
        }

        if ($Arguments[0] -eq 'extension' -and $Arguments[1] -eq 'add') {
            $Scenario['ExtensionInstalled'] = $true
            return ConvertTo-RunnerResult -StdOut ''
        }

        if ($Arguments[0] -eq 'graph' -and $Arguments[1] -eq 'query') {
            $queryIndex = [Array]::IndexOf($Arguments, '-q')
            $query = $Arguments[$queryIndex + 1]
            $skipIndex = [Array]::IndexOf($Arguments, '--skip-token')
            $skipToken = if ($skipIndex -ge 0) { $Arguments[$skipIndex + 1] } else { $null }

            if ($query -match 'project id, name, type, subscriptionId, resourceGroup, location, sku = tostring\(sku\.name\), tags') {
                if ($Scenario['RepeatedToken']) {
                    if ($null -eq $skipToken) {
                        return ConvertTo-RunnerResult -StdOut (& $json @{
                                data = @(
                                    @{
                                        id = '/subscriptions/sub-a/resourceGroups/rg-a/providers/Microsoft.Compute/virtualMachines/vm-a'
                                        name = 'vm-a'
                                        type = 'microsoft.compute/virtualmachines'
                                        subscriptionId = 'sub-a'
                                        resourceGroup = 'rg-a'
                                        location = 'eastus'
                                        sku = 'Standard_D2s_v5'
                                        tags = @{ env = 'test' }
                                    }
                                )
                                skipToken = 'loop-token'
                            })
                    }

                    return ConvertTo-RunnerResult -StdOut (& $json @{
                            data = @(
                                @{
                                    id = '/subscriptions/sub-a/resourceGroups/rg-a/providers/Microsoft.Compute/virtualMachineScaleSets/vmss-a'
                                    name = 'vmss-a'
                                    type = 'microsoft.compute/virtualmachinescalesets'
                                    subscriptionId = 'sub-a'
                                    resourceGroup = 'rg-a'
                                    location = 'eastus'
                                    sku = 'Standard_D4s_v5'
                                    tags = @{ env = 'test' }
                                }
                            )
                            skipToken = 'loop-token'
                        })
                }

                if ($null -eq $skipToken) {
                    return ConvertTo-RunnerResult -StdOut (& $json @{
                            data = @(
                                @{
                                    id = '/subscriptions/sub-a/resourceGroups/rg-a/providers/Microsoft.Compute/virtualMachines/vm-a'
                                    name = 'vm-a'
                                    type = 'microsoft.compute/virtualmachines'
                                    subscriptionId = 'sub-a'
                                    resourceGroup = 'rg-a'
                                    location = 'eastus'
                                    sku = 'Standard_D2s_v5'
                                    tags = @{ env = 'test' }
                                }
                            )
                            skipToken = 'page-2'
                        })
                }

                return ConvertTo-RunnerResult -StdOut (& $json @{
                        data = @(
                            @{
                                id = '/subscriptions/sub-a/resourceGroups/rg-a/providers/Microsoft.Compute/virtualMachineScaleSets/vmss-a'
                                name = 'vmss-a'
                                type = 'microsoft.compute/virtualmachinescalesets'
                                subscriptionId = 'sub-a'
                                resourceGroup = 'rg-a'
                                location = 'eastus'
                                sku = 'Standard_F4s_v2'
                                tags = @{ tier = 'app' }
                            }
                        )
                    })
            }

            if ($query -match 'advisorresources') {
                return ConvertTo-RunnerResult -StdOut (& $json @{
                        data = @(
                            @{
                                id = 'rec-1'
                                category = 'Cost'
                                impact = 'High'
                                title = 'Idle VM'
                                description = 'Shut down the VM'
                                resourceId = '/subscriptions/sub-a/resourceGroups/rg-a/providers/Microsoft.Compute/virtualMachines/vm-a'
                                resourceType = 'Microsoft.Compute/virtualMachines'
                                recommendationTypeId = 'shutdown'
                                annualSavingsAmount = 1200
                                currency = 'USD'
                                extendedProperties = @{ annualSavingsAmount = '1200'; savingsCurrency = 'USD' }
                            }
                        )
                    })
            }

            if ($query -match 'policyresources') {
                return ConvertTo-RunnerResult -ExitCode 1 -StdErr '403 Forbidden'
            }

            if ($query -match 'securityresources') {
                return ConvertTo-RunnerResult -StdOut (& $json @{ data = @() })
            }

            if ($query -match 'healthresources') {
                return ConvertTo-RunnerResult -StdOut (& $json @{ data = @() })
            }

            if ($query -match 'patchassessmentresources') {
                return ConvertTo-RunnerResult -StdOut (& $json @{ data = @() })
            }

            if ($query -match 'union isfuzzy=true') {
                return ConvertTo-RunnerResult -StdOut (& $json @{
                        data = @(
                            @{
                                subscriptionId = 'sub-a'
                                resourceId = '/subscriptions/sub-a/resourceGroups/rg-a/providers/Microsoft.Insights/activityLogAlerts/alert-a'
                                kind = 'alert'
                                status = 'true'
                            }
                        )
                    })
            }
        }

        if ($Arguments[0] -eq 'rest') {
            $method = $Arguments[[Array]::IndexOf($Arguments, '--method') + 1]
            $url = $Arguments[[Array]::IndexOf($Arguments, '--url') + 1]

            if ($method -eq 'get' -and $url -match 'microsoft\.insights/metrics') {
                return ConvertTo-RunnerResult -StdOut (& $json @{
                        value = @(
                            @{
                                timeseries = @(
                                    @{
                                        data = @(
                                            @{ average = 10.5; maximum = 50.0 },
                                            @{ average = 20.5; maximum = 60.0 }
                                        )
                                    }
                                )
                            }
                        )
                    })
            }

            if ($method -eq 'get' -and $url -match 'Microsoft\.Consumption/budgets') {
                return ConvertTo-RunnerResult -StdOut (& $json @{
                        value = @(
                            @{
                                name = 'budget-a'
                                properties = @{
                                    amount = 1000
                                    currentSpend = @{
                                        amount = 250
                                        unit = 'USD'
                                    }
                                    timeGrain = 'Monthly'
                                    timePeriod = @{
                                        startDate = '2026-08-01'
                                        endDate = '2026-08-31'
                                    }
                                }
                            }
                        )
                    })
            }

            if ($method -eq 'get' -and $url -match 'benefitRecommendations') {
                return ConvertTo-RunnerResult -StdOut (& $json @{ value = @() })
            }
        }

        throw "Unhandled Azure CLI call in test harness: $($Arguments -join ' ')"
    }.GetNewClosure()
}

function New-MockWebRunner {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Scenario
    )

    return {
        param([System.Collections.IDictionary]$Request)

        if ([string]$Request['Uri'] -notmatch '^https://mock\.local/blob/') {
            $authorization = [string]$Request['Headers']['Authorization']
            if ($authorization -ne 'Bearer mock-token') {
                throw "Expected a real Bearer Authorization header."
            }
            $Scenario['AuthHeaderChecks'] = [int]($Scenario['AuthHeaderChecks'] ?? 0) + 1
        }

        if ($Request['Method'] -eq 'POST' -and [string]$Request['Uri'] -match 'generateCostDetailsReport') {
            $body = $Request['Body'] | ConvertFrom-Json -AsHashtable
            if ([string]$body['metric'] -ne 'AmortizedCost') {
                throw "Cost Details requests must use AmortizedCost."
            }
            $Scenario['CostMetricChecks'] = [int]($Scenario['CostMetricChecks'] ?? 0) + 1
            return [ordered]@{
                StatusCode = 202
                Headers = @{
                    Location = 'https://mock.local/status/costdetails'
                    'Retry-After' = '1'
                }
                Content = ''
            }
        }

        if ($Request['Method'] -eq 'GET' -and [string]$Request['Uri'] -eq 'https://mock.local/status/costdetails') {
            return [ordered]@{
                StatusCode = 200
                Headers = @{}
                Content = (@{
                        manifest = @{
                            blobs = @(
                                @{ blobLink = 'https://mock.local/blob/part1' },
                                @{ blobLink = 'https://mock.local/blob/part2' }
                            )
                        }
                    } | ConvertTo-Json -Depth 10 -Compress)
            }
        }

        if ($Request['Method'] -eq 'GET' -and [string]$Request['Uri'] -eq 'https://mock.local/blob/part1') {
            return [ordered]@{
                StatusCode = 200
                Headers = @{}
                Content = "Date,CostInBillingCurrency,BillingCurrency,ResourceId,ResourceType`n2026-08-01,10,USD,/subscriptions/sub-a/vm-a,Microsoft.Compute/virtualMachines"
            }
        }

        if ($Request['Method'] -eq 'GET' -and [string]$Request['Uri'] -eq 'https://mock.local/blob/part2') {
            return [ordered]@{
                StatusCode = 200
                Headers = @{}
                Content = "Date,CostInBillingCurrency,BillingCurrency,ResourceId,ResourceType`n2026-08-02,20,USD,/subscriptions/sub-a/vm-b,Microsoft.Compute/virtualMachines"
            }
        }

        throw "Unhandled HTTP request in test harness: $($Request['Method']) $($Request['Uri'])"
    }
}

function Test-CollectorPaginationAndManifest {
    $outputDir = New-TestDirectory -Name 'pagination-manifest'
    $scenario = @{ ExtensionInstalled = $true; RepeatedToken = $false; AuthHeaderChecks = 0; CostMetricChecks = 0 }

    Invoke-AzureDashboardCollection `
        -CustomerName 'Synthetic Customer' `
        -SubscriptionIds @('sub-a') `
        -OutputDirectory $outputDir `
        -Months 1 `
        -MetricsDays 3 `
        -NonInteractive `
        -AzCommandRunner (New-MockAzRunner -Scenario $scenario) `
        -WebRequestRunner (New-MockWebRunner -Scenario $scenario) `
        -DelayRunner { param([int]$Seconds) } `
        -PromptRunner { param([string]$Message) 'n' }

    $resourceGraph = Get-Content -LiteralPath (Join-Path $outputDir 'resource-graph.json') -Raw | ConvertFrom-Json -AsHashtable
    $advisor = Get-Content -LiteralPath (Join-Path $outputDir 'advisor.json') -Raw | ConvertFrom-Json -AsHashtable
    $policy = Get-Content -LiteralPath (Join-Path $outputDir 'policy.json') -Raw | ConvertFrom-Json -AsHashtable
    $security = Get-Content -LiteralPath (Join-Path $outputDir 'security.json') -Raw | ConvertFrom-Json -AsHashtable
    $budgets = Get-Content -LiteralPath (Join-Path $outputDir 'budgets.json') -Raw | ConvertFrom-Json -AsHashtable
    $manifest = Get-Content -LiteralPath (Join-Path $outputDir 'collection-manifest.json') -Raw | ConvertFrom-Json -AsHashtable
    $csvFiles = @(Get-ChildItem -LiteralPath $outputDir -File | Where-Object { $_.Name -match '^cost-details-sub01-\d{4}-\d{2}\.csv$' })
    $csvText = Get-Content -LiteralPath $csvFiles[0].FullName -Raw

    Assert-Equal -Actual $resourceGraph['schemaVersion'] -Expected '1.0.0' -Message 'Resource Graph envelope schema version mismatch.'
    Assert-Equal -Actual $resourceGraph['source'] -Expected 'resourceGraph' -Message 'Resource Graph envelope source mismatch.'
    Assert-Equal -Actual $resourceGraph['status'] -Expected 'available' -Message 'Resource Graph envelope status mismatch.'
    Assert-Equal -Actual @($resourceGraph['records']).Count -Expected 2 -Message 'Resource Graph pagination should merge both pages.'
    Assert-Equal -Actual ([string]$resourceGraph['records'][0]['sku']) -Expected 'Standard_D2s_v5' -Message 'Resource Graph records should include canonical sku.'
    Assert-Equal -Actual $advisor['schemaVersion'] -Expected '1.0.0' -Message 'Advisor envelope schema version mismatch.'
    Assert-Equal -Actual $advisor['source'] -Expected 'advisor' -Message 'Advisor envelope source mismatch.'
    Assert-Equal -Actual $advisor['status'] -Expected 'available' -Message 'Advisor envelope status mismatch.'
    Assert-Equal -Actual @($advisor['records']).Count -Expected 1 -Message 'Advisor snapshot should contain one record.'
    Assert-True -Condition (-not [string]::IsNullOrWhiteSpace([string]$resourceGraph['capturedAtUtc'])) -Message 'Resource Graph envelope should include capturedAtUtc.'
    Assert-Equal -Actual $policy['status'] -Expected 'forbidden' -Message 'Forbidden optional snapshots should preserve their state.'
    Assert-Equal -Actual @($policy['records']).Count -Expected 0 -Message 'Forbidden optional snapshot should have no records.'
    Assert-Equal -Actual $security['status'] -Expected 'available' -Message 'Empty snapshot files should still be emitted as available envelopes.'
    Assert-Equal -Actual @($security['records']).Count -Expected 0 -Message 'Empty optional snapshot should have no records.'
    Assert-Equal -Actual $budgets['source'] -Expected 'budgets' -Message 'Optional snapshot source mismatch.'
    Assert-Equal -Actual $manifest['sources']['resourceGraph']['state'] -Expected 'collected' -Message 'Resource Graph manifest state mismatch.'
    Assert-Equal -Actual $manifest['sources']['policy']['state'] -Expected 'forbidden' -Message 'Optional 403 should be recorded as forbidden.'
    Assert-Equal -Actual $manifest['sources']['security']['state'] -Expected 'empty' -Message 'Empty optional sources should be recorded.'
    Assert-Equal -Actual $manifest['sources']['budgets']['state'] -Expected 'collected' -Message 'Budgets should be collected.'
    Assert-Equal -Actual $manifest['sources']['commitments']['state'] -Expected 'empty' -Message 'Empty commitments should be recorded.'
    Assert-Equal -Actual $manifest['sources']['metrics']['state'] -Expected 'collected' -Message 'Metrics should be collected from VM inventory.'
    Assert-Equal -Actual $manifest['sources']['costDetails']['state'] -Expected 'collected' -Message 'Cost details should be collected.'
    Assert-True -Condition ($scenario['AuthHeaderChecks'] -ge 2) -Message 'Management web calls should include Bearer authentication headers.'
    Assert-Equal -Actual $scenario['CostMetricChecks'] -Expected 1 -Message 'Cost Details should request AmortizedCost exactly once.'
    Assert-True -Condition ($csvFiles.Count -eq 1) -Message 'Exactly one deterministic legacy CSV should be generated.'
    Assert-Match -Actual $csvText -Pattern '2026-08-01' -Message 'Combined CSV should include the first blob row.'
    Assert-Match -Actual $csvText -Pattern '2026-08-02' -Message 'Combined CSV should include the second blob row.'
    $allOutputText = (Get-ChildItem -LiteralPath $outputDir -File | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw }) -join "`n"
    Assert-True -Condition ($allOutputText -notmatch 'mock-token') -Message 'Collector outputs and manifest must not contain access tokens.'
}

function Test-RepeatedSkipTokenGuard {
    $outputDir = New-TestDirectory -Name 'repeated-token'
    $scenario = @{ ExtensionInstalled = $true; RepeatedToken = $true; AuthHeaderChecks = 0; CostMetricChecks = 0 }

    Invoke-AzureDashboardCollection `
        -CustomerName 'Synthetic Customer' `
        -SubscriptionIds @('sub-a') `
        -OutputDirectory $outputDir `
        -Months 1 `
        -MetricsDays 3 `
        -NonInteractive `
        -AzCommandRunner (New-MockAzRunner -Scenario $scenario) `
        -WebRequestRunner (New-MockWebRunner -Scenario $scenario) `
        -DelayRunner { param([int]$Seconds) } `
        -PromptRunner { param([string]$Message) 'n' }

    $resourceGraph = Get-Content -LiteralPath (Join-Path $outputDir 'resource-graph.json') -Raw | ConvertFrom-Json -AsHashtable
    $metrics = Get-Content -LiteralPath (Join-Path $outputDir 'metrics.json') -Raw | ConvertFrom-Json -AsHashtable
    $manifest = Get-Content -LiteralPath (Join-Path $outputDir 'collection-manifest.json') -Raw | ConvertFrom-Json -AsHashtable
    Assert-Equal -Actual $resourceGraph['status'] -Expected 'failed' -Message 'Failed core snapshots should preserve their state.'
    Assert-Equal -Actual $metrics['status'] -Expected 'skipped' -Message 'Skipped dependent snapshots should preserve their state.'
    Assert-Equal -Actual $manifest['sources']['resourceGraph']['state'] -Expected 'failed' -Message 'Repeated skip token must fail the source.'
    Assert-Match -Actual ([string]($manifest['sources']['resourceGraph']['errors'] -join ' ')) -Pattern 'Repeated skip token' -Message 'Manifest should record the repeated token guard.'
    Assert-Equal -Actual $manifest['sources']['metrics']['state'] -Expected 'skipped' -Message 'Metrics should be skipped when inventory is unavailable.'
}

function Test-NonInteractiveExtensionBehavior {
    $outputDir = New-TestDirectory -Name 'noninteractive-extension'
    $scenario = @{ ExtensionInstalled = $false; RepeatedToken = $false; AuthHeaderChecks = 0; CostMetricChecks = 0 }
    $failed = $false

    try {
        Invoke-AzureDashboardCollection `
            -CustomerName 'Synthetic Customer' `
            -SubscriptionIds @('sub-a') `
            -OutputDirectory $outputDir `
            -Months 1 `
            -MetricsDays 3 `
            -NonInteractive `
            -AzCommandRunner (New-MockAzRunner -Scenario $scenario) `
            -WebRequestRunner (New-MockWebRunner -Scenario $scenario) `
            -DelayRunner { param([int]$Seconds) } `
            -PromptRunner { param([string]$Message) 'n' }
    }
    catch {
        $failed = $true
        Assert-Match -Actual $_.Exception.Message -Pattern 'az extension add --name resource-graph' -Message 'NonInteractive extension failure should be actionable.'
    }

    Assert-True -Condition $failed -Message 'NonInteractive extension validation should fail when the extension is missing.'
}

function Test-CustomerSlug {
    # The collector and the TypeScript ingest must agree on the folder a
    # customer owns, otherwise the collection lands where nothing reads it.
    Assert-Equal -Actual (Get-CustomerSlug -Name 'Contoso') -Expected 'contoso' -Message 'Simple name should slugify.'
    Assert-Equal -Actual (Get-CustomerSlug -Name 'Contoso Ltda.') -Expected 'contoso-ltda' -Message 'Punctuation should collapse into single dashes.'
    Assert-Equal -Actual (Get-CustomerSlug -Name 'Ação S/A') -Expected 'acao-s-a' -Message 'Diacritics should be stripped like slugify() does.'

    $rejected = $false
    try { Get-CustomerSlug -Name '!!!' | Out-Null } catch { $rejected = $true }
    Assert-True -Condition $rejected -Message 'A name with nothing usable must fail instead of inventing a folder.'
}

function Main {
    if (Test-Path -LiteralPath $scratchRoot) {
        Remove-Item -LiteralPath $scratchRoot -Recurse -Force
    }
    New-Item -ItemType Directory -Path $scratchRoot -Force | Out-Null

    try {
        Test-CustomerSlug
        Test-CollectorPaginationAndManifest
        Test-RepeatedSkipTokenGuard
        Test-NonInteractiveExtensionBehavior
    }
    finally {
        if (Test-Path -LiteralPath $scratchRoot) {
            Remove-Item -LiteralPath $scratchRoot -Recurse -Force
        }
    }

    Write-Host 'ok - collectAzureDashboardData tests'
}

if ($MyInvocation.InvocationName -ne '.') {
    Main
}
