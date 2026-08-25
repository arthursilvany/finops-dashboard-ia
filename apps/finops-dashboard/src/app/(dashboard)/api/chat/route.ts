import { NextRequest, NextResponse } from "next/server";
import {
  createChatCompletion,
  getDeployment,
  getOpenAIClient,
  getTokenUsage,
} from "@/lib/openai-client";
import { executeQuery } from "@/lib/adx-client";
import {
  FINOPS_SYSTEM_PROMPT,
  TOOL_DEFINITIONS,
} from "@/lib/chat-system-prompt";
import { validateReadOnlyKql } from "@/lib/kql-guard";
import { hasCustomerDataset } from "@/lib/customer-dataset";
import { customerSlugFromCookieHeader } from "@/lib/customer-data/workspace";
import {
  CUSTOMER_TOOL_DEFINITIONS,
  customerModeSystemPrompt,
  getCustomerDatasetInfoJson,
  getCustomerMetricJson,
} from "@/lib/customer-agent-tools";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const MAX_RESULT_ROWS = 200;

async function handleExecuteKql(query: string): Promise<string> {
  const guard = validateReadOnlyKql(query);
  if (!guard.ok) {
    return JSON.stringify({ error: guard.reason });
  }

  try {
    const result = await executeQuery(query);
    const truncatedRows = result.rows.slice(0, MAX_RESULT_ROWS);
    const response = {
      columns: result.columns,
      rows: truncatedRows,
      totalRows: result.rows.length,
      truncated: result.rows.length > MAX_RESULT_ROWS,
    };
    return JSON.stringify(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown query error";
    return JSON.stringify({ error: message });
  }
}

async function handleGetAzureRetailPrices(params: {
  serviceName: string;
  armSkuName?: string;
  armRegionName?: string;
  currencyCode?: string;
  priceType?: string;
}): Promise<string> {
  const filters: string[] = [];
  filters.push(`serviceName eq '${params.serviceName}'`);

  if (params.armSkuName) {
    filters.push(`armSkuName eq '${params.armSkuName}'`);
  }
  if (params.armRegionName) {
    filters.push(`armRegionName eq '${params.armRegionName}'`);
  } else {
    filters.push(`armRegionName eq 'brazilsouth'`);
  }
  if (params.priceType) {
    filters.push(`priceType eq '${params.priceType}'`);
  }

  const currency = params.currencyCode || "USD";
  const filterStr = encodeURIComponent(filters.join(" and "));
  const url = `https://prices.azure.com/api/retail/prices?currencyCode=${currency}&$filter=${filterStr}&$top=20`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      return JSON.stringify({ error: `Prices API returned ${res.status}` });
    }
    const data = await res.json();
    const items = (data.Items || [])
      .slice(0, 20)
      .map((item: Record<string, unknown>) => ({
        skuName: item.skuName,
        armSkuName: item.armSkuName,
        retailPrice: item.retailPrice,
        unitPrice: item.unitPrice,
        unitOfMeasure: item.unitOfMeasure,
        productName: item.productName,
        meterName: item.meterName,
        priceType: item.type,
        reservationTerm: item.reservationTerm,
        currencyCode: item.currencyCode,
      }));
    return JSON.stringify({ items, totalCount: data.Items?.length || 0 });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unknown pricing error";
    return JSON.stringify({ error: message });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const messages: ChatMessage[] = body.messages;

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "messages array is required" },
        { status: 400 },
      );
    }

    const client = getOpenAIClient();
    const deployment = getDeployment();

    // With a customer export loaded there is no ADX, so the agent gets the
    // dataset tools and is told not to reach for KQL.
    const customerSlug = customerSlugFromCookieHeader(
      request.headers.get("cookie"),
    );
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
      ...messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    let iterationCount = 0;
    const MAX_TOOL_ITERATIONS = 8;

    while (iterationCount < MAX_TOOL_ITERATIONS) {
      iterationCount++;

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
        // Add the assistant's message with tool calls
        apiMessages.push({
          role: "assistant",
          content: choice.message.content || "",
          tool_calls: choice.message.tool_calls,
        });

        for (const toolCall of choice.message.tool_calls) {
          if (toolCall.type !== "function") continue;
          const args = JSON.parse(toolCall.function.arguments);
          let result: string;

          switch (toolCall.function.name) {
            case "execute_kql":
              result = customerMode
                ? JSON.stringify({
                    error:
                      "No ADX cluster in this session. Use get_customer_metric to read the ingested Cost Export.",
                  })
                : await handleExecuteKql(args.query);
              break;
            case "get_customer_dataset_info":
              result = getCustomerDatasetInfoJson(customerSlug);
              break;
            case "get_customer_metric":
              result = getCustomerMetricJson(args.metric, customerSlug);
              break;
            case "get_azure_retail_prices":
              result = await handleGetAzureRetailPrices(args);
              break;
            default:
              result = JSON.stringify({
                error: `Unknown tool: ${toolCall.function.name}`,
              });
          }

          apiMessages.push({
            role: "tool",
            content: result,
            tool_call_id: toolCall.id,
          });
        }

        continue;
      }

      // No more tool calls — return the final text
      return NextResponse.json({
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
      });
    }

    // Safety: exceeded max iterations
    return NextResponse.json({
      message:
        "Sorry, the request required too many iterations. Try simplifying the question.",
    });
  } catch (err: unknown) {
    console.error("Chat API error:", err);
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
