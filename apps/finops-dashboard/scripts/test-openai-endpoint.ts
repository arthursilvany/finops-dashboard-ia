/**
 * Tests for Azure OpenAI endpoint surface detection.
 *
 * Run: `npm run openai:test`
 *
 * Azure OpenAI exposes two incompatible HTTP surfaces and the Foundry portal
 * hands out the newer one (`.../openai/v1`). Picking the wrong client for a
 * given endpoint produces a 404 on every AI call, so the detection is worth
 * pinning down.
 */
import { isV1Surface } from "../src/lib/openai-client";

let failures = 0;
let passes = 0;

function check(name: string, assertion: () => void) {
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

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

console.log("\nAzure OpenAI endpoint surface\n");

check("v1 surface is detected", () => {
  assert(
    isV1Surface("https://contoso-4196-resource.openai.azure.com/openai/v1"),
    "the endpoint copied from the Foundry portal must select the v1 client",
  );
});

check("v1 surface is detected with a trailing slash", () => {
  assert(
    isV1Surface("https://res.openai.azure.com/openai/v1/"),
    "a trailing slash must not change the surface",
  );
});

check("surrounding whitespace is ignored", () => {
  assert(
    isV1Surface("  https://res.openai.azure.com/openai/v1  "),
    "values pasted into env files often carry whitespace",
  );
});

check("classic endpoint is not treated as v1", () => {
  assert(
    !isV1Surface("https://res.openai.azure.com"),
    "the classic surface must keep using AzureOpenAI",
  );
});

check("cognitiveservices host is not treated as v1", () => {
  assert(
    !isV1Surface("https://res.cognitiveservices.azure.com"),
    "AIServices resources also expose the classic surface",
  );
});

check("a deeper path that merely contains /openai/v1 is not v1", () => {
  assert(
    !isV1Surface("https://res.openai.azure.com/openai/v1/chat/completions"),
    "the base URL must end at /openai/v1, otherwise the SDK would double the path",
  );
});

check("/openai alone is not v1", () => {
  assert(
    !isV1Surface("https://res.openai.azure.com/openai"),
    "only the versioned path selects the OpenAI-compatible client",
  );
});

console.log(
  `\n${failures === 0 ? "✓" : "✗"} openai: ${passes} passed, ${failures} failed\n`,
);

process.exit(failures === 0 ? 0 : 1);
