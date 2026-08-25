import { DefaultAzureCredential } from "@azure/identity";
import OpenAI, { AzureOpenAI } from "openai";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";

let client: OpenAI | undefined;
let cachedToken: { token: string; expiresOn: number } | undefined;

const OPENAI_SCOPE = "https://cognitiveservices.azure.com/.default";

/**
 * The Foundry resource frequently lives in a different tenant from the one
 * DefaultAzureCredential picks by default (a sandbox/personal tenant versus the
 * corporate one). Without an explicit tenant the token is issued for the wrong
 * tenant and every call fails with "Token tenant does not match resource
 * tenant" — an error that reads like a permissions problem but is not.
 */
function getTenantId(): string | undefined {
  return (
    process.env.AZURE_OPENAI_TENANT_ID?.trim() ||
    process.env.AZURE_TENANT_ID?.trim() ||
    undefined
  );
}

let credential: DefaultAzureCredential | undefined;

function getCredential(): DefaultAzureCredential {
  if (!credential) {
    const tenantId = getTenantId();
    credential = new DefaultAzureCredential(tenantId ? { tenantId } : {});
  }
  return credential;
}

async function getAzureToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresOn - now > 60_000) {
    return cachedToken.token;
  }
  const result = await getCredential().getToken(OPENAI_SCOPE);
  cachedToken = { token: result.token, expiresOn: result.expiresOnTimestamp };
  return result.token;
}

/**
 * Azure OpenAI exposes two different HTTP surfaces, and the portal hands out
 * the newer one:
 *
 * - classic: `https://<res>.openai.azure.com`, where the SDK appends
 *   `/openai/deployments/<deployment>/chat/completions?api-version=…`
 * - v1:      `https://<res>.openai.azure.com/openai/v1`, an OpenAI-compatible
 *   surface where the deployment goes in the `model` field and no
 *   `api-version` is sent.
 *
 * `AzureOpenAI` only speaks the classic dialect: it always injects
 * `api-version` and prepends `/deployments/<model>` unless the base URL already
 * contains `/deployments`. Pointing it at the v1 URL therefore produces
 * `…/openai/v1/deployments/gpt-4o/chat/completions?api-version=…` and a 404.
 *
 * So detect the surface from the configured endpoint instead of asking the
 * operator to hand-edit a value they copied from the Foundry portal.
 */
export function isV1Surface(endpoint: string): boolean {
  return /\/openai\/v1\/?$/i.test(endpoint.trim());
}

/** Trailing slashes break path joining in the SDK's URL builder. */
function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "");
}

export function getOpenAIClient(): OpenAI {
  if (!client) {
    const raw = process.env.AZURE_OPENAI_ENDPOINT;
    if (!raw) {
      throw new Error("AZURE_OPENAI_ENDPOINT is not configured");
    }
    const endpoint = normalizeEndpoint(raw);

    client = isV1Surface(endpoint)
      ? new OpenAI({ baseURL: endpoint, apiKey: getAzureToken })
      : new AzureOpenAI({
          endpoint,
          apiVersion: process.env.AZURE_OPENAI_API_VERSION || "2025-04-01-preview",
          azureADTokenProvider: getAzureToken,
        });
  }
  return client;
}

export function getDeployment(): string {
  return process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4o";
}

/**
 * Deployment for structured, deterministic work (fixed-schema JSON extraction,
 * classification) where a hidden chain of thought buys nothing.
 *
 * Measured on this deployment with one identical JSON-extraction prompt:
 *
 *   gpt-4o direct        148 total tokens
 *   model-router -> grok 579 total tokens
 *   model-router -> gpt-5 1491 total tokens
 *
 * So the same answer costs 4-10x more purely because the router picked a
 * reasoning model. `reasoning_effort` does not fix this: measured through the
 * router, minimal/low/medium/high all produced ~380-397 reasoning tokens, i.e.
 * the parameter is accepted but has no effect. Choosing the model per task is
 * the lever that actually works.
 *
 * Unset by default, so behaviour does not change until it is configured.
 */
export function getFastDeployment(): string {
  return process.env.AZURE_OPENAI_DEPLOYMENT_FAST || getDeployment();
}

/**
 * Extra output-token budget reserved for a reasoning model's hidden chain of
 * thought.
 *
 * Azure's model router can dispatch a request to a reasoning model. Measured on
 * this deployment, those models behave in two *different* ways:
 *
 * - `gpt-5` family: `max_completion_tokens` caps reasoning **and** visible
 *   output together, and reasoning runs first. A 400-token budget produced
 *   `finish_reason: "length"` with an empty string — a success-shaped response
 *   with no content.
 * - `grok-*-reasoning`: the budget caps only the visible output; reasoning runs
 *   outside it. The same 400-token budget succeeded.
 *
 * Because routing is chosen per prompt and can change, the budget has to be
 * sized for the worst of the two. Unused budget is not billed, so headroom is
 * free insurance; being short is not.
 */
export const REASONING_HEADROOM_TOKENS = 3000;

/**
 * Reasoning cost grows with prompt complexity (measured: ~400 tokens for a short
 * extraction, 2176 for a long report). A flat headroom therefore protects small
 * prompts well and large ones poorly, so the reservation also scales with the
 * answer the caller asked for.
 */
function headroomFor(visibleBudget: number): number {
  return Math.max(REASONING_HEADROOM_TOKENS, Math.ceil(visibleBudget * 0.75));
}

/**
 * Sampling parameters that some reasoning models reject outright. Listed so the
 * retry below strips exactly these and nothing else.
 */
const SAMPLING_PARAMS = [
  "temperature",
  "top_p",
  "presence_penalty",
  "frequency_penalty",
] as const;

function isUnsupportedParamError(err: unknown): boolean {
  const e = err as { status?: number; message?: string; code?: string };
  if (e?.status !== 400) return false;
  const msg = `${e.message ?? ""} ${e.code ?? ""}`.toLowerCase();
  return (
    msg.includes("unsupported") ||
    msg.includes("not supported") ||
    msg.includes("unrecognized")
  );
}

type ChatParams = ChatCompletionCreateParamsNonStreaming & {
  max_completion_tokens?: number | null;
};

/**
 * Creates a chat completion that is safe to run against a model-router
 * deployment.
 *
 * Callers state the budget they need for the *visible* answer via `max_tokens`
 * (or `max_completion_tokens`); this adds the reasoning headroom and sends it as
 * `max_completion_tokens`, which is the parameter reasoning models accept —
 * `max_tokens` is rejected by some of them.
 *
 * Every AI feature in the dashboard must go through here. Calling
 * `client.chat.completions.create` directly reintroduces the empty-response bug
 * as soon as the router picks a reasoning model.
 */
export async function createChatCompletion(
  params: ChatParams,
  options?: { timeout?: number },
): Promise<ChatCompletion> {
  const openai = getOpenAIClient();

  const { max_tokens, max_completion_tokens, ...rest } = params;
  const visibleBudget = max_completion_tokens ?? max_tokens ?? 1024;

  const send = async (budget: number): Promise<ChatCompletion> => {
    const body: ChatCompletionCreateParamsNonStreaming = {
      ...rest,
      max_completion_tokens: budget,
    };

    try {
      return await openai.chat.completions.create(body, options);
    } catch (err) {
      if (!isUnsupportedParamError(err)) throw err;

      // A reasoning model refused a sampling parameter. Drop those and retry
      // once rather than losing the feature over a knob we do not depend on.
      const retry: ChatCompletionCreateParamsNonStreaming = { ...body };
      let stripped = false;
      for (const key of SAMPLING_PARAMS) {
        if (retry[key] !== undefined && retry[key] !== null) {
          delete retry[key];
          stripped = true;
        }
      }
      if (!stripped) throw err;

      return await openai.chat.completions.create(retry, options);
    }
  };

  const first = await send(visibleBudget + headroomFor(visibleBudget));

  // Reasoning cost is not knowable in advance and varies run to run, so a
  // budget that normally suffices can still come up short. Retrying once with a
  // much larger budget turns a blank panel into a slower answer, which is the
  // trade we want in front of a customer. Unused budget is not billed.
  if (first.choices[0]?.finish_reason === "length") {
    console.warn(
      "[openai] response hit the token ceiling" +
        ` (model=${first.model}, reasoning=${first.usage?.completion_tokens_details?.reasoning_tokens ?? 0});` +
        " retrying once with a larger budget",
    );
    const retried = await send((visibleBudget + headroomFor(visibleBudget)) * 3);
    return retried;
  }

  return first;
}

/**
 * True when the model produced no visible text because it exhausted its budget
 * while reasoning. Callers must treat this as a failure rather than as an empty
 * answer, so the UI states the analysis is unavailable instead of rendering a
 * blank panel.
 */
export function isTruncatedByReasoning(response: ChatCompletion): boolean {
  const choice = response.choices[0];
  return choice?.finish_reason === "length" && !choice?.message?.content?.trim();
}

export type TokenUsage = {
  /** Input tokens. */
  promptTokens: number;
  /** Visible output tokens only. */
  completionTokens: number;
  /** Hidden chain-of-thought tokens. Billed as output, invisible to the user. */
  reasoningTokens: number;
  /** Authoritative billed total. Always use this for cost reporting. */
  totalTokens: number;
};

/**
 * Normalizes token usage across models.
 *
 * Models behind the same router disagree on whether `completion_tokens`
 * includes `reasoning_tokens`. Measured on this deployment, same prompt:
 *
 *   gpt-5   prompt=58 completion=1433 reasoning=1216 total=1491
 *           -> 58 + 1433 = 1491, so completion INCLUDES reasoning
 *   grok    prompt=60 completion=102  reasoning=417  total=579
 *           -> 60 + 102 + 417 = 579, so completion EXCLUDES reasoning
 *
 * Reporting `completion_tokens` verbatim therefore under-states real usage by
 * roughly 4x on grok while being correct on gpt-5. `total_tokens` is the only
 * field that means the same thing everywhere, so it is what cost figures must
 * be based on.
 */
export function getTokenUsage(response: ChatCompletion): TokenUsage | undefined {
  const u = response.usage;
  if (!u) return undefined;

  const promptTokens = u.prompt_tokens ?? 0;
  const rawCompletion = u.completion_tokens ?? 0;
  const reasoningTokens = u.completion_tokens_details?.reasoning_tokens ?? 0;
  const totalTokens = u.total_tokens ?? promptTokens + rawCompletion + reasoningTokens;

  // When prompt + completion already reconciles with the total, the reasoning
  // tokens are inside completion and must be subtracted to get visible output.
  const completionIncludesReasoning = promptTokens + rawCompletion === totalTokens;
  const completionTokens = completionIncludesReasoning
    ? Math.max(rawCompletion - reasoningTokens, 0)
    : rawCompletion;

  return { promptTokens, completionTokens, reasoningTokens, totalTokens };
}
