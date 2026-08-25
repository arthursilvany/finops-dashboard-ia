import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function main(): Promise<void> {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "finops-narrative-"));
  process.env.CUSTOMER_DATA_DIR = scratch;

  try {
    const processed = path.join(scratch, ".processed");
    await fs.mkdir(processed, { recursive: true });
    await Promise.all([
      fs.writeFile(
        path.join(processed, "manifest.json"),
        JSON.stringify({
          schemaVersion: "1.3.0",
          customer: "Sensitive Customer Name",
          format: "focus",
          generatedAtUtc: "2026-08-04T10:00:00.000Z",
          sourceLastModifiedAtUtc: "2026-07-31T10:00:00.000Z",
          sourceFiles: ["private.csv"],
          rowCount: 1,
          skippedRowCount: 0,
          periodStart: "2026-05-01",
          periodEnd: "2026-07-31",
          currencies: ["USD"],
          hasUsdCosts: true,
          warnings: [],
        }),
      ),
      fs.writeFile(
        path.join(processed, "rows.ndjson"),
        `${JSON.stringify({
          effectiveCost: 120000,
          serviceCategory: "Compute",
          resourceName: "private-vm-name",
          resourceId:
            "/subscriptions/00000000-0000-4000-8000-000000000000/resourceGroups/private-rg/providers/Microsoft.Compute/virtualMachines/private-vm-name",
          tags: { owner: "person@example.com" },
        })}\n`,
      ),
      fs.writeFile(
        path.join(processed, "resource-graph.json"),
        JSON.stringify({
          schemaVersion: "1.0.0",
          datasetGeneratedAtUtc: "2026-08-04T10:00:00.000Z",
          status: "available",
          sourceFiles: ["resources.json"],
          rowCount: 1,
          records: [
            {
              id: "/subscriptions/private/resourceGroups/private-rg/providers/Microsoft.Compute/virtualMachines/private-vm-name",
              name: "private-vm-name",
              type: "Microsoft.Compute/virtualMachines",
              subscriptionId: "private",
              resourceGroup: "private-rg",
              location: "eastus",
              tags: { owner: "person@example.com" },
            },
          ],
        }),
      ),
      fs.writeFile(
        path.join(processed, "advisor.json"),
        JSON.stringify({
          schemaVersion: "1.0.0",
          datasetGeneratedAtUtc: "2026-08-04T10:00:00.000Z",
          status: "available",
          sourceFiles: ["advisor.json"],
          rowCount: 1,
          records: [
            {
              id: "private-recommendation-id",
              category: "HighAvailability",
              impact: "High",
              title: "Enable availability zones for private-vm-name",
              description: "Move private-vm-name owned by person@example.com",
              resourceId: "/subscriptions/private/resourceGroups/private-rg",
              resourceType: "Microsoft.Compute/virtualMachines",
              recommendationTypeId: "availability-zones",
              annualSavingsAmount: 0,
              currency: "USD",
              extendedProperties: { owner: "person@example.com" },
            },
          ],
        }),
      ),
    ]);

    const {
      assertSanitizedAssessmentFacts,
      NARRATIVE_SCHEMA_VERSION,
    } = await import("../src/lib/customer-narrative-contract");
    const { generateCustomerNarrative } = await import(
      "../src/lib/customer-narrative-generator"
    );
    const { extractMicrosoftLearnReferences } = await import(
      "../src/lib/microsoft-learn-client"
    );
    const { buildSanitizedAssessmentFacts } = await import(
      "../src/lib/customer-narrative-facts"
    );
    const { getCustomerWafRadar } = await import(
      "../src/lib/customer-waf-radar"
    );
    const {
      loadCustomerNarrative,
      persistCustomerNarrative,
      persistCustomerNarrativeFailure,
    } = await import("../src/lib/customer-narrative-store");

    const facts = {
      schemaVersion: NARRATIVE_SCHEMA_VERSION,
      datasetGeneratedAtUtc: "2026-08-04T10:00:00.000Z",
      sourceLastModifiedAtUtc: "2026-08-04T09:00:00.000Z",
      coverage: {
        costExport: true,
        resourceGraph: true,
        advisor: true,
        limitations: ["static-snapshot", "no-runtime-telemetry"],
      },
      cost: {
        currencies: ["USD"],
        periodDays: 90,
        totalEffectiveCost: 120000,
        topServices: [
          { serviceCategory: "Compute", cost: 60000, percentage: 50 },
        ],
      },
      inventory: [
        { resourceType: "microsoft.compute/virtualmachines", count: 20 },
      ],
      advisor: [
        {
          category: "HighAvailability",
          impact: "High" as const,
          recommendationTheme: "availability",
          count: 4,
        },
      ],
    };

    const structuredReferences = extractMicrosoftLearnReferences(
      JSON.stringify({
        results: [
          {
            title: "Azure reliability guidance",
            content: "Body with [an image](https://learn.microsoft.com/media/icon.svg)",
            contentUrl:
              "https://learn.microsoft.com/azure/well-architected/reliability/",
          },
        ],
      }),
    );
    assert.deepEqual(structuredReferences, [
      {
        title: "Azure reliability guidance",
        url: "https://learn.microsoft.com/azure/well-architected/reliability/",
      },
    ]);

    const builtFacts = await buildSanitizedAssessmentFacts();
    const serializedFacts = JSON.stringify(builtFacts);
    assert.ok(!serializedFacts.includes("Sensitive Customer Name"));
    assert.ok(!serializedFacts.includes("private-vm-name"));
    assert.ok(!serializedFacts.includes("person@example.com"));
    assert.deepEqual(builtFacts.inventory, [
      { resourceType: "microsoft.compute/virtualmachines", count: 1 },
    ]);
    assert.equal(builtFacts.advisor[0].recommendationTheme, "availability");
    const wafRadar = getCustomerWafRadar(
      "2026-08-04T10:00:00.000Z",
    );
    assert.ok(wafRadar);
    assert.equal(wafRadar.series[0].values[0], 80);

    assert.doesNotThrow(() => assertSanitizedAssessmentFacts(facts));
    assert.throws(
      () =>
        assertSanitizedAssessmentFacts({
          ...facts,
          inventory: [
            {
              resourceType:
                "/subscriptions/00000000-0000-4000-8000-000000000000/resourceGroups/private",
              count: 1,
            },
          ],
        }),
      /Invalid|forbidden customer identifier/,
    );

    const learnUrl =
      "https://learn.microsoft.com/azure/well-architected/reliability/";
    const validAction = {
      title: "Validate zone resilience",
      priority: 1,
      framework: "WAF",
      frameworkArea: "Reliability",
      wafPillar: "Reliability",
      evidence: [
        "Four high-impact availability recommendations were exported.",
      ],
      businessImpact:
        "The 20 inventoried virtual machines behind USD 120,000 of effective cost have no verified zone redundancy.",
      businessImpactDimension: "risk",
      recommendedChange:
        "Validate dependencies and stage a zone-resilience rollout.",
      changeRisk: "medium",
      changeImpact:
        "Deployment sequencing may require a maintenance window.",
      inactionRisk: "high",
      inactionImpact:
        "A zonal failure can interrupt workloads without tested redundancy.",
      nextAction:
        "Assign an owner to validate dependencies and rollback steps.",
      commitment:
        "Can we validate the zone-resilience rollout for these workloads in a working session this week?",
      effort: "medium",
      confidence: 0.88,
      sourceUrls: [learnUrl],
    };
    const validResponse = {
      executiveSummary: "Prioritize resilience before the next change.",
      decisionHeadline: "Address four high-impact resilience findings.",
      executiveCommitment:
        "My recommendation is to approve the resilience workstream now; who should own it?",
      limitations: ["No runtime telemetry was provided."],
      actions: [validAction],
    };
    const searchDocs = async () => ({
      content: `[Reliability guidance](${learnUrl})`,
      references: [{ title: "Reliability guidance", url: learnUrl }],
    });

    const queries: string[] = [];
    let capturedPrompt = "";
    const narrative = await generateCustomerNarrative(facts, {
      searchDocs: async (query) => {
        queries.push(query);
        return searchDocs();
      },
      complete: async (prompt) => {
        capturedPrompt = prompt;
        return { model: "test-model", content: JSON.stringify(validResponse) };
      },
    });

    assert.equal(queries.length, 3);
    assert.ok(!capturedPrompt.includes("/subscriptions/"));
    assert.ok(capturedPrompt.includes("Take Control requirements"));
    assert.equal(narrative.actions[0].id, "action-1");
    assert.equal(narrative.actions[0].sourceUrls[0], learnUrl);
    assert.equal(narrative.actions[0].businessImpactDimension, "risk");
    assert.match(narrative.actions[0].commitment, /^Can we validate/);
    assert.match(narrative.executiveCommitment, /^My recommendation is/);

    await persistCustomerNarrative(narrative);
    const ready = loadCustomerNarrative();
    assert.equal(ready.status?.state, "ready");
    assert.equal(ready.narrative?.model, "test-model");
    const mismatched = loadCustomerNarrative("2026-08-05T10:00:00.000Z");
    assert.equal(mismatched.narrative, null);
    assert.match(mismatched.status?.error ?? "", /different dataset snapshot/);

    await persistCustomerNarrativeFailure(new Error("MCP unavailable"));
    const failed = loadCustomerNarrative();
    assert.equal(failed.status?.state, "failed");
    assert.equal(failed.narrative, null);
    assert.match(failed.status?.error ?? "", /MCP unavailable/);

    await assert.rejects(
      generateCustomerNarrative(facts, {
        searchDocs,
        complete: async () => ({
          model: "test-model",
          content: JSON.stringify({
            ...validResponse,
            actions: [
              { ...validAction, sourceUrls: ["https://example.com/invented"] },
            ],
          }),
        }),
      }),
      /source that was not provided/,
    );

    await assert.rejects(
      generateCustomerNarrative(facts, {
        searchDocs,
        complete: async () => ({
          model: "test-model",
          content: JSON.stringify({
            ...validResponse,
            actions: [
              {
                ...validAction,
                businessImpact:
                  "An outage would expose USD 450,000 of annual revenue.",
              },
            ],
          }),
        }),
      }),
      /not traceable to the sanitized assessment facts/,
    );

    await assert.rejects(
      generateCustomerNarrative(facts, {
        searchDocs,
        complete: async () => ({
          model: "test-model",
          content: JSON.stringify({
            ...validResponse,
            actions: [
              {
                ...validAction,
                commitment: "What do you think about this approach?",
              },
            ],
          }),
        }),
      }),
      /non-committal language/,
    );

    await assert.rejects(
      generateCustomerNarrative(facts, {
        searchDocs,
        complete: async () => ({
          model: "test-model",
          content: JSON.stringify({
            ...validResponse,
            actions: [
              {
                ...validAction,
                businessImpact:
                  "Resilience gaps increase operational exposure.",
              },
            ],
          }),
        }),
      }),
      /not quantified/,
    );

    let attempts = 0;
    const retried = await generateCustomerNarrative(facts, {
      searchDocs,
      complete: async (prompt) => {
        attempts += 1;
        if (attempts === 1) {
          return {
            model: "test-model",
            content: JSON.stringify({
              ...validResponse,
              actions: [
                {
                  ...validAction,
                  commitment: "This is just a suggestion, feel free to review.",
                },
              ],
            }),
          };
        }
        assert.match(prompt, /YOUR PREVIOUS RESPONSE WAS REJECTED/);
        return { model: "test-model", content: JSON.stringify(validResponse) };
      },
    });
    assert.equal(attempts, 2);
    assert.equal(retried.actions[0].id, "action-1");

    process.stdout.write("Customer Narrative IA checks passed.\n");
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
