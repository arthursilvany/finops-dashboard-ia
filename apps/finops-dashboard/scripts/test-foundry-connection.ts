/**
 * Live integration check against the configured Azure AI Foundry deployment.
 *
 * Run with:  npx tsx scripts/test-foundry-connection.ts
 *
 * This talks to the real endpoint and costs a few cents. It exists because the
 * failure modes it covers are all silent: a wrong tenant looks like an RBAC
 * problem, and a reasoning model that overruns its budget returns HTTP 200 with
 * an empty string rather than an error.
 */
import * as fs from "fs";
import * as path from "path";

// Next.js loads .env.local automatically; a standalone script does not.
function loadEnvLocal() {
  const file = path.resolve(__dirname, "..", ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnvLocal();

/* eslint-disable @typescript-eslint/no-var-requires */
const {
  createChatCompletion,
  getDeployment,
  isTruncatedByReasoning,
  REASONING_HEADROOM_TOKENS,
} = require("../src/lib/openai-client") as typeof import("../src/lib/openai-client");

let failures = 0;

async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${name}: ${(err as Error).message}`);
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main() {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const deployment = getDeployment();
  console.log(`Foundry endpoint : ${endpoint}`);
  console.log(`Deployment       : ${deployment}`);
  console.log(
    `Tenant override  : ${process.env.AZURE_OPENAI_TENANT_ID || process.env.AZURE_TENANT_ID || "(none)"}`,
  );
  console.log(`Reasoning headroom: ${REASONING_HEADROOM_TOKENS} tokens\n`);

  assert(endpoint, "AZURE_OPENAI_ENDPOINT is not set");

  await check("authenticates and returns content", async () => {
    const res = await createChatCompletion({
      model: deployment,
      messages: [{ role: "user", content: "Reply with the single word OK." }],
      max_tokens: 32,
    });
    const content = res.choices[0]?.message?.content ?? "";
    assert(content.trim().length > 0, "empty content");
    console.log(`        routed to ${res.model}`);
  });

  // This is the exact call shape that returned an empty string before the
  // headroom fix, when the router selected a reasoning model.
  await check("small json request still returns parseable JSON", async () => {
    const res = await createChatCompletion(
      {
        model: deployment,
        messages: [
          {
            role: "user",
            content:
              'Return JSON with keys "downtimeRisk" (string) and "confidence" (number 0-1). ' +
              "Recommendation: enable zone redundancy on a production SQL database.",
          },
        ],
        temperature: 0.3,
        max_tokens: 400,
        response_format: { type: "json_object" },
      },
      { timeout: 45_000 },
    );
    assert(
      !isTruncatedByReasoning(res),
      "truncated by reasoning — headroom is too small",
    );
    const raw = res.choices[0]?.message?.content ?? "";
    assert(raw.trim().length > 0, "empty content");
    const parsed = JSON.parse(raw);
    assert("downtimeRisk" in parsed, "missing downtimeRisk key");
    const reasoning =
      res.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
    console.log(
      `        routed to ${res.model}, ${reasoning} reasoning tokens, ${raw.length} chars of content`,
    );
  });

  // The chat agent and the agentic FinOps engine both depend on tool calling.
  await check("tool calling survives model routing", async () => {
    const res = await createChatCompletion({
      model: deployment,
      messages: [
        {
          role: "user",
          content: "What is the total Azure cost for last month? Use the tool.",
        },
      ],
      temperature: 0.3,
      max_tokens: 1024,
      tools: [
        {
          type: "function",
          function: {
            name: "get_total_cost",
            description: "Returns the total Azure cost for a period",
            parameters: {
              type: "object",
              properties: { period: { type: "string" } },
              required: ["period"],
            },
          },
        },
      ],
    });
    const calls = res.choices[0]?.message?.tool_calls ?? [];
    assert(calls.length > 0, "model did not call the tool");
    console.log(
      `        routed to ${res.model}, called ${calls.map((c) => ("function" in c ? c.function.name : c.type)).join(", ")}`,
    );
  });

  // Daily insights asks for a long Markdown report. This is the call site with
  // the largest visible output, so it is the one most likely to truncate.
  await check("long Markdown report is not truncated", async () => {
    const res = await createChatCompletion(
      {
        model: deployment,
        messages: [
          {
            role: "system",
            content:
              "You are a FinOps analyst. Generate professionally formatted Markdown reports from the provided data. Be precise with numbers, use consistent formatting, and write in executive English.",
          },
          {
            role: "user",
            content:
              "Write a daily Azure FinOps report in Markdown with these sections: " +
              "Executive Summary, Cost by Service, Anomalies, Reservation Coverage, " +
              "Tag Governance and Recommended Actions. Data: total spend 797.81 USD; " +
              "top services Virtual Machines 412.30, Storage 190.11, Azure OpenAI 95.402; " +
              "commitment utilization 12.7%; tag compliance 0.9%; 5 business units. " +
              "Be thorough and use tables.",
          },
        ],
        temperature: 0.3,
        max_tokens: 4096,
      },
      { timeout: 120_000 },
    );
    assert(
      !isTruncatedByReasoning(res),
      "truncated by reasoning before emitting any text",
    );
    const content = res.choices[0]?.message?.content ?? "";
    assert(content.trim().length > 0, "empty report");
    assert(
      res.choices[0]?.finish_reason !== "length",
      `report was cut off mid-way (finish_reason=length, ${content.length} chars) — raise the budget`,
    );
    const reasoning =
      res.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
    console.log(
      `        routed to ${res.model}, ${reasoning} reasoning tokens, ` +
        `${res.usage?.completion_tokens} completion tokens, ${content.length} chars`,
    );
  });

  console.log(
    failures === 0
      ? "\nAll Foundry checks passed."
      : `\n${failures} Foundry check(s) failed.`,
  );  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nFATAL:", err.message || err);
  process.exit(1);
});
