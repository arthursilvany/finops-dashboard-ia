/**
 * Tests for the SKU Advisor integration.
 *
 * Run: `npm run sku-advisor:test`
 *
 * None of these start a server. They cover the three things that can silently
 * go wrong: the payload contract drifting away from what the advisor emits, the
 * selectors misreading the advisor's arithmetic, and the source-resolution
 * chain quietly serving sample data as if it were the customer's estate.
 */
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import { mockSkuAdvisorPayload } from "../src/lib/mock-data/sku-advisor";
import { buildAdvisorQuery, fetchSkuAdvisorPayload } from "../src/lib/sku-advisor-client";
import {
  parseSkuAdvisorPayload,
  skuAdvisorPayloadSchema,
} from "../src/lib/sku-advisor-contract";
import {
  selectCapacity,
  selectKpi,
  selectLevers,
  selectLifecycle,
  selectRecommendations,
} from "../src/lib/sku-advisor-aggregations";

let failures = 0;
let passes = 0;

function safeCheck(name: string, assertion: () => void) {
  try {
    assertion();
    passes += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ ${name}`);
    console.error(`      ${(error as Error).message}`);
  }
}

async function safeCheckAsync(name: string, assertion: () => Promise<void>) {
  try {
    await assertion();
    passes += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  ✗ ${name}`);
    console.error(`      ${(error as Error).message}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function main() {
  console.log("\nQuery construction");

  safeCheck("forwards the deployment's estate regions when the caller names none", () => {
    const previous = process.env.SKU_ADVISOR_REGIONS;
    process.env.SKU_ADVISOR_REGIONS = "uksouth, swedencentral ,";
    try {
      const query = buildAdvisorQuery({}, true);
      assert(
        query.getAll("region").join(",") === "uksouth,swedencentral",
        "configured regions must be forwarded, trimmed, with blanks dropped",
      );
    } finally {
      if (previous === undefined) delete process.env.SKU_ADVISOR_REGIONS;
      else process.env.SKU_ADVISOR_REGIONS = previous;
    }
  });

  safeCheck("an explicit region filter overrides the deployment default", () => {
    const previous = process.env.SKU_ADVISOR_REGIONS;
    process.env.SKU_ADVISOR_REGIONS = "uksouth";
    try {
      const query = buildAdvisorQuery({ region: "eastus" }, true);
      assert(
        query.getAll("region").join(",") === "eastus",
        "a caller's region filter must not be widened by the deployment default",
      );
    } finally {
      if (previous === undefined) delete process.env.SKU_ADVISOR_REGIONS;
      else process.env.SKU_ADVISOR_REGIONS = previous;
    }
  });

  safeCheck("sends no region filter when the deployment declares none", () => {
    const previous = process.env.SKU_ADVISOR_REGIONS;
    delete process.env.SKU_ADVISOR_REGIONS;
    try {
      assert(
        !buildAdvisorQuery({}, true).has("region"),
        "an unset region list must leave the advisor's own scope untouched",
      );
    } finally {
      if (previous !== undefined) process.env.SKU_ADVISOR_REGIONS = previous;
    }
  });

  safeCheck("omits telemetry flags by default", () => {
    const query = buildAdvisorQuery({}, true);
    assert(!query.has("telemetry"), "telemetry must stay off unless requested");
    assert(!query.has("live_telemetry"), "live_telemetry must stay off unless requested");
  });

  safeCheck("sets both telemetry flags when live telemetry is requested", () => {
    const query = buildAdvisorQuery({}, true, true);
    assert(
      query.get("telemetry") === "true",
      "live telemetry implies the offline telemetry flag too",
    );
    assert(query.get("live_telemetry") === "true", "live_telemetry must be forwarded");
  });

  console.log("\nContract");

  safeCheck("parses the bundled sample payload", () => {
    const parsed = parseSkuAdvisorPayload(mockSkuAdvisorPayload);
    assert(parsed !== null, "the bundled sample must satisfy the contract");
  });

  safeCheck("tolerates unknown advisor fields", () => {
    const withExtras = {
      ...mockSkuAdvisorPayload,
      brand_new_block: { anything: true },
      summary: { ...mockSkuAdvisorPayload.summary, brand_new_metric: 42 },
    };
    const parsed = skuAdvisorPayloadSchema.safeParse(withExtras);
    assert(parsed.success, "a new advisor field must not break the contract");
  });

  safeCheck("tolerates null numerics from an unmeasured axis", () => {
    const unmeasured = {
      generated_at: "2026-01-01T00:00:00Z",
      summary: {
        currency: "USD",
        total_monthly_savings: null,
        effective_savings_rate_pct: null,
      },
      recommendations: [],
    };
    assert(
      parseSkuAdvisorPayload(unmeasured) !== null,
      "null numerics must parse: the advisor uses them for 'not measured'",
    );
  });

  safeCheck("accepts the advisor's structured esr_scope and lifecycle_exposure", () => {
    // Regression: both fields are structured, not scalar. `esr_scope` is an
    // object describing how the rate was scoped, and `lifecycle_exposure` is a
    // list with one entry per affected SKU series. Modelling either as a
    // scalar rejects every real payload the advisor emits.
    const parsed = parseSkuAdvisorPayload({
      generated_at: "2026-01-01T00:00:00Z",
      summary: {
        currency: "BRL",
        effective_savings_rate_pct: 19.07,
        esr_scope: { estate_esr_pct: 19.07, addressable_share_pct: 100 },
        lifecycle_exposure: [
          {
            retirement_date: "2028-11-15",
            series: "Fsv2-series",
            status: "announced",
            vms: 4,
            current_monthly: 2535.14,
            source: "curated",
            live_confirmed: false,
          },
        ],
      },
      recommendations: [],
    });
    assert(parsed !== null, "the advisor's real field shapes must parse");
    assert(
      selectLifecycle(parsed!).exposureMonthly === 2535.14,
      "exposure must be summed from the series entries",
    );
  });

  safeCheck("rejects a payload without a summary", () => {
    assert(
      parseSkuAdvisorPayload({ recommendations: [] }) === null,
      "a payload with no summary is not an advisor payload",
    );
  });

  console.log("\nSelectors");

  const payload = mockSkuAdvisorPayload;

  safeCheck("KPIs come from the advisor, not recomputed", () => {
    const kpi = selectKpi(payload);
    assert(
      kpi.monthlySavings === payload.summary.total_monthly_savings,
      "monthly savings must be the advisor's own total",
    );
    assert(
      kpi.effectiveSavingsRatePct === payload.summary.effective_savings_rate_pct,
      "ESR must be passed through, never re-derived",
    );
    assert(kpi.currency === "USD", "currency must come from the summary");
  });

  safeCheck("recommendations are ordered by monthly saving", () => {
    const rows = selectRecommendations(payload);
    assert(rows.length === payload.recommendations.length, "no row may be dropped");
    for (let i = 1; i < rows.length; i += 1) {
      assert(
        rows[i - 1].monthlySavings >= rows[i].monthlySavings,
        "rows must be sorted descending by monthly saving",
      );
    }
  });

  safeCheck("a quota-blocked recommendation is flagged, not hidden", () => {
    const rows = selectRecommendations(payload);
    const blocked = rows.filter((r) => r.blocked);
    assert(
      blocked.length === 1 && blocked[0].currentSize === "Standard_E16s_v4",
      "the quota-blocked row must survive and carry the blocked flag",
    );
  });

  safeCheck("levers report what was counted, not what was computed", () => {
    const levers = selectLevers(payload);
    const schedule = levers.find((l) => l.key === "schedule");
    assert(schedule !== undefined, "the schedule lever must be present");
    assert(
      schedule!.monthlySavings === 1620.4 && schedule!.countedMonthly === 1390.8,
      "a lever that deferred savings to another track must show both figures",
    );
    const commitment = levers.find((l) => l.key === "commitment");
    assert(
      commitment!.evaluated === false && commitment!.note !== "",
      "an unevaluated lever must say why",
    );
  });

  safeCheck("healthy SKUs are excluded from lifecycle exposure", () => {
    const lifecycle = selectLifecycle(payload);
    assert(
      lifecycle.items.every((i) => i.status !== "current" && i.status !== ""),
      "only retiring/previous-gen series belong in the exposure table",
    );
    assert(
      lifecycle.items.some((i) => i.status === "announced"),
      "the sample must exercise the announced-retirement path",
    );
    assert(
      lifecycle.exposureMonthly === 8480.6,
      `exposure must sum the advisor's series entries, got ${lifecycle.exposureMonthly}`,
    );
    assert(
      lifecycle.items[0].monthly >= lifecycle.items[1].monthly,
      "series must be ordered by monthly spend",
    );
  });

  safeCheck("lifecycle falls back to the per-recommendation blocks", () => {
    // An older advisor export has no `lifecycle_exposure` list. The table must
    // still mean the same thing, rebuilt from the recommendations.
    const legacy = {
      ...payload,
      summary: { ...payload.summary, lifecycle_exposure: undefined },
    };
    const lifecycle = selectLifecycle(legacy);
    assert(
      lifecycle.items.length > 0,
      "an export without the exposure list must still populate the table",
    );
    assert(
      lifecycle.items.every((i) => i.source === "recommendations"),
      "the fallback must declare where it came from",
    );
    assert(
      lifecycle.items.every((i) => i.status !== "current" && i.status !== ""),
      "healthy SKUs must not appear in the fallback either",
    );
  });

  safeCheck("capacity blockers list every unreachable saving", () => {
    const capacity = selectCapacity(payload);
    assert(
      capacity.blockers.length === 1,
      "the sample has exactly one blocked recommendation",
    );
    assert(
      capacity.blockers[0].reason === "quota" &&
        capacity.blockers[0].monthlySavingsAtRisk === 612,
      "the blocker must name the reason and the saving it puts at risk",
    );
  });

  console.log("\nSource resolution");

  // The source chain reads the filesystem and the environment, so it is
  // exercised against a scratch workspace rather than the developer's own.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "sku-advisor-test-"));
  process.env.CUSTOMER_DATA_DIR = scratch;
  delete process.env.SKU_ADVISOR_API_URL;

  const { resolveSkuAdvisorPayload } = await import(
    "../src/lib/sku-advisor-source"
  );
  const { customerPaths, LEGACY_WORKSPACE_SLUG } = await import(
    "../src/lib/customer-data/paths"
  );

  await safeCheckAsync("falls back to the sample when nothing is configured", async () => {
    const resolved = await resolveSkuAdvisorPayload();
    assert(resolved.source === "mock", "no service and no export means sample data");
  });

  await safeCheckAsync("a workspace export outranks the sample", async () => {
    const paths = customerPaths(LEGACY_WORKSPACE_SLUG);
    fs.mkdirSync(path.dirname(paths.skuAdvisor), { recursive: true });
    fs.writeFileSync(
      paths.skuAdvisor,
      JSON.stringify({
        generated_at: "2026-02-02T00:00:00Z",
        summary: { currency: "BRL", total_monthly_savings: 1234 },
        recommendations: [],
      }),
    );

    const resolved = await resolveSkuAdvisorPayload();
    assert(resolved.source === "customer", "an export on disk must win over the sample");
    assert(
      selectKpi(resolved.payload).monthlySavings === 1234,
      "the export's own figures must be served",
    );
  });

  await safeCheckAsync("a corrupt export degrades instead of failing", async () => {
    const paths = customerPaths(LEGACY_WORKSPACE_SLUG);
    fs.writeFileSync(paths.skuAdvisor, "{ not json");

    const resolved = await resolveSkuAdvisorPayload();
    assert(
      resolved.source === "mock",
      "an unreadable export must fall through, not take the page down",
    );
  });

  await safeCheckAsync("an unreachable service falls back, and says so", async () => {
    // Nothing listens on this port, so the call fails at connect time and
    // exercises the "configured but not answering" branch without any network
    // dependency. The client reads the URL per call, so no module reload is
    // needed.
    process.env.SKU_ADVISOR_API_URL = "http://127.0.0.1:59317";
    try {
      const resolved = await resolveSkuAdvisorPayload();
      assert(
        resolved.source !== "service",
        "a failed service call must never be labelled as live",
      );
    } finally {
      delete process.env.SKU_ADVISOR_API_URL;
    }
  });

  fs.rmSync(scratch, { recursive: true, force: true });

  console.log("\nSafety");

  safeCheck("an unrecognizable payload is rejected, not rendered as zeroes", () => {
    // The contract is permissive so advisor-side additions cannot 500 the page.
    // The cost of that is this failure mode: if the advisor renamed every
    // summary key, an empty summary would still parse and the page would show a
    // confident "$0 monthly savings" under a live badge instead of falling back.
    const renamed = parseSkuAdvisorPayload({
      generated_at: "2026-01-01T00:00:00Z",
      summary: { currency: "USD", grand_total_savings_v2: 1234 },
      recommendations: [],
    });
    assert(
      renamed === null,
      "a payload with no recognizable figures must fall through to the next source",
    );
    assert(
      parseSkuAdvisorPayload({
        generated_at: "2026-01-01T00:00:00Z",
        summary: { currency: "USD", total_monthly_savings: 0 },
        recommendations: [],
      }) !== null,
      "a genuine zero-savings estate is still a valid answer and must be kept",
    );
  });

  safeCheck("capacity distinguishes 'not checked' from 'no blockers'", () => {
    // Reporting an unrequested check as an all-clear would tell a stakeholder
    // every recommendation is provisionable when nothing was verified.
    const unchecked = selectCapacity({
      ...payload,
      summary: { ...payload.summary, capacity_checked_workloads: undefined },
      recommendations: [],
    });
    assert(
      unchecked.checked === false,
      "an absent capacity pass must not be reported as a completed check",
    );
    assert(
      selectCapacity(payload).checked === true,
      "the sample does run the capacity pass and must read as checked",
    );
  });

  await safeCheckAsync("the browser can never ask for live or billable work", async () => {
    // The allowlist is the choke point: `live_*` drives the advisor's Managed
    // Identity into the customer's estate and `ai_narrative` is a billable
    // OpenAI call with estate-data egress. Neither may be reachable from a
    // query string, whatever casing or repetition is used.
    const seen: string[] = [];
    const server = http.createServer((req, res) => {
      seen.push(req.url ?? "");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(mockSkuAdvisorPayload));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    process.env.SKU_ADVISOR_API_URL = `http://127.0.0.1:${port}`;
    delete process.env.SKU_ADVISOR_LIVE_USAGE;
    try {
      await fetchSkuAdvisorPayload({
        region: "eastus",
        // Not on the allowlist — these must be dropped entirely.
        live_usage: "true",
        LIVE_USAGE: "true",
        ai_narrative: "true",
        placement: "true",
      } as never);

      const query = seen[0] ?? "";
      for (const forbidden of ["live_usage", "ai_narrative", "placement", "LIVE_USAGE"]) {
        assert(
          !query.includes(forbidden),
          `'${forbidden}' reached the advisor from request input: ${query}`,
        );
      }
      assert(query.includes("region=eastus"), "allowlisted params must survive");
      assert(
        query.includes("quota=true") && query.includes("capacity=true"),
        "the offline quota/capacity passes must be requested, or the panel cannot tell 'clear' from 'unchecked'",
      );
    } finally {
      delete process.env.SKU_ADVISOR_API_URL;
      server.close();
    }
  });

  await safeCheckAsync("live inventory is a server decision and is labelled", async () => {
    // `live_usage` decides whether the recommendations describe the customer's
    // real estate or the advisor's bundled sample, so the answer must say which
    // one it is rather than hiding behind "live service".
    const seen: string[] = [];
    const server = http.createServer((req, res) => {
      seen.push(req.url ?? "");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(mockSkuAdvisorPayload));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    process.env.SKU_ADVISOR_API_URL = `http://127.0.0.1:${port}`;
    try {
      const offline = await fetchSkuAdvisorPayload();
      assert(
        offline?.inventory === "offline",
        "without the opt-in the inventory is the advisor's sample and must say so",
      );
      assert(
        !(seen[0] ?? "").includes("live_usage"),
        "live inventory must not be requested unless the deployment opted in",
      );

      process.env.SKU_ADVISOR_LIVE_USAGE = "true";
      const live = await fetchSkuAdvisorPayload();
      assert(
        live?.inventory === "live",
        "with the opt-in the answer describes the real estate",
      );
      assert(
        (seen[1] ?? "").includes("live_usage=true"),
        "the opt-in must actually reach the advisor",
      );
    } finally {
      delete process.env.SKU_ADVISOR_API_URL;
      delete process.env.SKU_ADVISOR_LIVE_USAGE;
      server.close();
    }
  });

  await safeCheckAsync("a refused live request degrades instead of failing", async () => {
    // If the advisor forbids live reads, the view should lose meaning, not
    // disappear — and it must not claim live inventory it never got.
    const seen: string[] = [];
    const server = http.createServer((req, res) => {
      seen.push(req.url ?? "");
      if ((req.url ?? "").includes("live_usage=true")) {
        res.statusCode = 403;
        res.end(JSON.stringify({ detail: "Live Azure operations are disabled." }));
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(mockSkuAdvisorPayload));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    process.env.SKU_ADVISOR_API_URL = `http://127.0.0.1:${port}`;
    process.env.SKU_ADVISOR_LIVE_USAGE = "true";
    try {
      const result = await fetchSkuAdvisorPayload();
      assert(result !== null, "a 403 on live reads must not take the view down");
      assert(
        result?.inventory === "offline",
        "a refused live read must be reported as offline inventory",
      );
      assert(seen.length === 2, "the retry should drop the flag and try once more");
    } finally {
      delete process.env.SKU_ADVISOR_API_URL;
      delete process.env.SKU_ADVISOR_LIVE_USAGE;
      server.close();
    }
  });

  await safeCheckAsync("the five panels share one advisor run", async () => {
    // Each panel resolves independently. Without sharing, one run could answer
    // some panels and time out on others, leaving live figures beside sample
    // figures under a single badge — and a cold page load would trigger five
    // full pipeline runs at once.
    let calls = 0;
    const server = http.createServer((_req, res) => {
      calls += 1;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(mockSkuAdvisorPayload));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    process.env.SKU_ADVISOR_API_URL = `http://127.0.0.1:${port}`;
    try {
      const results = await Promise.all(
        [1, 2, 3, 4, 5].map(() => resolveSkuAdvisorPayload({ region: "shared-run" })),
      );
      assert(calls === 1, `five concurrent panels made ${calls} advisor runs`);
      assert(
        new Set(results.map((r) => r.source)).size === 1,
        "panels rendered together must agree on where their numbers came from",
      );
    } finally {
      delete process.env.SKU_ADVISOR_API_URL;
      server.close();
    }
  });

  await safeCheckAsync("a customer export is never served to the next customer", async () => {
    // The service run is memoized because it is expensive. The workspace export
    // must not be: the key covers advisor params only, so caching it would
    // ignore which customer is active and keep serving the previous
    // customer's estate after a workspace switch.
    const a = path.join(scratch, "cust-a");
    fs.mkdirSync(path.join(a, ".processed"), { recursive: true });
    fs.writeFileSync(
      path.join(a, ".processed", "sku-advisor.json"),
      JSON.stringify({
        generated_at: "2026-01-01T00:00:00Z",
        summary: { currency: "USD", total_monthly_savings: 111 },
        recommendations: [],
      }),
    );

    const previous = process.env.CUSTOMER_DATA_DIR;
    process.env.CUSTOMER_DATA_DIR = a;
    try {
      const first = await resolveSkuAdvisorPayload({ region: "swap-test" });
      assert(first.source === "customer", "the export should be picked up");

      // Same advisor params, different workspace content.
      fs.writeFileSync(
        path.join(a, ".processed", "sku-advisor.json"),
        JSON.stringify({
          generated_at: "2026-01-02T00:00:00Z",
          summary: { currency: "USD", total_monthly_savings: 222 },
          recommendations: [],
        }),
      );
      const second = await resolveSkuAdvisorPayload({ region: "swap-test" });
      assert(
        selectKpi(second.payload).monthlySavings === 222,
        "a workspace change must be reflected immediately, not after a TTL",
      );
    } finally {
      if (previous === undefined) delete process.env.CUSTOMER_DATA_DIR;
      else process.env.CUSTOMER_DATA_DIR = previous;
    }
  });

  console.log(`\n${passes} passed, ${failures} failed\n`);
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
