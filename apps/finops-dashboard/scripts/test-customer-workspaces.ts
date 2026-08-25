import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Customer workspaces: isolation between customers collected on the same
 * machine.
 *
 * The property under test is not "the code runs" but "customer A's rows can
 * never reach customer B's dashboard" — including through the module-level
 * cache, which is the failure mode that would be invisible in a demo.
 */

const scratchRoot = path.resolve(
  process.cwd(),
  "..",
  ".customer-workspaces-test-artifacts",
);
function removeScratchRoot(): void {
  fs.rmSync(scratchRoot, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 250,
  });
}

removeScratchRoot();

function cleanupScratchRoot(): void {
  try {
    removeScratchRoot();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EBUSY") throw error;
  }
}
fs.mkdirSync(scratchRoot, { recursive: true });
const ingestScript = path.resolve(process.cwd(), "scripts", "ingest-customer.ts");

let passed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${name}: ${message}`);
    console.log(`  \u2717 ${name}`);
    console.log(`      ${message.split("\n")[0]}`);
  }

}

async function checkAsync(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${name}: ${message}`);
    console.log(`  \u2717 ${name}`);
    console.log(`      ${message.split("\n")[0]}`);
  }
}

function group(name: string): void {
  console.log(`\n${name}`);
}

function writeCostExport(dir: string, cost: string, resource: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "cost.csv"),
    [
      "ChargePeriodStart,EffectiveCost,BillingCurrency,ResourceId,ResourceType",
      `2026-07-01,${cost},USD,/subscriptions/sub-1/resourceGroups/rg-a/providers/Microsoft.Compute/virtualMachines/${resource},microsoft.compute/virtualmachines`,
    ].join("\n"),
  );
}

function runIngest(
  root: string,
  customer: string,
): { ok: true } | { ok: false; output: string } {
  try {
    execFileSync(
      process.execPath,
      [require.resolve("tsx/cli"), ingestScript, customer],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: "test",
          CUSTOMER_DATA_DIR: root,
          CUSTOMER_SKIP_NARRATIVE_FOR_TESTS: "true",
        },
        stdio: "pipe",
      },
    );
    return { ok: true };
  } catch (error) {
    const shellError = error as { stdout?: Buffer; stderr?: Buffer };
    return {
      ok: false,
      output: `${shellError.stdout?.toString() ?? ""}${shellError.stderr?.toString() ?? ""}`,
    };
  }
}

async function main(): Promise<void> {
  const paths = await import("../src/lib/customer-data/paths");
  const { LEGACY_WORKSPACE_SLUG, customerDir, customerPaths, isValidSlug, slugify } =
    paths;

  group("Slug");

  check("a common name becomes the expected slug", () => {
    assert.equal(slugify("Contoso"), "contoso");
    assert.equal(slugify("Contoso Ltda."), "contoso-ltda");
  });

  check("diacritics resolve to the same slug as the unaccented form", () => {
    assert.equal(slugify("Ação S/A"), slugify("Acao S/A"));
    assert.equal(slugify("Ação S/A"), "acao-s-a");
  });

  check("a name with nothing usable does not invent a folder", () => {
    // Returning a fallback would make two unnamed customers silently collide.
    assert.equal(slugify("!!!"), null);
    assert.equal(slugify("   "), null);
  });

  check("the slug never escapes the root folder", () => {
    for (const hostile of [
      "../etc",
      "..",
      "a/b",
      "a\\b",
      "/absolute",
      ".hidden",
      "",
      "Contoso",
    ]) {
      assert.equal(isValidSlug(hostile), false, `accepted "${hostile}"`);
    }
  });

  check("a previously collected folder is accepted even outside the slug pattern", () => {
    // Folders from before this feature retain the customer name as originally
    // entered. Rejecting them would require renaming already collected data.
    assert.equal(paths.isSafeWorkspaceName("Contoso"), true);
    assert.equal(paths.isSafeWorkspaceName("fabrikam-br"), true);
  });

  check("a dangerous folder name remains rejected on read", () => {
    for (const hostile of ["../etc", "..", "a/b", "a\\b", "/abs", ".oculta", ""]) {
      assert.equal(
        paths.isSafeWorkspaceName(hostile),
        false,
        `accepted "${hostile}"`,
      );
    }
  });

  check("an invalid slug makes customerDir fail rather than normalize", () => {
    assert.throws(() => customerDir("../etc"));
    assert.throws(() => customerDir("a/b"));
  });

  group("Input and output separation");

  check("a customer input and output reside in different trees", () => {
    const previousData = process.env.CUSTOMER_DATA_DIR;
    const previousOutput = process.env.CUSTOMER_OUTPUT_DIR;
    process.env.CUSTOMER_DATA_DIR = path.join(scratchRoot, "split", "input");
    process.env.CUSTOMER_OUTPUT_DIR = path.join(scratchRoot, "split", "output");

    const target = customerPaths("contoso");
    assert.equal(target.dir, path.join(scratchRoot, "split", "input", "contoso"));
    assert.equal(
      target.processed,
      path.join(scratchRoot, "split", "output", "contoso"),
    );
    // The dataset must not be inside the input folder: deleting output must not
    // also delete the collection.
    assert.ok(!target.processed.startsWith(target.dir));

    process.env.CUSTOMER_DATA_DIR = previousData;
    if (previousOutput === undefined) delete process.env.CUSTOMER_OUTPUT_DIR;
    else process.env.CUSTOMER_OUTPUT_DIR = previousOutput;
  });

  check("the legacy workspace keeps its dataset where it already was", () => {
    const previousData = process.env.CUSTOMER_DATA_DIR;
    const previousOutput = process.env.CUSTOMER_OUTPUT_DIR;
    process.env.CUSTOMER_DATA_DIR = path.join(scratchRoot, "split", "input");
    process.env.CUSTOMER_OUTPUT_DIR = path.join(scratchRoot, "split", "output");

    // A collection from before the split remains readable without re-ingestion.
    assert.equal(
      customerPaths(LEGACY_WORKSPACE_SLUG).processed,
      path.join(scratchRoot, "split", "input", ".processed"),
    );

    process.env.CUSTOMER_DATA_DIR = previousData;
    if (previousOutput === undefined) delete process.env.CUSTOMER_OUTPUT_DIR;
    else process.env.CUSTOMER_OUTPUT_DIR = previousOutput;
  });

  group("Workspaces on disk");

  const listRoot = path.join(scratchRoot, "listing");
  process.env.CUSTOMER_DATA_DIR = listRoot;

  const workspace = await import("../src/lib/customer-data/workspace");
  const {
    customerSlugFromCookieHeader,
    listWorkspaceSlugs,
    resolveActiveCustomerSlug,
    recordIngestedCustomer,
  } = workspace;

  function writeManifest(slug: string, customer: string): void {
    const target = customerPaths(slug);
    fs.mkdirSync(target.processed, { recursive: true });
    fs.writeFileSync(
      target.manifest,
      JSON.stringify({ customer, rowCount: 1, currencies: ["USD"] }),
    );
    fs.writeFileSync(target.rows, "");
  }

  check("only folders with datasets appear in the listing", () => {
    fs.mkdirSync(path.join(listRoot, "without-dataset"), { recursive: true });
    writeManifest("alfa", "Alfa");
    writeManifest("beta", "Beta");

    const slugs = listWorkspaceSlugs();
    assert.ok(slugs.includes("alfa"));
    assert.ok(slugs.includes("beta"));
    assert.ok(!slugs.includes(LEGACY_WORKSPACE_SLUG));
  });

  check("the root folder becomes a legacy workspace when it has a dataset", () => {
    writeManifest(LEGACY_WORKSPACE_SLUG, "Legacy");
    assert.ok(listWorkspaceSlugs().includes(LEGACY_WORKSPACE_SLUG));
  });

  group("Active customer");

  check("CUSTOMER_SLUG overrides the registry", () => {
    recordIngestedCustomer("beta", "Beta");
    process.env.CUSTOMER_SLUG = "alfa";
    assert.equal(resolveActiveCustomerSlug(), "alfa");
    delete process.env.CUSTOMER_SLUG;
  });

  check("without an environment value, the last ingested customer applies", () => {
    recordIngestedCustomer("beta", "Beta");
    assert.equal(resolveActiveCustomerSlug(), "beta");
  });

  check("an unknown slug is ignored rather than becoming a path", () => {
    process.env.CUSTOMER_SLUG = "../etc";
    assert.notEqual(resolveActiveCustomerSlug(), "../etc");
    process.env.CUSTOMER_SLUG = "does-not-exist";
    assert.notEqual(resolveActiveCustomerSlug(), "does-not-exist");
    delete process.env.CUSTOMER_SLUG;
  });

  check("resolving the active customer works outside an HTTP request", () => {
    // next/headers does not exist in the script runtime: cookie reading must
    // degrade to "no cookie" and never bring down ingestion.
    assert.doesNotThrow(() => resolveActiveCustomerSlug());
  });

  group("Dataset isolation");

  const dataRoot = path.join(scratchRoot, "datasets");
  process.env.CUSTOMER_DATA_DIR = dataRoot;

  const contract = await import("../src/lib/customer-data/contract");
  const dataset = await import("../src/lib/customer-dataset");

  function writeDataset(slug: string, customer: string, cost: number): void {
    const target = customerPaths(slug);
    fs.mkdirSync(target.processed, { recursive: true });
    fs.writeFileSync(
      target.manifest,
      JSON.stringify({
        schemaVersion: contract.CUSTOMER_DATASET_SCHEMA_VERSION,
        customer,
        format: "focus",
        generatedAtUtc: "2026-08-01T00:00:00.000Z",
        sourceFiles: ["synthetic.csv"],
        rowCount: 1,
        skippedRowCount: 0,
        periodStart: "2026-07-01",
        periodEnd: "2026-07-01",
        currencies: ["USD"],
        hasUsdCosts: true,
        warnings: [],
      }),
    );
    fs.writeFileSync(
      target.rows,
      `${JSON.stringify({
        chargePeriodStart: "2026-07-01",
        effectiveCost: cost,
        billingCurrency: "USD",
        tags: {},
      })}\n`,
    );
  }

  check("each workspace serves its own dataset", () => {
    writeDataset("alfa", "Alfa", 10);
    writeDataset("beta", "Beta", 999);
    dataset.resetCustomerDatasetCache();

    assert.equal(dataset.getCustomerDataset("alfa")?.manifest.customer, "Alfa");
    assert.equal(dataset.getCustomerDataset("beta")?.manifest.customer, "Beta");
  });

  check("reading one customer does not poison the other cache", () => {
    // The bug this test prevents: a single module cache returning rows from the
    // previous customer after the switch.
    dataset.resetCustomerDatasetCache();
    assert.equal(dataset.getCustomerDataset("alfa")?.rows[0].effectiveCost, 10);
    assert.equal(dataset.getCustomerDataset("beta")?.rows[0].effectiveCost, 999);
    assert.equal(dataset.getCustomerDataset("alfa")?.rows[0].effectiveCost, 10);
  });

  check("cookies from different requests select different workspaces", () => {
    dataset.resetCustomerDatasetCache();
    const alphaRequest = new Request("http://localhost/api/cost-summary/kpi", {
      headers: { cookie: "finops_customer=alfa" },
    });
    const betaRequest = new Request("http://localhost/api/cost-summary/kpi", {
      headers: { cookie: "finops_customer=beta" },
    });

    assert.equal(
      dataset.getCustomerDatasetForRequest(alphaRequest)?.manifest.customer,
      "Alfa",
    );
    assert.equal(
      dataset.getCustomerDatasetForRequest(betaRequest)?.manifest.customer,
      "Beta",
    );
  });

  check("an invalid or traversal cookie does not select a path", () => {
    for (const hostile of ["../etc", "..", "alfa/../beta", "%2e%2e%2fetc"]) {
      assert.equal(
        customerSlugFromCookieHeader(`finops_customer=${hostile}`),
        null,
        `accepted "${hostile}"`,
      );
    }

    process.env.CUSTOMER_SLUG = "beta";
    const hostileRequest = new Request("http://localhost/api/cost-summary/kpi", {
      headers: { cookie: "finops_customer=../etc" },
    });

    assert.equal(
      dataset.getCustomerDatasetForRequest(hostileRequest)?.manifest.customer,
      "Beta",
    );
    delete process.env.CUSTOMER_SLUG;
  });

  check("chat tool context remains scoped to the request customer", () => {
    const agentTools = require("../src/lib/customer-agent-tools") as typeof import("../src/lib/customer-agent-tools");
    const alfaRequest = new Request("http://localhost/api/chat", {
      headers: { cookie: "finops_customer=alfa" },
    });
    const betaRequest = new Request("http://localhost/api/chat", {
      headers: { cookie: "finops_customer=beta" },
    });
    const alfa = agentTools.getCustomerMetricJson(
      "cost_last_30d",
      customerSlugFromCookieHeader(alfaRequest.headers.get("cookie")),
    );
    const beta = agentTools.getCustomerMetricJson(
      "cost_last_30d",
      customerSlugFromCookieHeader(betaRequest.headers.get("cookie")),
    );

    assert.match(alfa, /"customer":"Alfa"/);
    assert.match(beta, /"customer":"Beta"/);
    assert.match(alfa, /10/);
    assert.match(beta, /999/);
  });

  check("stakeholder facts remain scoped to the request customer", () => {
    const { buildStakeholderFacts } = require("../src/lib/stakeholder/facts") as typeof import("../src/lib/stakeholder/facts");
    const filters = (require("../src/lib/filter-schema") as typeof import("../src/lib/filter-schema")).filterSchema.parse({});

    assert.equal(buildStakeholderFacts(filters, "alfa").customerName, "Alfa");
    assert.equal(buildStakeholderFacts(filters, "beta").customerName, "Beta");
  });

  await checkAsync("multicloud payload remains scoped to the request customer", async () => {
    const { buildMulticloudComparisonPayload } = await import(
      "../src/lib/multicloud"
    );
    const { filterSchema } = await import("../src/lib/filter-schema");
    const filters = filterSchema.parse({});

    const alfa = await buildMulticloudComparisonPayload(filters, {}, "alfa");
    const beta = await buildMulticloudComparisonPayload(filters, {}, "beta");
    assert.equal(alfa.metadata.customerName, "Alfa");
    assert.equal(beta.metadata.customerName, "Beta");
  });

  check("without a slug, the dataset follows the active customer", () => {
    dataset.resetCustomerDatasetCache();
    process.env.CUSTOMER_SLUG = "alfa";
    assert.equal(dataset.getCustomerDataset()?.manifest.customer, "Alfa");
    process.env.CUSTOMER_SLUG = "beta";
    assert.equal(dataset.getCustomerDataset()?.manifest.customer, "Beta");
    delete process.env.CUSTOMER_SLUG;
  });

  check("no ingested dataset returns null, not an error", () => {
    process.env.CUSTOMER_DATA_DIR = path.join(scratchRoot, "empty");
    dataset.resetCustomerDatasetCache();
    assert.equal(dataset.getCustomerDataset(), null);
    process.env.CUSTOMER_DATA_DIR = dataRoot;
  });

  group("Workspace ingestion");

  const ingestRoot = path.join(scratchRoot, "ingest");
  // With CUSTOMER_DATA_DIR pointing to a test folder, output remains at
  // `<root>/.output/<slug>` so the test folder is removable in one operation.
  // The standard installation uses two trees: input/customer and output/customer.
  const outputOf = (root: string, slug: string) =>
    path.join(root, ".output", slug);

  writeCostExport(path.join(ingestRoot, "contoso"), "12.50", "vm-contoso");
  writeCostExport(path.join(ingestRoot, "fabrikam"), "77.00", "vm-fabrikam");

  check("each customer is ingested into its own folder", () => {
    assert.equal(runIngest(ingestRoot, "Contoso").ok, true);
    assert.equal(runIngest(ingestRoot, "Fabrikam").ok, true);

    for (const slug of ["contoso", "fabrikam"]) {
      assert.ok(
        fs.existsSync(path.join(outputOf(ingestRoot, slug), "manifest.json")),
        `missing manifest for ${slug}`,
      );
    }
    // The root must not gain a dataset that aggregates both.
    assert.ok(!fs.existsSync(path.join(ingestRoot, ".processed", "manifest.json")));
  });

  check("output stays outside the customer input folder", () => {
    // Required separation: the raw export and processed dataset do not mix,
    // so clearing output never deletes the collection.
    assert.ok(
      !fs.existsSync(path.join(ingestRoot, "contoso", ".processed")),
      "the dataset should no longer be inside the input folder",
    );
    const inputEntries = fs.readdirSync(path.join(ingestRoot, "contoso"));
    assert.deepEqual(inputEntries, ["cost.csv"]);
  });

  check("one customer dataset does not contain another customer rows", () => {
    const read = (slug: string) =>
      fs.readFileSync(path.join(outputOf(ingestRoot, slug), "rows.ndjson"), "utf8");

    assert.ok(read("contoso").includes("12.5"));
    assert.ok(!read("contoso").includes("77"));
    assert.ok(read("fabrikam").includes("77"));
    assert.ok(!read("fabrikam").includes("12.5"));
  });

  check("the registry points to the last ingested customer", () => {
    const registry = JSON.parse(
      fs.readFileSync(path.join(ingestRoot, ".output", "registry.json"), "utf8"),
    ) as { lastIngestedSlug: string; customers: { slug: string }[] };

    assert.equal(registry.lastIngestedSlug, "fabrikam");
    assert.deepEqual(
      registry.customers.map((entry) => entry.slug).sort(),
      ["contoso", "fabrikam"],
    );
  });

  check("ingesting the root with already isolated customers is rejected", () => {
    // This is the original bug: loose files would be added to existing customer
    // files in one dataset without any warning.
    writeCostExport(ingestRoot, "5.00", "vm-solta");
    const result = runIngest(ingestRoot, "Northwind");

    assert.equal(result.ok, false, "ingestion should have failed");
    if (!result.ok) {
      assert.ok(
        /merge different customers|Ingesting the root/i.test(result.output),
        `unexpected message: ${result.output}`,
      );
    }
  });

  check("a folder named after the customer is reused, not duplicated", () => {
    // Real scenario: an earlier collection created "Contoso"; ingesting "Contoso"
    // must not create a second empty workspace called "contoso" beside it.
    const mixedRoot = path.join(scratchRoot, "mixed");
    writeCostExport(path.join(mixedRoot, "Contoso"), "9.90", "vm-contoso");

    assert.equal(runIngest(mixedRoot, "Contoso").ok, true);
    assert.ok(
      fs.existsSync(path.join(outputOf(mixedRoot, "Contoso"), "manifest.json")),
    );
    // `existsSync("contoso")` lies on a case-insensitive filesystem: the check
    // must use the directory entries' actual names.
    const folders = fs
      .readdirSync(mixedRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
    assert.deepEqual(folders, ["Contoso"]);
  });

  group("Compatibility with the old layout");

  check("a loose root export is still ingested when it is the only one", () => {
    const legacyRoot = path.join(scratchRoot, "legacy");
    writeCostExport(legacyRoot, "33.00", "vm-legacy");

    assert.equal(runIngest(legacyRoot, "Legacy").ok, true);
    assert.ok(
      fs.existsSync(path.join(legacyRoot, ".processed", "manifest.json")),
      "the legacy dataset should remain at the root",
    );
  });

  console.log(
    `\n${passed} passed, ${failures.length} failed`,
  );
  if (failures.length > 0) {
    for (const failure of failures) console.error(`\n- ${failure}`);
    process.exit(1);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    cleanupScratchRoot();
  });
