export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { executeQuery } from "@/lib/adx-client";
import {
  createChatCompletion,
  getDeployment,
  getTokenUsage,
  isTruncatedByReasoning,
} from "@/lib/openai-client";
import { saveReport, loadReport } from "@/lib/daily-insights-store";
import { searchMicrosoftDocs } from "@/lib/microsoft-learn-client";
import { customerSectionResults, customerPeriodLabel } from "@/lib/customer-agent-tools";
import {
  customerSlugFromCookieHeader,
  resolveActiveCustomerSlug,
} from "@/lib/customer-data/workspace";

const SECTION_QUERIES = {
  topCosts: `let startDate=startofmonth(ago(30d)); let endDate=startofmonth(now()); Costs() | where ChargePeriodStart >= startDate and ChargePeriodStart < endDate | summarize TotalCost=sum(EffectiveCost) by ServiceName | top 5 by TotalCost desc`,
  totalCost: `let startDate=startofmonth(ago(30d)); let endDate=startofmonth(now()); Costs() | where ChargePeriodStart >= startDate and ChargePeriodStart < endDate | summarize Total=sum(EffectiveCost)`,
  anomalies: `let startDate=ago(30d); let endDate=now(); Costs() | where ChargePeriodStart >= startDate and ChargePeriodStart < endDate | summarize DailyCost=sum(EffectiveCost) by bin(ChargePeriodStart,1d) | make-series CostSeries=sum(DailyCost) on ChargePeriodStart from startDate to endDate step 1d | extend anomalies=series_decompose_anomalies(CostSeries) | mv-expand ChargePeriodStart to typeof(datetime), CostSeries to typeof(double), anomalies to typeof(double) | where anomalies != 0`,
  budget: `let startDate=startofmonth(now()); let endDate=now(); Costs() | where ChargePeriodStart >= startDate and ChargePeriodStart < endDate | summarize MonthToDateCost=sum(EffectiveCost)`,
  savings: `let startDate=startofmonth(ago(30d)); let endDate=startofmonth(now()); Costs() | where ChargePeriodStart >= startDate and ChargePeriodStart < endDate | where not(ChargeCategory=='Purchase' and isnotempty(CommitmentDiscountCategory)) | extend TotalSavings=iff(ListCost<EffectiveCost,0.0,toreal(ListCost-EffectiveCost)) | summarize TotalSavings=sum(TotalSavings) by ServiceName | top 5 by TotalSavings desc`,
};

async function runQuery(
  label: string,
  kql: string,
): Promise<{ label: string; data: unknown; error?: string }> {
  try {
    const result = await executeQuery(kql);
    return {
      label,
      data: { columns: result.columns, rows: result.rows.slice(0, 50) },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Query failed";
    return { label, data: null, error: msg };
  }
}

function buildPrompt(
  queryResults: Record<string, { data: unknown; error?: string }>,
  wafGuidance: string,
  customerPeriod?: string,
): string {
  const today = new Date().toISOString().slice(0, 10);
  const budget = 10000;
  const monthStart = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1,
  );
  const daysElapsed = Math.max(
    1,
    Math.floor((Date.now() - monthStart.getTime()) / 86400000),
  );
  const daysInMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth() + 1,
    0,
  ).getDate();

  return `Generate a daily FinOps executive report in Markdown based on the data below (already queried from ADX).
Data: ${today} | Monthly budget: USD ${budget.toLocaleString()} | Days in month: ${daysInMonth} | Elapsed days: ${daysElapsed}
${
  customerPeriod
    ? `
IMPORTANT — this run reads an ingested Azure Cost Export, NOT a live cluster.
The data is a historical snapshot covering ${customerPeriod}. All figures below
refer to the last complete month in that snapshot, not to today. Date the report
by that period, never by today's date, and never annualise or extrapolate to the
current month. Use only the numbers given; do not compute or invent any figure
that is not present.
`
    : ""
}
## Pre-queried data

### Top 5 Costs by Service (last 30 days):
${JSON.stringify(queryResults.topCosts.data, null, 2)}
${queryResults.topCosts.error ? `ERROR: ${queryResults.topCosts.error}` : ""}

### Total Cost (last 30 days):
${JSON.stringify(queryResults.totalCost.data, null, 2)}
${queryResults.totalCost.error ? `ERROR: ${queryResults.totalCost.error}` : ""}

### Detected Anomalies:
${JSON.stringify(queryResults.anomalies.data, null, 2)}
${queryResults.anomalies.error ? `ERROR: ${queryResults.anomalies.error}` : ""}

### Current Month Spend (Month-to-Date):
${JSON.stringify(queryResults.budget.data, null, 2)}
${queryResults.budget.error ? `ERROR: ${queryResults.budget.error}` : ""}

### Top 5 Savings Opportunities:
${JSON.stringify(queryResults.savings.data, null, 2)}
${queryResults.savings.error ? `ERROR: ${queryResults.savings.error}` : ""}

## Formatting instructions

Generate the report in Markdown with this EXACT structure:

# 📊 Daily FinOps Report — ${customerPeriod ? "use the last complete month of the snapshot as the report date" : today}

## 💰 Top 5 Services by Cost
Markdown table with columns: Service | Cost (USD) | % of Total
Calculate % based on total cost. Format values with 2 decimals and thousands separator.

## 🔍 Cost Anomalies
If anomaly data exists, list the top 3 with date, value, and deviation.
If there are no anomalies (empty or null result), write: "✅ No statistically significant anomalies detected in the last 30 days."

## 📈 Budget Tracking
${
  customerPeriod
    ? `Do NOT produce any budget figure. An Azure Cost Export contains no budget.
Write exactly: "ℹ️ Budget tracking is not available from a Cost Export — it requires Azure Cost Management." Then show the month-over-month actual spend from the Total Cost data above.`
    : `Use the MTD data and the budget of USD ${budget.toLocaleString()}.
Calculate: daily burn rate = MTD / elapsed days; projection = burn rate × days in month; % used = MTD / budget × 100.
Markdown table with: Metric | Value
Add status: ✅ if projection < budget, ⚠️ if projection is between 90-100%, 🔴 if projection > budget.`
}

## 💡 Savings Opportunities
Markdown table with: Service | Estimated Savings (USD) | Recommendation
For each service with savings, suggest an action (for example: Reservations, VMSS scaling, etc.).

## 💡 Optimization Tips (WAF Cost Pillar)
Based on the Azure Well-Architected Framework best practices below, list 3 to 5 cost optimization tips for the highest-spend services identified in this report. Each tip must mention the specific service and the estimated impact in % or $.

Guidance WAF (Microsoft Learn):
${wafGuidance || "Use general WAF cost best practices: reservations, rightsizing, Hybrid Benefit, autoscaling."}

### 📖 WAF References
${wafGuidance ? "List the links returned by the guidance above here (Microsoft Learn URLs)." : "_WAF references not available in this execution._"}

---
*Report automatically generated via Azure OpenAI + ${customerPeriod ? "ingested Cost Export" : "ADX"} at ${new Date().toISOString().slice(11, 16)} UTC*`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const forceRegenerate = body.force === true;
    const today = new Date().toISOString().slice(0, 10);
    const requestSlug = customerSlugFromCookieHeader(
      request.headers.get("cookie"),
    );
    const customerSections = customerSectionResults(requestSlug);
    const customerSlug = customerSections
      ? resolveActiveCustomerSlug(requestSlug)
      : undefined;

    if (!forceRegenerate) {
      const existing = await loadReport(today, customerSlug);
      if (existing) {
        return NextResponse.json({ report: existing, cached: true });
      }
    }

    const queryResults: Record<string, { data: unknown; error?: string }> = {};

    if (customerSections) {
      Object.assign(queryResults, customerSections);
    } else {
      const results = await Promise.all([
        runQuery("topCosts", SECTION_QUERIES.topCosts),
        runQuery("totalCost", SECTION_QUERIES.totalCost),
        runQuery("anomalies", SECTION_QUERIES.anomalies),
        runQuery("budget", SECTION_QUERIES.budget),
        runQuery("savings", SECTION_QUERIES.savings),
      ]);
      for (const r of results) {
        queryResults[r.label] = { data: r.data, error: r.error };
      }
    }

    // Extract top service name for WAF search
    let wafGuidance = "";
    try {
      const topCostsData = queryResults.topCosts.data as
        | { rows?: unknown[][] }
        | null
        | undefined;
      const topService = topCostsData?.rows?.[0]?.[0];
      const searchQuery =
        typeof topService === "string" && topService
          ? `Azure Well-Architected Framework cost optimization ${topService}`
          : "Azure Well-Architected Framework cost optimization";
      wafGuidance = await searchMicrosoftDocs(searchQuery);
    } catch {
      // WAF guidance is best-effort — report still generates without it
    }

    const prompt = buildPrompt(
      queryResults,
      wafGuidance,
      customerSections ? customerPeriodLabel(customerSlug) : undefined,
    );
    const deployment = getDeployment();

    const response = await createChatCompletion({
      model: deployment,
      messages: [
        {
          role: "system",
          content:
            "You are a FinOps analyst. Generate professionally formatted Markdown reports from the provided data. Be precise with numbers, use consistent formatting, and write in executive English.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 4096,
    });

    if (isTruncatedByReasoning(response)) {
      return NextResponse.json(
        {
          error:
            "The model exhausted its token budget while reasoning and returned no report. Retry, or raise the budget for this prompt.",
        },
        { status: 502 },
      );
    }

    const raw =
      response.choices[0]?.message?.content || "Failed to generate report.";
    const content = raw
      .replace(/^```(?:markdown)?\s*\n?/, "")
      .replace(/\n?```\s*$/, "");

    const usage = getTokenUsage(response);
    const report = {
      date: today,
      content,
      generatedAt: new Date().toISOString(),
      tokens: usage
        ? {
            prompt: usage.promptTokens,
            completion: usage.completionTokens,
            reasoning: usage.reasoningTokens,
            total: usage.totalTokens,
          }
        : undefined,
    };

    await saveReport(report, customerSlug);

    return NextResponse.json({ report, cached: false });
  } catch (err: unknown) {
    console.error("Daily insights generation error:", err);
    const message = err instanceof Error ? err.message : "Generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
