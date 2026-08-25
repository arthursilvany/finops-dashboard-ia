/**
 * ADX query timeout tests.
 *
 * Run: `npm run adx:test`
 *
 * None of these tests reach a cluster or need a credential. They cover the
 * setting that the deployment templates have always written and the portal has
 * always offered as "query timeout", but which nothing read until now: the
 * client aborted at a hard-coded 30 seconds no matter what was configured.
 *
 * What is worth asserting is not that a number is parsed, but that the deadline
 * survives the two places it used to be lost: the retry loop, which multiplied
 * it by the attempt count, and the request body, which never carried it to
 * Kusto at all.
 */
import {
  buildRequestBody,
  fetchWithRetry,
  getQueryTimeoutSeconds,
} from "../src/lib/adx-client";

let failures = 0;
let passes = 0;

function check(name: string, assertion: () => void | Promise<void>) {
  return Promise.resolve()
    .then(assertion)
    .then(() => {
      passes += 1;
      console.log(`  ✓ ${name}`);
    })
    .catch((error: unknown) => {
      failures += 1;
      console.error(`  ✗ ${name}`);
      console.error(`      ${(error as Error).message}`);
    });
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

/** Restores the variable afterwards so tests cannot leak into one another. */
function withTimeoutEnv<T>(value: string | undefined, run: () => T): T {
  const previous = process.env.ADX_QUERY_TIMEOUT_SECONDS;
  if (value === undefined) delete process.env.ADX_QUERY_TIMEOUT_SECONDS;
  else process.env.ADX_QUERY_TIMEOUT_SECONDS = value;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.ADX_QUERY_TIMEOUT_SECONDS;
    else process.env.ADX_QUERY_TIMEOUT_SECONDS = previous;
  }
}

function serverTimeoutOf(body: Record<string, unknown>): string | undefined {
  const properties = body.properties as
    | { Options?: { servertimeout?: string } }
    | undefined;
  return properties?.Options?.servertimeout;
}

async function main() {
  console.log("\nReading the configured deadline");

  await check("honours ADX_QUERY_TIMEOUT_SECONDS", () => {
    withTimeoutEnv("120", () => {
      assert(
        getQueryTimeoutSeconds() === 120,
        "the configured value must be used verbatim",
      );
    });
  });

  await check("falls back to 30s when unset", () => {
    withTimeoutEnv(undefined, () => {
      assert(getQueryTimeoutSeconds() === 30, "default must remain 30s");
    });
  });

  await check("falls back rather than throwing on a malformed value", () => {
    for (const value of ["", "   ", "abc", "NaN", "0", "-5"]) {
      withTimeoutEnv(value, () => {
        assert(
          getQueryTimeoutSeconds() === 30,
          `"${value}" must fall back to the default, not break every query`,
        );
      });
    }
  });

  await check("clamps to the one hour Kusto accepts", () => {
    withTimeoutEnv("99999", () => {
      assert(
        getQueryTimeoutSeconds() === 3600,
        "a servertimeout above one hour is rejected by Kusto outright",
      );
    });
  });

  console.log("\nCarrying the deadline to the cluster");

  await check("sends servertimeout with every query", () => {
    const body = buildRequestBody("Hub", "Costs | take 1", "query", 120);
    assert(
      serverTimeoutOf(body) === "00:02:00",
      `expected 00:02:00, got ${serverTimeoutOf(body)}`,
    );
  });

  await check("formats the timespan as hh:mm:ss", () => {
    const cases: [number, string][] = [
      [1, "00:00:01"],
      [30, "00:00:30"],
      [90, "00:01:30"],
      [3600, "01:00:00"],
    ];
    for (const [seconds, expected] of cases) {
      const body = buildRequestBody("Hub", "Costs", "query", seconds);
      assert(
        serverTimeoutOf(body) === expected,
        `${seconds}s must serialise as ${expected}, got ${serverTimeoutOf(body)}`,
      );
    }
  });

  await check("leaves control commands untouched", () => {
    const body = buildRequestBody("Hub", ".show database schema", "mgmt", 30);
    assert(
      serverTimeoutOf(body) === undefined,
      "the health check probe must not carry request properties",
    );
    assert(body.db === "Hub" && typeof body.csl === "string", "db and csl must still be sent");
  });

  console.log("\nThe deadline is a deadline");

  await check("a timed-out query is not retried", async () => {
    // The retry loop used to treat an abort like any transient fault, so a
    // query that overran its budget was re-issued three more times: the user
    // waited four times the configured timeout, and the cluster ran the same
    // expensive query four times over.
    const originalFetch = globalThis.fetch;
    let attempts = 0;
    globalThis.fetch = (async () => {
      attempts += 1;
      const error = new Error("The operation was aborted due to timeout");
      error.name = "TimeoutError";
      throw error;
    }) as typeof fetch;

    try {
      let message = "";
      try {
        await fetchWithRetry("https://example.invalid", { method: "POST" }, 30_000);
      } catch (error) {
        message = (error as Error).message;
      }
      assert(
        attempts === 1,
        `a timeout must be reported, not retried (saw ${attempts} attempts)`,
      );
      assert(
        message.includes("timed out after 30s"),
        `the error must name the deadline, got "${message}"`,
      );
      assert(
        message.includes("ADX_QUERY_TIMEOUT_SECONDS"),
        "the error must point at the setting that raises the limit",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await check("a transient network fault is still retried", async () => {
    const originalFetch = globalThis.fetch;
    let attempts = 0;
    globalThis.fetch = (async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("ECONNRESET");
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    try {
      const res = await fetchWithRetry(
        "https://example.invalid",
        { method: "POST" },
        30_000,
      );
      assert(attempts === 3, `expected 3 attempts, saw ${attempts}`);
      assert(res.status === 200, "the recovered response must be returned");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  console.log(
    `\n${passes} passed, ${failures} failed\n`,
  );
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
