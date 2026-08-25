import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const scratchDir = path.resolve(
  process.cwd(),
  ".daily-insights-store-test-artifacts",
);

async function main(): Promise<void> {
  fs.rmSync(scratchDir, { recursive: true, force: true });
  process.env.DAILY_INSIGHTS_DIR = scratchDir;

  const { listReports, loadReport, saveReport } = await import(
    "../src/lib/daily-insights-store"
  );
  const date = "2026-07-01";

  try {
    await saveReport(
      { date, content: "default report", generatedAt: "2026-07-01T00:00:00Z" },
    );
    await saveReport(
      { date, content: "alfa report", generatedAt: "2026-07-01T00:00:00Z" },
      "alfa",
    );
    await saveReport(
      { date, content: "beta report", generatedAt: "2026-07-01T00:00:00Z" },
      "beta",
    );

    assert.equal((await loadReport(date))?.content, "default report");
    assert.equal((await loadReport(date, "alfa"))?.content, "alfa report");
    assert.equal((await loadReport(date, "beta"))?.content, "beta report");
    assert.equal((await listReports("alfa")).length, 1);
    assert.equal((await listReports("beta")).length, 1);
    assert.equal((await loadReport("2026-07-02", "alfa")), null);

    await assert.rejects(saveReport({ date, content: "bad", generatedAt: "" }, "../beta"));
    await assert.rejects(loadReport(date, "%2e%2e%2fbeta"));
    await assert.rejects(listReports("alfa/beta"));

    console.log("Daily insight report namespaces: 9 passed, 0 failed");
  } finally {
    fs.rmSync(scratchDir, { recursive: true, force: true });
    delete process.env.DAILY_INSIGHTS_DIR;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
