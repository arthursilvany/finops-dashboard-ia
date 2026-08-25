/**
 * Agent tools for customer POC mode.
 *
 * The chat agent is built around `execute_kql` against a FinOps Hub. In
 * customer POC mode there is no ADX cluster — the data is an ingested Cost
 * Export held in memory — so every tool call failed with "ADX cluster URI is
 * not configured" and the assistant could not answer a single question about
 * the customer's own spend. It correctly refused to invent numbers, but the
 * feature was unusable in exactly the mode used in front of a customer.
 *
 * Rather than interpret KQL over the rows, this exposes the aggregators the
 * dashboard panels already use. The agent therefore reads the same figures the
 * charts show, so a number it quotes can always be pointed at on screen.
 */
import { filterSchema } from "@/lib/filter-schema";
import { getAggregationContext } from "@/lib/customer-aggregations/context";
import type { AggregationContext } from "@/lib/customer-aggregations/context";
import {
  aggregateCostByService,
  aggregateCostBySubscription,
  aggregateCostOverTime,
  aggregateCostSummaryKpi,
  aggregateDailyCost,
  aggregateKpiSummary,
  aggregatePricingModel,
  aggregateServiceTrend,
} from "@/lib/customer-aggregations/cost-summary";
import {
  aggregateGovernanceKpi,
  aggregateTagCompliance,
} from "@/lib/customer-aggregations/governance";
import {
  aggregateAnomalySummary,
  aggregateAnomalyTimeline,
} from "@/lib/customer-aggregations/anomalies";
import {
  aggregateCommitmentGap,
  aggregateEsrSummary,
  aggregateIdleResources,
  aggregateOptimizationActions,
  aggregateSavingsSummary,
} from "@/lib/customer-aggregations/rate-optimization";
import {
  aggregateChargebackByBu,
  aggregateChargebackKpi,
} from "@/lib/customer-aggregations/chargeback";

/** Metric name -> the aggregator that answers it. */
const METRICS: Record<string, (ctx: AggregationContext) => unknown> = {
  monthly_kpi: aggregateKpiSummary,
  cost_last_30d: aggregateCostSummaryKpi,
  cost_by_service: (ctx) => aggregateCostByService(ctx, 15),
  cost_by_subscription: aggregateCostBySubscription,
  cost_by_month: (ctx) => aggregateCostOverTime(ctx, 12),
  cost_daily: (ctx) => aggregateDailyCost(ctx, 30),
  pricing_model: aggregatePricingModel,
  service_trend: aggregateServiceTrend,
  tag_governance: aggregateGovernanceKpi,
  tag_compliance_by_subscription: aggregateTagCompliance,
  anomaly_summary: aggregateAnomalySummary,
  anomaly_timeline: aggregateAnomalyTimeline,
  savings_summary: aggregateSavingsSummary,
  effective_savings_rate: aggregateEsrSummary,
  commitment_gap: aggregateCommitmentGap,
  idle_resources: aggregateIdleResources,
  optimization_actions: aggregateOptimizationActions,
  chargeback_kpi: aggregateChargebackKpi,
  chargeback_by_business_unit: aggregateChargebackByBu,
};

export const CUSTOMER_METRICS = Object.keys(METRICS);

export const CUSTOMER_TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "get_customer_dataset_info",
      description:
        "Returns the customer name, billing period, row count and currency of the ingested Cost Export. Call this first to know which period the data covers, because the export is a historical snapshot and is usually not the current month.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_customer_metric",
      description:
        "Reads a precomputed metric from the customer's ingested Cost Export. This is the ONLY source of the customer's cost data in this mode — there is no ADX cluster, so execute_kql will fail. Returns exactly the figures shown on the dashboard panels.",
      parameters: {
        type: "object",
        properties: {
          metric: {
            type: "string",
            enum: CUSTOMER_METRICS,
            description: "Which metric to read.",
          },
        },
        required: ["metric"],
      },
    },
  },
] as const;

export function getCustomerDatasetInfoJson(
  customerSlug?: string | null,
): string {
  const ctx = getAggregationContext(filterSchema.parse({}), customerSlug);
  if (!ctx) return JSON.stringify({ error: "No customer dataset is loaded." });

  return JSON.stringify({
    customer: ctx.manifest.customer,
    format: ctx.manifest.format,
    rowCount: ctx.manifest.rowCount,
    periodStart: ctx.manifest.periodStart,
    periodEnd: ctx.manifest.periodEnd,
    currencies: ctx.manifest.currencies,
    // Relative windows ("last 30 days") are measured from here, not from today.
    anchorDate: ctx.anchor,
    warnings: ctx.manifest.warnings,
  });
}

export function getCustomerMetricJson(
  metric: string,
  customerSlug?: string | null,
): string {
  const aggregate = METRICS[metric];
  if (!aggregate) {
    return JSON.stringify({
      error: `Unknown metric "${metric}".`,
      available: CUSTOMER_METRICS,
    });
  }

  const ctx = getAggregationContext(filterSchema.parse({}), customerSlug);
  if (!ctx) return JSON.stringify({ error: "No customer dataset is loaded." });

  return JSON.stringify({
    metric,
    customer: ctx.manifest.customer,
    period: { start: ctx.manifest.periodStart, end: ctx.manifest.periodEnd },
    currency: ctx.manifest.currencies[0] ?? "USD",
    data: aggregate(ctx),
  });
}

export function customerPeriodLabel(
  customerSlug?: string | null,
): string | undefined {
  const ctx = getAggregationContext(filterSchema.parse({}), customerSlug);
  if (!ctx) return undefined;
  return `${ctx.manifest.periodStart} to ${ctx.manifest.periodEnd}`;
}

/**
 * Section data for the daily insights report in customer POC mode.
 *
 * The report issues five raw KQL queries; with no ADX all five fail and the
 * model is handed nothing but errors — a report generated from that would be
 * pure invention. This returns the equivalent figures from the dataset in the
 * same `{columns, rows}` shape the ADX path produces, so the prompt builder is
 * unchanged. `budget` stays an explicit error: budgets are genuinely absent
 * from a Cost Export and must not be inferred.
 */
export function customerSectionResults(
  customerSlug?: string | null,
): Record<
  string,
  { data: unknown; error?: string }
> | null {
  const ctx = getAggregationContext(filterSchema.parse({}), customerSlug);
  if (!ctx) return null;

  const kpi = aggregateKpiSummary(ctx);
  const services = aggregateCostByService(ctx, 5);
  const anomalies = aggregateAnomalyTimeline(ctx).filter(
    (p) => p.anomalyFlag !== 0,
  );
  const savings = aggregateSavingsSummary(ctx);
  const period = `${ctx.manifest.periodStart}..${ctx.manifest.periodEnd}`;

  return {
    topCosts: {
      data: {
        columns: ["ServiceName", "TotalCost"],
        rows: services.map((s) => [s.service, s.cost]),
      },
    },
    totalCost: {
      data: {
        columns: ["Total", "PreviousMonth", "ChangePercent", "Period"],
        rows: [
          [kpi.costLastMonth, kpi.costPreviousMonth, kpi.changePercent, period],
        ],
      },
    },
    anomalies: {
      data: {
        columns: ["Day", "ActualCost", "Baseline", "Direction"],
        rows: anomalies.map((a) => [
          a.day,
          a.actualCost,
          a.baseline,
          a.anomalyFlag > 0 ? "spike" : "drop",
        ]),
      },
    },
    budget: {
      data: null,
      error:
        "Budgets are not part of an Azure Cost Export. Report actual spend only and state that budget tracking requires Azure Cost Management.",
    },
    savings: {
      data: {
        columns: [
          "CommitmentGapSavings_Modeled30pct",
          "IdleResourceSavings_Measured",
          "TotalPotentialSavings_MixedBasis",
        ],
        rows: [
          [
            savings.commitmentGapSavings,
            savings.idleResourceSavings,
            savings.totalPotentialSavings,
          ],
        ],
        note:
          "CommitmentGapSavings is on-demand spend x a flat 30% assumed discount. " +
          "A cost export carries no reservation prices, so it is a model, not a measurement. " +
          "Always present it as an assumption that needs the customer's price sheet to confirm.",
      },
    },
  };
}

/**
 * Standalone system prompt for customer POC mode.
 *
 * Deliberately NOT appended to FINOPS_SYSTEM_PROMPT: that prompt is ~5k tokens
 * of ADX/KQL catalog which is unreachable here, and it costs both latency and
 * reasoning tokens while actively tempting the model to emit KQL. Measured on
 * a ~226k-row customer dataset: appending took 52.9s against a 60s route budget.
 */
export function customerModeSystemPrompt(
  customerSlug?: string | null,
): string {
  const ctx = getAggregationContext(filterSchema.parse({}), customerSlug);
  if (!ctx) return "";

  const currency = ctx.manifest.currencies[0] ?? "USD";

  return `# Persona
You are a **FinOps and Cost Optimization Analyst** presenting a customer's own
Azure spend back to them. Write clearly and professionally. Always include the
**period**, the **currency**, and **context** (MoM change, % of total).

# Data source: ingested Azure Cost Export (no ADX)
There is **no ADX cluster** in this session, so there is no KQL to write. Do not
mention KQL, do not ask the user to configure ADX, and do not ask them to paste
a query.

- Customer: ${ctx.manifest.customer}
- Period: ${ctx.manifest.periodStart} to ${ctx.manifest.periodEnd} (${currency})
- Rows: ${ctx.manifest.rowCount.toLocaleString("en-US")}

# Rules
1. Answer cost questions with \`get_customer_metric\`. It returns the same
   figures the dashboard panels display, so every number you quote can be
   pointed at on screen. Call \`get_customer_dataset_info\` if you need the
   coverage window.
2. This is a **historical snapshot**. "Last month" means the last complete month
   in the data (anchor ${ctx.anchor}), never the current calendar month. State
   the actual period in every answer.
3. If no metric covers the question, say so plainly and name the closest one.
   **Never estimate a figure that is not in the data** — these numbers are shown
   to the customer whose invoice they describe.
4. Budgets, Advisor recommendations and CPU/resource telemetry are NOT in a Cost
   Export. If asked, say they require Azure Cost Management or Azure Advisor.
5. Retail pricing questions ("what would X cost?") use the azure_price_* tools;
   guidance and best practices use search_microsoft_docs.

# Response format
1. Briefly restate the question. 2. Give the figures as a short table or list.
3. Add context (is it normal? MoM variation? share of total). 4. Suggest a
concrete next step the data can actually answer.

# Guardrails
- Never modify data. Never expose credentials.
- If confidence < 70%, ask for clarification rather than guessing.
- Always frame costs in business context.`;
}
