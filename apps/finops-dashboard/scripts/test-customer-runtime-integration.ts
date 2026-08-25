import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Dependency-free module: safe to import before CUSTOMER_DATA_DIR is set below.
import { CUSTOMER_DATASET_SCHEMA_VERSION } from "../src/lib/customer-data/contract";

const generatedAtUtc = "2026-08-01T00:00:00.000Z";
const customerDir = path.resolve(process.cwd(), ".runtime-customer-check");
const processedDir = path.join(customerDir, ".processed");

function writeJson(file: string, value: unknown): void {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function createEvidenceFile<T>(records: T[]) {
  return {
    schemaVersion: "1.0.0",
    datasetGeneratedAtUtc: generatedAtUtc,
    status: "available" as const,
    sourceFiles: ["synthetic"],
    rowCount: records.length,
    records,
  };
}

async function main(): Promise<void> {
  fs.rmSync(customerDir, { recursive: true, force: true });
  fs.mkdirSync(processedDir, { recursive: true });

  process.env.CUSTOMER_DATA_DIR = customerDir;
  process.env.NEXT_PUBLIC_USE_MOCK = "true";
  delete process.env.ADX_CLUSTER_URI;

  const { NextRequest } = await import("next/server");
  const { resetCustomerDatasetCache } = await import(
    "../src/lib/customer-dataset"
  );
  const { resetCustomerAssessmentCache } = await import(
    "../src/lib/customer-assessment"
  );

  writeJson(path.join(processedDir, "manifest.json"), {
    schemaVersion: CUSTOMER_DATASET_SCHEMA_VERSION,
    customer: "Synthetic Co",
    format: "focus",
    generatedAtUtc,
    sourceFiles: ["synthetic.csv"],
    rowCount: 3,
    skippedRowCount: 0,
    periodStart: "2026-07-01",
    periodEnd: "2026-07-03",
    currencies: ["USD"],
    hasUsdCosts: true,
    warnings: [],
    assessmentEvidence: {
      resourceGraph: {
        status: "available",
        sourceFiles: ["resources.json"],
        rowCount: 2,
        outputFile: "resource-graph.json",
      },
      advisor: {
        status: "available",
        sourceFiles: ["advisor.json"],
        rowCount: 4,
        outputFile: "advisor.json",
      },
      policy: {
        status: "available",
        sourceFiles: ["policy.json"],
        rowCount: 2,
        outputFile: "policy.json",
      },
      metrics: {
        status: "available",
        sourceFiles: ["metrics.json"],
        rowCount: 2,
        outputFile: "metrics.json",
      },
      budgets: {
        status: "available",
        sourceFiles: ["budgets.json"],
        rowCount: 2,
        outputFile: "budgets.json",
      },
    },
  });

  const rows = [
    {
      chargePeriodStart: "2026-07-01",
      billingCurrency: "USD",
      providerName: "Azure",
      chargeCategory: "Usage",
      pricingCategory: "Standard",
      pricingUnit: "Hours",
      effectiveCost: 200,
      listCost: 220,
      contractedCost: 210,
      hasBaseline: true,
      effectiveCostInUsd: 200,
      serviceName: "Virtual Machines",
      serviceCategory: "Compute",
      subAccountName: "Prod",
      regionName: "eastus",
      resourceId:
        "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-prod-01",
      resourceName: "vm-prod-01",
      resourceType: "microsoft.compute/virtualmachines",
      resourceGroupName: "rg-prod",
      tags: { env: "prod", owner: "team-a", "cost-center": "finops" },
      commitmentDiscountId: "",
      commitmentDiscountName: "",
      commitmentDiscountType: "",
      commitmentDiscountCategory: "",
      commitmentDiscountStatus: "",
      skuTerm: "",
      skuMeterCategory: "",
      skuMeterSubcategory: "",
    },
    {
      chargePeriodStart: "2026-07-02",
      billingCurrency: "USD",
      providerName: "Azure",
      chargeCategory: "Usage",
      pricingCategory: "Standard",
      pricingUnit: "Hours",
      effectiveCost: 100,
      listCost: 120,
      contractedCost: 110,
      hasBaseline: true,
      effectiveCostInUsd: 100,
      serviceName: "Storage",
      serviceCategory: "Storage",
      subAccountName: "Dev",
      regionName: "westus",
      resourceId:
        "/subscriptions/sub-2/resourceGroups/rg-dev/providers/Microsoft.Storage/storageAccounts/stdev01",
      resourceName: "stdev01",
      resourceType: "microsoft.storage/storageaccounts",
      resourceGroupName: "rg-dev",
      tags: { env: "dev" },
      commitmentDiscountId: "",
      commitmentDiscountName: "",
      commitmentDiscountType: "",
      commitmentDiscountCategory: "",
      commitmentDiscountStatus: "",
      skuTerm: "",
      skuMeterCategory: "",
      skuMeterSubcategory: "",
    },
    {
      chargePeriodStart: "2026-07-03",
      billingCurrency: "USD",
      providerName: "Azure",
      chargeCategory: "Usage",
      pricingCategory: "Standard",
      pricingUnit: "Hours",
      effectiveCost: 50,
      listCost: 60,
      contractedCost: 55,
      hasBaseline: true,
      effectiveCostInUsd: 50,
      serviceName: "Virtual Machines",
      serviceCategory: "Compute",
      subAccountName: "Prod",
      regionName: "eastus",
      resourceId:
        "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-prod-01",
      resourceName: "vm-prod-01",
      resourceType: "microsoft.compute/virtualmachines",
      resourceGroupName: "rg-prod",
      tags: { env: "prod", owner: "team-a", "cost-center": "finops" },
      commitmentDiscountId: "",
      commitmentDiscountName: "",
      commitmentDiscountType: "",
      commitmentDiscountCategory: "",
      commitmentDiscountStatus: "",
      skuTerm: "",
      skuMeterCategory: "",
      skuMeterSubcategory: "",
    },
  ];
  fs.writeFileSync(
    path.join(processedDir, "rows.ndjson"),
    rows.map((row) => JSON.stringify(row)).join("\n"),
  );

  writeJson(
    path.join(processedDir, "resource-graph.json"),
    createEvidenceFile([
      {
        id: "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-prod-01",
        name: "vm-prod-01",
        type: "microsoft.compute/virtualmachines",
        subscriptionId: "sub-1",
        resourceGroup: "rg-prod",
        location: "eastus",
        sku: "Standard_D4s_v3",
        tags: { env: "prod" },
      },
      {
        id: "/subscriptions/sub-2/resourceGroups/rg-dev/providers/Microsoft.Storage/storageAccounts/stdev01",
        name: "stdev01",
        type: "microsoft.storage/storageaccounts",
        subscriptionId: "sub-2",
        resourceGroup: "rg-dev",
        location: "westus",
        sku: "Standard_LRS",
        tags: { env: "dev" },
      },
    ]),
  );

  writeJson(
    path.join(processedDir, "advisor.json"),
    createEvidenceFile([
      {
        id: "cost-1",
        category: "Cost",
        impact: "Medium",
        title: "Right-size VM",
        description: "Resize the VM to reduce cost.",
        resourceId:
          "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-prod-01",
        resourceType: "microsoft.compute/virtualmachines",
        recommendationTypeId: "rightsize",
        annualSavingsAmount: 1200,
        currency: "USD",
        extendedProperties: {
          currentSku: "Standard_D4s_v3",
          recommendedSku: "Standard_D2s_v3",
          region: "eastus",
        },
      },
      {
        id: "cost-2",
        category: "Cost",
        impact: "Low",
        title: "Delete unused disk",
        description: "Delete the unused managed disk.",
        resourceId:
          "/subscriptions/sub-2/resourceGroups/rg-dev/providers/Microsoft.Compute/disks/disk-01",
        resourceType: "microsoft.compute/disks",
        recommendationTypeId: "delete",
        annualSavingsAmount: 120,
        currency: "USD",
        extendedProperties: { region: "westus" },
      },
      {
        id: "ha-1",
        category: "HighAvailability",
        impact: "High",
        title: "Enable zone redundancy",
        description: "Improve resiliency for the workload.",
        resourceId:
          "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-prod-01",
        resourceType: "microsoft.compute/virtualmachines",
        recommendationTypeId: "ha",
        annualSavingsAmount: 0,
        currency: "USD",
        extendedProperties: { Environment: "prod", region: "eastus" },
      },
      {
        id: "sec-1",
        category: "Security",
        impact: "Medium",
        title: "Enable Defender plan",
        description: "Harden the storage account.",
        resourceId:
          "/subscriptions/sub-2/resourceGroups/rg-dev/providers/Microsoft.Storage/storageAccounts/stdev01",
        resourceType: "microsoft.storage/storageaccounts",
        recommendationTypeId: "security",
        annualSavingsAmount: 0,
        currency: "USD",
        extendedProperties: { Environment: "dev", location: "westus" },
      },
    ]),
  );

  writeJson(
    path.join(processedDir, "policy.json"),
    createEvidenceFile([
      {
        subscriptionId: "sub-1",
        resourceId:
          "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-prod-01",
        policyAssignmentId: "policy-1",
        policyDefinitionId: "def-1",
        complianceState: "Compliant",
      },
      {
        subscriptionId: "sub-2",
        resourceId:
          "/subscriptions/sub-2/resourceGroups/rg-dev/providers/Microsoft.Storage/storageAccounts/stdev01",
        policyAssignmentId: "policy-2",
        policyDefinitionId: "def-2",
        complianceState: "NonCompliant",
      },
    ]),
  );

  writeJson(
    path.join(processedDir, "metrics.json"),
    createEvidenceFile([
      {
        subscriptionId: "sub-1",
        resourceId:
          "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-prod-01",
        resourceName: "vm-prod-01",
        resourceType: "microsoft.compute/virtualmachines",
        resourceGroup: "rg-prod",
        metricName: "Percentage CPU",
        average: 8,
        maximum: 14,
        sampleCount: 24,
        startTimeUtc: "2026-07-01T00:00:00.000Z",
        endTimeUtc: "2026-07-02T00:00:00.000Z",
      },
      {
        subscriptionId: "sub-1",
        resourceId:
          "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-prod-01",
        resourceName: "vm-prod-01",
        resourceType: "microsoft.compute/virtualmachines",
        resourceGroup: "rg-prod",
        metricName: "Percentage CPU",
        average: 12,
        maximum: 18,
        sampleCount: 24,
        startTimeUtc: "2026-07-02T00:00:00.000Z",
        endTimeUtc: "2026-07-03T00:00:00.000Z",
      },
    ]),
  );

  writeJson(
    path.join(processedDir, "budgets.json"),
    createEvidenceFile([
      {
        subscriptionId: "sub-1",
        name: "Prod Budget",
        amount: 1000,
        currentSpend: 250,
        currency: "USD",
        timeGrain: "Monthly",
        startDateUtc: "2026-07-01T00:00:00.000Z",
        endDateUtc: "2026-07-31T00:00:00.000Z",
      },
      {
        subscriptionId: "sub-2",
        name: "Dev Budget",
        amount: 500,
        currentSpend: 100,
        currency: "USD",
        timeGrain: "Monthly",
        startDateUtc: "2026-07-01T00:00:00.000Z",
        endDateUtc: "2026-07-31T00:00:00.000Z",
      },
    ]),
  );

  resetCustomerDatasetCache();
  resetCustomerAssessmentCache();

  const { GET: workloadKpi } = await import(
    "../src/app/(dashboard)/api/workload/kpi/route"
  );
  const { GET: workloadScatter } = await import(
    "../src/app/(dashboard)/api/workload/cpu-scatter/route"
  );
  const { GET: workloadRightsizing } = await import(
    "../src/app/(dashboard)/api/workload/rightsizing/route"
  );
  const { GET: filterOptions } = await import(
    "../src/app/(dashboard)/api/filters/options/route"
  );
  const { GET: tagValues } = await import(
    "../src/app/(dashboard)/api/filters/tag-values/route"
  );
  const { GET: burnRate } = await import(
    "../src/app/(dashboard)/api/budgets/burn-rate/route"
  );
  const { GET: bySubscription } = await import(
    "../src/app/(dashboard)/api/budgets/by-subscription/route"
  );
  const { GET: governanceKpi } = await import(
    "../src/app/(dashboard)/api/governance/kpi/route"
  );
  const { GET: governanceBudget } = await import(
    "../src/app/(dashboard)/api/governance/budget-vs-actual/route"
  );
  const { GET: currentConfig } = await import(
    "../src/app/(dashboard)/api/config/current/route"
  );
  const { GET: agenticFinops } = await import(
    "../src/app/(dashboard)/api/agentic-finops/route"
  );
  const { GET: remediationImpact } = await import(
    "../src/app/(dashboard)/api/remediation-impact/route"
  );
  const { GET: remediationSummary } = await import(
    "../src/app/(dashboard)/api/remediation-summary/route"
  );
  const remediationExecute = await import(
    "../src/app/(dashboard)/api/remediation/execute/route"
  );

  const workloadKpiJson = await (await workloadKpi(
    new NextRequest("http://localhost/api/workload/kpi"),
  )).json();
  assert.equal(workloadKpiJson.metadata.dataSource, "customer");
  assert.equal(workloadKpiJson.data.totalVMs, 1);
  assert.equal(workloadKpiJson.data.rightsizingCandidates, 1);

  const workloadScatterJson = await (await workloadScatter(
    new NextRequest("http://localhost/api/workload/cpu-scatter"),
  )).json();
  assert.equal(workloadScatterJson.metadata.dataSource, "customer");
  assert.equal(workloadScatterJson.data.length, 1);
  assert.equal(workloadScatterJson.data[0].cpuAvg, 10);

  const workloadRightsizingJson = await (await workloadRightsizing(
    new NextRequest("http://localhost/api/workload/rightsizing"),
  )).json();
  assert.equal(workloadRightsizingJson.metadata.dataSource, "customer");
  assert.equal(workloadRightsizingJson.data.length, 1);

  const filterOptionsJson = await (await filterOptions(
    new NextRequest("http://localhost/api/filters/options"),
  )).json();
  assert.equal(filterOptionsJson.metadata.dataSource, "customer");
  assert.deepEqual(filterOptionsJson.data.subscriptions, ["Dev", "Prod"]);
  assert.deepEqual(filterOptionsJson.data.tagKeys, [
    "cost-center",
    "env",
    "owner",
  ]);

  const tagValuesJson = await (await tagValues(
    new NextRequest("http://localhost/api/filters/tag-values?key=env"),
  )).json();
  assert.equal(tagValuesJson.metadata.dataSource, "customer");
  assert.deepEqual(tagValuesJson.data, ["dev", "prod"]);

  const missingTagValuesJson = await (await tagValues(
    new NextRequest("http://localhost/api/filters/tag-values?key=missing"),
  )).json();
  assert.equal(missingTagValuesJson.metadata.dataSource, "customer");
  assert.deepEqual(missingTagValuesJson.data, []);

  const burnRateJson = await (await burnRate(
    new NextRequest("http://localhost/api/budgets/burn-rate?budget=999"),
  )).json();
  assert.equal(burnRateJson.metadata.dataSource, "customer");
  assert.equal(burnRateJson.data.budget, 1500);
  assert.equal(burnRateJson.data.status, "AT_RISK");

  const bySubscriptionJson = await (await bySubscription(
    new NextRequest("http://localhost/api/budgets/by-subscription?budget=999"),
  )).json();
  assert.equal(bySubscriptionJson.metadata.dataSource, "customer");
  assert.equal(bySubscriptionJson.data[0].subscriptionName, "Prod");
  assert.equal(bySubscriptionJson.data[0].percentOfBudget, 25);

  const governanceKpiJson = await (await governanceKpi(
    new NextRequest("http://localhost/api/governance/kpi"),
  )).json();
  assert.equal(governanceKpiJson.metadata.dataSource, "customer");
  assert.equal(governanceKpiJson.data.policiesActive, 2);

  const governanceBudgetJson = await (await governanceBudget(
    new NextRequest("http://localhost/api/governance/budget-vs-actual"),
  )).json();
  assert.equal(governanceBudgetJson.metadata.dataSource, "customer");
  assert.equal(governanceBudgetJson.data[0].budget, 1000);

  const currentConfigJson = await (await currentConfig()).json();
  assert.equal(currentConfigJson.dataSource, "customer");
  assert.equal(
    currentConfigJson.customerDataset.sampleOnlyPages.includes("/workload"),
    false,
  );
  assert.equal(
    currentConfigJson.customerDataset.partialPages.some(
      (page: { page: string }) => page.page === "/workload",
    ),
    true,
  );

  const agenticJson = await (await agenticFinops()).json();
  assert.equal(agenticJson.metadata.dataSource, "customer");
  assert.equal(agenticJson.data.recommendations.length, 2);

  const remediationImpactJson = await (await remediationImpact()).json();
  assert.equal(remediationImpactJson.metadata.dataSource, "customer");
  assert.equal(remediationImpactJson.data.length, 2);
  assert.equal(remediationImpactJson.data[0].remediationCostMonthly, 0);

  const remediationSummaryJson = await (await remediationSummary()).json();
  assert.equal(remediationSummaryJson.metadata.dataSource, "customer");
  assert.equal(remediationSummaryJson.data.zeroCostCount, 2);
  assert.equal(remediationSummaryJson.data.totalRemediationMonthly, 0);

  const remediationPrecheckJson = await (await remediationExecute.GET(
    new Request(
      "http://localhost/api/remediation/execute?precheck=1&resourceId=/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-prod-01",
    ),
  )).json();
  assert.equal(remediationPrecheckJson.data.canProceed, false);

  const remediationPostJson = await (await remediationExecute.POST(
    new Request("http://localhost/api/remediation/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recommendationId: "ha-1",
        action: "resize_vm",
        resourceId:
          "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-prod-01",
        resourceName: "vm-prod-01",
      }),
    }),
  )).json();
  assert.equal(remediationPostJson.data.status, "failed");

  process.env.NEXT_PUBLIC_USE_MOCK = "false";
  process.env.ADX_CLUSTER_URI = "https://example.kusto.windows.net";
  delete process.env.ADX_DATABASE;

  const currentConfigAdxJson = await (await currentConfig()).json();
  assert.equal(currentConfigAdxJson.dataSource, "adx");
  assert.equal(currentConfigAdxJson.customerDataset, null);

  const agenticAdxJson = await (await agenticFinops()).json();
  assert.notEqual(agenticAdxJson.metadata?.dataSource, "customer");

  const remediationImpactAdxResponse = await remediationImpact();
  const remediationImpactAdxJson = await remediationImpactAdxResponse.json();
  assert.notEqual(remediationImpactAdxJson.metadata?.dataSource, "customer");

  const remediationSummaryAdxResponse = await remediationSummary();
  const remediationSummaryAdxJson = await remediationSummaryAdxResponse.json();
  assert.notEqual(remediationSummaryAdxJson.metadata?.dataSource, "customer");

  const remediationPrecheckAdxJson = await (await remediationExecute.GET(
    new Request(
      "http://localhost/api/remediation/execute?precheck=1&resourceId=/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-prod-01",
    ),
  )).json();
  assert.equal(remediationPrecheckAdxJson.ok, true);
  assert.notEqual(remediationPrecheckAdxJson.metadata?.dataSource, "customer");

  const remediationPostAdxResponse = await remediationExecute.POST(
    new Request("http://localhost/api/remediation/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recommendationId: "ha-1",
        action: "resize_vm",
        resourceId:
          "/subscriptions/sub-1/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-prod-01",
        resourceName: "vm-prod-01",
      }),
    }),
  );
  assert.equal(remediationPostAdxResponse.status, 403);

  fs.rmSync(customerDir, { recursive: true, force: true });
  process.stdout.write("ok - customer runtime integration\n");
}

main().catch((error) => {
  fs.rmSync(customerDir, { recursive: true, force: true });
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exit(1);
});
