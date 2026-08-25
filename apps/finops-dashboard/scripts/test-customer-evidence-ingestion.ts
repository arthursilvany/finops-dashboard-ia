import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const scratchRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "finops-customer-evidence-"),
);
const ingestScript = path.resolve(process.cwd(), "scripts", "ingest-customer.ts");

function runIngest(
  inputDir: string,
  skipNarrative = true,
  maxRows?: number,
): void {
  execFileSync(process.execPath, [require.resolve("tsx/cli"), ingestScript, "Synthetic"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "test",
      CUSTOMER_DATA_DIR: inputDir,
      CUSTOMER_SKIP_NARRATIVE_FOR_TESTS: String(skipNarrative),
      ...(maxRows ? { CUSTOMER_MAX_ROWS: String(maxRows) } : {}),
    },
    stdio: "pipe",
  });
}

function writeCostExport(dir: string): void {
  fs.writeFileSync(
    path.join(dir, "cost.csv"),
    [
      "ChargePeriodStart,EffectiveCost,BillingCurrency,ResourceId,ResourceType",
      "2026-07-01,12.50,USD,/subscriptions/sub-1/resourceGroups/rg-a/providers/Microsoft.Compute/virtualMachines/vm-a,microsoft.compute/virtualmachines",
    ].join("\n"),
  );
}

function main(): void {
  try {
    const complete = path.join(scratchRoot, "complete");
    fs.mkdirSync(complete, { recursive: true });
    writeCostExport(complete);
    fs.writeFileSync(
      path.join(complete, "resources.csv"),
      [
        "id,name,type,subscriptionId,resourceGroup,location,tags",
        "/subscriptions/sub-1/resourceGroups/rg-a/providers/Microsoft.Compute/virtualMachines/vm-a,vm-a,microsoft.compute/virtualmachines,sub-1,rg-a,eastus,\"{\"\"env\"\":\"\"test\"\"}\"",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(complete, "advisor.json"),
      JSON.stringify({
        data: [{
          id: "rec-1",
          type: "microsoft.advisor/recommendations",
          properties: {
            category: "Cost",
            impact: "High",
            shortDescription: { problem: "Idle VM", solution: "Shut down the VM" },
            resourceMetadata: { resourceId: "/subscriptions/sub-1/resourceGroups/rg-a/vm-a" },
            impactedField: "Microsoft.Compute/virtualMachines",
            recommendationTypeId: "shutdown",
            extendedProperties: { annualSavingsAmount: "1200", savingsCurrency: "USD" },
          },
        }],
      }),
    );
    const optionalFixtures = {
      policy: [{
        subscriptionId: "sub-1",
        resourceId: "/subscriptions/sub-1/vm-a",
        policyAssignmentId: "assignment-1",
        policyDefinitionId: "definition-1",
        complianceState: "NonCompliant",
      }],
      security: [{
        subscriptionId: "sub-1",
        resourceId: "/subscriptions/sub-1/vm-a",
        assessmentKey: "assessment-1",
        displayName: "Secure configuration",
        severity: "High",
        status: "Unhealthy",
      }],
      health: [{
        subscriptionId: "sub-1",
        resourceId: "/subscriptions/sub-1/vm-a",
        availabilityState: "Available",
        reasonType: "",
      }],
      patch: [{
        subscriptionId: "sub-1",
        resourceId: "/subscriptions/sub-1/vm-a",
        status: "Succeeded",
        criticalCount: 1,
        securityCount: 2,
        otherCount: 3,
      }],
      operations: [{
        subscriptionId: "sub-1",
        resourceId: "/subscriptions/sub-1/vm-a",
        kind: "diagnostic",
        status: "enabled",
      }],
      metrics: [{
        subscriptionId: "sub-1",
        resourceId: "/subscriptions/sub-1/vm-a",
        resourceName: "vm-a",
        resourceType: "microsoft.compute/virtualmachines",
        resourceGroup: "rg-a",
        metricName: "Percentage CPU",
        average: 8,
        maximum: 22,
        sampleCount: 24,
        startTimeUtc: "2026-07-01T00:00:00.000Z",
        endTimeUtc: "2026-07-02T00:00:00.000Z",
      }],
      budgets: [{
        subscriptionId: "sub-1",
        name: "monthly",
        amount: 1000,
        currentSpend: 450,
        currency: "USD",
        timeGrain: "Monthly",
        startDateUtc: "2026-07-01T00:00:00.000Z",
        endDateUtc: "2026-07-31T00:00:00.000Z",
      }],
      commitments: [{
        subscriptionId: "sub-1",
        resourceType: "microsoft.compute/virtualmachines",
        recommendationType: "Reservation",
        term: "P1Y",
        lookBackPeriod: "Last30Days",
        quantity: 1,
        annualSavings: 600,
        currency: "USD",
        utilizationPercentage: 92,
      }],
    };
    for (const [kind, records] of Object.entries(optionalFixtures)) {
      fs.writeFileSync(
        path.join(complete, `${kind}.json`),
        JSON.stringify({
          schemaVersion: "1.0.0",
          capturedAtUtc: "2026-07-02T00:00:00.000Z",
          source: kind,
          status: "collected",
          records,
        }),
      );
    }

    runIngest(complete);

    const processed = path.join(complete, ".processed");
    const manifest = JSON.parse(fs.readFileSync(path.join(processed, "manifest.json"), "utf8"));
    const resources = JSON.parse(
      fs.readFileSync(path.join(processed, "resource-graph.json"), "utf8"),
    );
    const advisor = JSON.parse(fs.readFileSync(path.join(processed, "advisor.json"), "utf8"));

    assert.equal(manifest.rowCount, 1, "Cost Export behavior must be preserved");
    assert.equal(manifest.assessmentEvidence.resourceGraph.status, "available");
    assert.equal(manifest.assessmentEvidence.advisor.status, "available");
    assert.equal(resources.datasetGeneratedAtUtc, manifest.generatedAtUtc);
    assert.equal(advisor.datasetGeneratedAtUtc, manifest.generatedAtUtc);
    assert.ok(Date.parse(manifest.sourceLastModifiedAtUtc) > 0);
    assert.equal(resources.records[0].name, "vm-a");
    assert.deepEqual(resources.records[0].tags, { env: "test" });
    assert.equal(advisor.records[0].title, "Idle VM");
    assert.equal(advisor.records[0].annualSavingsAmount, 1200);
    for (const kind of Object.keys(optionalFixtures)) {
      assert.equal(manifest.assessmentEvidence[kind].status, "available");
      assert.equal(manifest.assessmentEvidence[kind].rowCount, 1);
      const optional = JSON.parse(
        fs.readFileSync(path.join(processed, `${kind}.json`), "utf8"),
      );
      assert.equal(optional.datasetGeneratedAtUtc, manifest.generatedAtUtc);
      assert.equal(optional.records.length, 1);
    }

    const empty = path.join(scratchRoot, "empty-evidence");
    fs.mkdirSync(empty, { recursive: true });
    writeCostExport(empty);
    for (const source of ["resourceGraph", "advisor"]) {
      fs.writeFileSync(
        path.join(empty, source === "resourceGraph" ? "resource-graph.json" : "advisor.json"),
        JSON.stringify({
          schemaVersion: "1.0.0",
          capturedAtUtc: "2026-07-02T00:00:00.000Z",
          source,
          status: "available",
          records: [],
        }),
      );
    }
    runIngest(empty);
    const emptyManifest = JSON.parse(
      fs.readFileSync(path.join(empty, ".processed", "manifest.json"), "utf8"),
    );
    assert.equal(emptyManifest.assessmentEvidence.resourceGraph.status, "available");
    assert.equal(emptyManifest.assessmentEvidence.advisor.status, "available");

    const missing = path.join(scratchRoot, "missing");
    fs.mkdirSync(missing, { recursive: true });
    writeCostExport(missing);
    assert.throws(
      () => runIngest(missing, false),
      /Command failed/,
      "Missing assessment evidence must fail the CLI after preserving cost data",
    );

    const missingManifest = JSON.parse(
      fs.readFileSync(path.join(missing, ".processed", "manifest.json"), "utf8"),
    );
    const narrativeStatus = JSON.parse(
      fs.readFileSync(
        path.join(missing, ".processed", "narrative-status.json"),
        "utf8",
      ),
    );
    assert.equal(missingManifest.assessmentEvidence.resourceGraph.status, "missing");
    assert.equal(missingManifest.assessmentEvidence.advisor.status, "missing");
    assert.match(missingManifest.warnings.join("\n"), /Resource Graph assessment evidence/);
    assert.equal(narrativeStatus.state, "failed");
    assert.match(narrativeStatus.error, /Resource Graph and Advisor evidence are required/);
    assert.ok(
      fs.existsSync(path.join(missing, ".processed", "rows.ndjson")),
      "Cost dataset must survive Narrative IA failure",
    );

    const truncated = path.join(scratchRoot, "truncated");
    fs.mkdirSync(truncated, { recursive: true });
    fs.writeFileSync(
      path.join(truncated, "a-cost.csv"),
      [
        "ChargePeriodStart,EffectiveCost,BillingCurrency,ResourceId,ResourceType",
        "2026-07-01,12.50,USD,/subscriptions/sub-1/vm-a,microsoft.compute/virtualmachines",
        "2026-07-02,13.50,USD,/subscriptions/sub-1/vm-b,microsoft.compute/virtualmachines",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(truncated, "y-resources.csv"),
      [
        "id,name,type,subscriptionId,resourceGroup,location,tags",
        "/subscriptions/sub-1/vm-a,vm-a,microsoft.compute/virtualmachines,sub-1,rg-a,eastus,{}",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(truncated, "z-advisor.json"),
      JSON.stringify({
        value: [
          {
            id: "rec-1",
            type: "microsoft.advisor/recommendations",
            properties: {
              category: "Security",
              impact: "High",
              shortDescription: {
                problem: "Security hardening",
                solution: "Apply the recommendation",
              },
            },
          },
        ],
      }),
    );
    runIngest(truncated, true, 1);
    const truncatedManifest = JSON.parse(
      fs.readFileSync(
        path.join(truncated, ".processed", "manifest.json"),
        "utf8",
      ),
    );
    assert.equal(truncatedManifest.rowCount, 1);
    assert.equal(
      truncatedManifest.assessmentEvidence.resourceGraph.status,
      "available",
    );
    assert.equal(truncatedManifest.assessmentEvidence.advisor.status, "available");

  } finally {
    fs.rmSync(scratchRoot, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 200,
    });
  }
  process.stdout.write("ok - customer manual evidence ingestion (CSV, JSON envelope, missing states)\n");
}

main();
