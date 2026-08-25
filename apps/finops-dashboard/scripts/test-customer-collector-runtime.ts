import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// contract.ts is a dependency-free module, so importing it here cannot read
// CUSTOMER_DATA_DIR before the line below sets it. Tracking the constant keeps
// this fixture from pinning a schema version the loader has already moved past.
import { CUSTOMER_DATASET_SCHEMA_VERSION } from "../src/lib/customer-data/contract";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "finops-collector-runtime-"));
process.env.CUSTOMER_DATA_DIR = scratch;

const generatedAtUtc = "2026-08-06T10:00:00.000Z";
const processed = path.join(scratch, ".processed");
fs.mkdirSync(processed, { recursive: true });

function evidence(name: string, records: unknown[]): void {
  fs.writeFileSync(
    path.join(processed, `${name}.json`),
    JSON.stringify({
      schemaVersion: "1.0.0",
      datasetGeneratedAtUtc: generatedAtUtc,
      status: "available",
      sourceFiles: [`${name}.json`],
      rowCount: records.length,
      records,
    }),
  );
}

async function main(): Promise<void> {
  try {
    fs.writeFileSync(
      path.join(processed, "manifest.json"),
      JSON.stringify({
        schemaVersion: CUSTOMER_DATASET_SCHEMA_VERSION,
        customer: "Synthetic",
        format: "focus",
        generatedAtUtc,
        sourceLastModifiedAtUtc: "2026-08-05T10:00:00.000Z",
        sourceFiles: ["cost.csv"],
        rowCount: 1,
        skippedRowCount: 0,
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        currencies: ["USD"],
        hasUsdCosts: true,
        warnings: [],
      }),
    );
    fs.writeFileSync(
      path.join(processed, "rows.ndjson"),
      `${JSON.stringify({
        chargePeriodStart: "2026-07-31",
        billingCurrency: "USD",
        providerName: "Azure",
        chargeCategory: "Usage",
        pricingCategory: "Standard",
        pricingUnit: "Hours",
        effectiveCost: 300,
        listCost: 400,
        contractedCost: 350,
        hasBaseline: true,
        effectiveCostInUsd: 300,
        serviceName: "Virtual Machines",
        serviceCategory: "Compute",
        subAccountName: "Synthetic Subscription",
        regionName: "eastus",
        resourceId:
          "/subscriptions/00000000-0000-4000-8000-000000000001/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm-a",
        resourceName: "vm-a",
        resourceType: "microsoft.compute/virtualmachines",
        resourceGroupName: "rg",
        tags: {},
        commitmentDiscountId: "",
        commitmentDiscountName: "",
        commitmentDiscountType: "",
        commitmentDiscountCategory: "",
        commitmentDiscountStatus: "",
        skuTerm: "",
        skuMeterCategory: "Virtual Machines",
        skuMeterSubcategory: "D Series",
      })}\n`,
    );
    const resourceId =
      "/subscriptions/00000000-0000-4000-8000-000000000001/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm-a";
    evidence("resource-graph", [{
      id: resourceId,
      name: "vm-a",
      type: "microsoft.compute/virtualmachines",
      subscriptionId: "00000000-0000-4000-8000-000000000001",
      resourceGroup: "rg",
      location: "eastus",
      sku: "Standard_D4s_v5",
      tags: {},
    }]);
    evidence("advisor", [{
      id: "recommendation-1",
      category: "Cost",
      impact: "Medium",
      title: "Right-size underutilized virtual machine",
      description: "Resize the virtual machine",
      resourceId,
      resourceType: "microsoft.compute/virtualmachines",
      recommendationTypeId: "rightsize",
      annualSavingsAmount: 1200,
      currency: "USD",
      extendedProperties: { recommendedSku: "Standard_D2s_v5" },
    }]);
    evidence("metrics", [{
      subscriptionId: "00000000-0000-4000-8000-000000000001",
      resourceId,
      resourceName: "vm-a",
      resourceType: "microsoft.compute/virtualmachines",
      resourceGroup: "rg",
      metricName: "Percentage CPU",
      average: 8,
      maximum: 20,
      sampleCount: 24,
      startTimeUtc: "2026-07-01T00:00:00.000Z",
      endTimeUtc: "2026-07-31T23:59:59.000Z",
    }]);
    for (const name of [
      "policy",
      "security",
      "health",
      "patch",
      "operations",
      "budgets",
      "commitments",
    ]) {
      evidence(name, []);
    }

    const { aggregateCustomerAgentic, aggregateCustomerWorkload } = await import(
      "../src/lib/customer-operational-aggregations"
    );
    const workload = aggregateCustomerWorkload();
    assert.ok(workload);
    assert.equal(workload.kpi.totalVMs, 1);
    assert.equal(workload.kpi.rightsizingCandidates, 1);
    assert.equal(workload.kpi.avgCpuUtilization, 8);
    assert.equal(workload.rightsizing[0].recommendedSku, "Standard_D2s_v5");
    assert.equal(workload.rightsizing[0].monthlySavings, 100);

    const agentic = aggregateCustomerAgentic();
    assert.ok(agentic);
    assert.equal(agentic.recommendations.length, 1);
    assert.equal(agentic.recommendations[0].actionType, "RIGHTSIZE_VM");
    assert.equal(agentic.summary.totalPotentialSavings, 1200);

    process.stdout.write("Customer collector runtime checks passed.\n");
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
