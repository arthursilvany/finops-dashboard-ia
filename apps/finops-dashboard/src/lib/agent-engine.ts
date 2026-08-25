import {
  createChatCompletion,
  getDeployment,
  getOpenAIClient,
  getTokenUsage,
} from "@/lib/openai-client";
import { executeQuery } from "@/lib/adx-client";
import { searchMicrosoftDocs } from "@/lib/microsoft-learn-client";
import {
  mcpPriceSearch,
  mcpPriceCompare,
  mcpRegionRecommend,
  mcpRiPricing,
  mcpBulkEstimate,
  mcpSkuDiscovery,
} from "@/lib/azure-pricing-mcp-client";
import {
  FINOPS_SYSTEM_PROMPT,
  TOOL_DEFINITIONS,
} from "@/lib/chat-system-prompt";
import { validateReadOnlyKql } from "@/lib/kql-guard";
import { hasCustomerDataset } from "@/lib/customer-dataset";
import {
  CUSTOMER_TOOL_DEFINITIONS,
  customerModeSystemPrompt,
  getCustomerDatasetInfoJson,
  getCustomerMetricJson,
} from "@/lib/customer-agent-tools";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const MAX_RESULT_ROWS = 200;

export async function handleExecuteKql(query: string): Promise<string> {
  const guard = validateReadOnlyKql(query);
  if (!guard.ok) {
    return JSON.stringify({ error: guard.reason });
  }

  try {
    const result = await executeQuery(query);
    const truncatedRows = result.rows.slice(0, MAX_RESULT_ROWS);
    return JSON.stringify({
      columns: result.columns,
      rows: truncatedRows,
      totalRows: result.rows.length,
      truncated: result.rows.length > MAX_RESULT_ROWS,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown query error";
    return JSON.stringify({ error: message });
  }
}

async function dispatchToolCall(
  name: string,
  args: Record<string, unknown>,
  customerSlug?: string | null,
): Promise<string> {
  switch (name) {
    case "execute_kql":
      // No ADX in customer POC mode; steer the agent to the dataset tools
      // instead of letting it retry a connection that cannot succeed.
      return hasCustomerDataset(customerSlug ?? undefined)
        ? JSON.stringify({
            error:
              "No ADX cluster in this session. Use get_customer_metric to read the ingested Cost Export.",
          })
        : handleExecuteKql(args.query as string);
    case "get_customer_dataset_info":
      return getCustomerDatasetInfoJson(customerSlug);
    case "get_customer_metric":
      return getCustomerMetricJson(args.metric as string, customerSlug);
    case "azure_price_search":
      return mcpPriceSearch(args);
    case "azure_price_compare":
      return mcpPriceCompare(
        args as unknown as Parameters<typeof mcpPriceCompare>[0],
      );
    case "azure_region_recommend":
      return mcpRegionRecommend(
        args as unknown as Parameters<typeof mcpRegionRecommend>[0],
      );
    case "azure_ri_pricing":
      return mcpRiPricing(
        args as unknown as Parameters<typeof mcpRiPricing>[0],
      );
    case "azure_bulk_estimate":
      return mcpBulkEstimate(
        args as unknown as Parameters<typeof mcpBulkEstimate>[0],
      );
    case "azure_sku_discovery":
      return mcpSkuDiscovery(
        args as unknown as Parameters<typeof mcpSkuDiscovery>[0],
      );
    case "search_microsoft_docs":
      return searchMicrosoftDocs(args.query as string);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

export async function runAgentWithTools(
  userPrompt: string,
  customerSlug?: string | null,
): Promise<{
  message: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    reasoning_tokens: number;
    total_tokens: number;
  };
}> {
  const client = getOpenAIClient();
  const deployment = getDeployment();

  const customerMode = hasCustomerDataset(customerSlug ?? undefined);
  const tools = customerMode
    ? [
        ...TOOL_DEFINITIONS.filter((t) => t.function.name !== "execute_kql"),
        ...CUSTOMER_TOOL_DEFINITIONS,
      ]
    : TOOL_DEFINITIONS;

  const apiMessages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: customerMode
        ? customerModeSystemPrompt(customerSlug)
        : FINOPS_SYSTEM_PROMPT,
    },
    { role: "user", content: userPrompt },
  ];

  const MAX_TOOL_ITERATIONS = 12;

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await createChatCompletion({
      model: deployment,
      messages: apiMessages,
      tools: tools as unknown as Parameters<
        typeof client.chat.completions.create
      >[0]["tools"],
      temperature: 0.3,
      max_tokens: 4096,
    });

    const choice = response.choices[0];

    if (choice.finish_reason === "tool_calls" && choice.message.tool_calls) {
      apiMessages.push({
        role: "assistant",
        content: choice.message.content || "",
        tool_calls: choice.message.tool_calls,
      });

      for (const toolCall of choice.message.tool_calls) {
        if (toolCall.type !== "function") continue;
        const args = JSON.parse(toolCall.function.arguments);
        const result = await dispatchToolCall(
          toolCall.function.name,
          args,
          customerSlug,
        );
        apiMessages.push({
          role: "tool",
          content: result,
          tool_call_id: toolCall.id,
        });
      }
      continue;
    }

    return {
      message: choice.message.content || "",
      usage: (() => {
        const u = getTokenUsage(response);
        return u
          ? {
              prompt_tokens: u.promptTokens,
              completion_tokens: u.completionTokens,
              reasoning_tokens: u.reasoningTokens,
              total_tokens: u.totalTokens,
            }
          : undefined;
      })(),
    };
  }

  return {
    message: "Error: maximum tool iteration count exceeded.",
  };
}
