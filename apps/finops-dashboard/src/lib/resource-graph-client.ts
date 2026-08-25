import { DefaultAzureCredential } from "@azure/identity";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import type {
  AgenticRecommendation,
  AgenticStage,
  AgenticRiskLevel,
} from "./types";

let client: ResourceGraphClient | undefined;

function getClient(): ResourceGraphClient {
  if (!client) {
    client = new ResourceGraphClient(new DefaultAzureCredential());
  }
  return client;
}

export interface AdvisorRecommendationCount {
  category: string;
  impact: string;
  count: number;
}

export interface AdvisorRecommendationDetail {
  id: string;
  category: string;
  impact: string;
  title: string;
  description: string;
  resourceId: string;
  savingsAmount: number;
}

export interface AdvisorRemediationDetail {
  id: string;
  category: string;
  impact: string;
  title: string;
  description: string;
  resourceId: string;
  resourceType: string;
  resourceGroup: string;
  resourceName: string;
  region: string;
  extendedProperties: Record<string, string>;
}

const ADVISOR_KQL = `
advisorresources
| where type == "microsoft.advisor/recommendations"
| extend category = tostring(properties.category),
         impact   = tostring(properties.impact)
| summarize count() by category, impact
`;

const ADVISOR_DETAIL_KQL = `
advisorresources
| where type == "microsoft.advisor/recommendations"
| extend category = tostring(properties.category),
         impact   = tostring(properties.impact),
         sd       = properties.shortDescription,
         savings  = tostring(properties.extendedProperties.annualSavingsAmount),
         resId    = tostring(properties.resourceMetadata.resourceId)
| where category == "Cost"
| project id, category, impact, sd, savings, resId
| order by impact asc, savings desc
| take 100
`;

export async function queryAdvisorRecommendations(
  subscriptionIds: string[],
): Promise<AdvisorRecommendationCount[]> {
  const rg = getClient();
  const result = await rg.resources({
    query: ADVISOR_KQL,
    subscriptions: subscriptionIds,
  });

  const rows = result.data as Record<string, unknown>[];
  return rows.map((r) => ({
    category: String(r.category ?? ""),
    impact: String(r.impact ?? ""),
    count: Number(r.count_ ?? r["count_"] ?? 0),
  }));
}

export async function queryAdvisorDetails(
  subscriptionIds: string[],
): Promise<AdvisorRecommendationDetail[]> {
  const rg = getClient();
  const result = await rg.resources({
    query: ADVISOR_DETAIL_KQL,
    subscriptions: subscriptionIds,
  });

  const rows = result.data as Record<string, unknown>[];
  return rows.map((r) => {
    const sd = (r.sd ?? {}) as Record<string, unknown>;
    return {
      id: String(r.id ?? ""),
      category: String(r.category ?? ""),
      impact: String(r.impact ?? ""),
      title: String(sd.problem ?? r.id ?? "Recommendation"),
      description: String(sd.solution ?? ""),
      resourceId: String(r.resId ?? ""),
      savingsAmount: Number(r.savings ?? 0),
    };
  });
}

const ADVISOR_REMEDIATION_KQL = `
advisorresources
| where type == "microsoft.advisor/recommendations"
| extend category = tostring(properties.category),
         impact   = tostring(properties.impact),
         sd       = properties.shortDescription,
         resId    = tostring(properties.resourceMetadata.resourceId),
         resType  = tostring(properties.impactedField),
         ep       = properties.extendedProperties
| where category in ("HighAvailability", "Security")
| project id, category, impact, sd, resId, resType, ep
| order by impact asc
| take 200
`;

export function parseResourceId(resId: string) {
  const parts = resId.split("/");
  const rgIdx = parts.findIndex((p) => p.toLowerCase() === "resourcegroups");
  const resourceGroup = rgIdx >= 0 ? (parts[rgIdx + 1] ?? "") : "";
  const resourceName = parts[parts.length - 1] ?? "";
  return { resourceGroup, resourceName };
}

export async function queryAdvisorRemediationDetails(
  subscriptionIds: string[],
): Promise<AdvisorRemediationDetail[]> {
  const rg = getClient();
  const result = await rg.resources({
    query: ADVISOR_REMEDIATION_KQL,
    subscriptions: subscriptionIds,
  });

  const rows = result.data as Record<string, unknown>[];
  return rows.map((r) => {
    const sd = (r.sd ?? {}) as Record<string, unknown>;
    const ep = (r.ep ?? {}) as Record<string, unknown>;
    const resId = String(r.resId ?? "");
    const { resourceGroup, resourceName } = parseResourceId(resId);
    const epStrings: Record<string, string> = {};
    for (const [k, v] of Object.entries(ep)) {
      epStrings[k] = String(v ?? "");
    }
    return {
      id: String(r.id ?? ""),
      category: String(r.category ?? ""),
      impact: String(r.impact ?? ""),
      title: String(sd.problem ?? "Recommendation"),
      description: String(sd.solution ?? ""),
      resourceId: resId,
      resourceType: String(r.resType ?? ""),
      resourceGroup,
      resourceName,
      region: epStrings.region ?? epStrings.location ?? "",
      extendedProperties: epStrings,
    };
  });
}

// --- Agentic FinOps: Cost recommendations with stage classification ---

const ADVISOR_COST_AGENTIC_KQL = `
advisorresources
| where type == "microsoft.advisor/recommendations"
| extend category = tostring(properties.category),
         impact   = tostring(properties.impact),
         sd       = properties.shortDescription,
         resId    = tostring(properties.resourceMetadata.resourceId),
         resType  = tostring(properties.impactedField),
         ep       = properties.extendedProperties,
         savings  = todouble(properties.extendedProperties.annualSavingsAmount),
         recType  = tostring(properties.recommendationTypeId)
| where category == "Cost"
| project id, impact, sd, resId, resType, ep, savings, recType
| order by savings desc
| take 200
`;

export function classifyActionType(resType: string, title: string): string {
  const lower = (resType + " " + title).toLowerCase();
  if (
    lower.includes("shutdown") ||
    lower.includes("deallocat") ||
    lower.includes("stop")
  )
    return "STOP_VM";
  if (
    lower.includes("rightsize") ||
    lower.includes("right-size") ||
    lower.includes("resize") ||
    lower.includes("downsize")
  )
    return "RIGHTSIZE_VM";
  if (
    lower.includes("reserved") ||
    lower.includes("reservation") ||
    lower.includes("savings plan")
  )
    return "BUY_RESERVATION";
  if (
    lower.includes("sku") ||
    lower.includes("tier") ||
    lower.includes("scale")
  )
    return "CHANGE_SKU";
  if (
    lower.includes("orphan") ||
    lower.includes("unused") ||
    lower.includes("unattached")
  )
    return "DELETE_ORPHAN";
  if (lower.includes("tag")) return "AUTO_TAG";
  return "OPTIMIZE";
}

export function classifyRecommendationCategory(actionType: string): string {
  const categories: Record<string, string> = {
    STOP_VM: "Idle Resources",
    RIGHTSIZE_VM: "Rightsizing",
    BUY_RESERVATION: "Commitment Discount",
    CHANGE_SKU: "SKU Optimization",
    DELETE_ORPHAN: "Orphaned Resources",
    AUTO_TAG: "Governance",
    OPTIMIZE: "General Optimization",
  };
  return categories[actionType] ?? "General Optimization";
}

export function classifyAgenticStage(
  impact: string,
  actionType: string,
  savings: number,
): {
  stage: AgenticStage;
  risk: AgenticRiskLevel;
  requiresApproval: boolean;
  confidence: number;
} {
  const lowRiskActions = ["STOP_VM", "AUTO_TAG", "DELETE_ORPHAN"];
  const highRiskActions = ["BUY_RESERVATION"];

  if (highRiskActions.includes(actionType) || impact === "High") {
    return {
      stage: "pending-approval",
      risk: "high",
      requiresApproval: true,
      confidence: 0.7,
    };
  }
  if (lowRiskActions.includes(actionType) && impact !== "High") {
    return {
      stage: "ready",
      risk: "low",
      requiresApproval: false,
      confidence: 0.9,
    };
  }
  if (savings > 5000) {
    return {
      stage: "decide",
      risk: "medium",
      requiresApproval: true,
      confidence: 0.8,
    };
  }
  return {
    stage: "analyze",
    risk: "medium",
    requiresApproval: false,
    confidence: 0.75,
  };
}

export async function queryAdvisorCostAgentic(
  subscriptionIds: string[],
): Promise<AgenticRecommendation[]> {
  const rg = getClient();
  const result = await rg.resources({
    query: ADVISOR_COST_AGENTIC_KQL,
    subscriptions: subscriptionIds,
  });

  const rows = result.data as Record<string, unknown>[];
  return rows.map((r) => {
    const sd = (r.sd ?? {}) as Record<string, unknown>;
    const ep = (r.ep ?? {}) as Record<string, unknown>;
    const resId = String(r.resId ?? "");
    const { resourceGroup, resourceName } = parseResourceId(resId);
    const resType = String(r.resType ?? "");
    const title = String(sd.problem ?? "Cost Recommendation");
    const impact = String(r.impact ?? "Medium");
    const savings = Number(r.savings ?? 0);

    const actionType = classifyActionType(resType, title);
    const classification = classifyAgenticStage(impact, actionType, savings);

    return {
      id: String(r.id ?? ""),
      resourceId: resId,
      resourceName,
      resourceType: resType,
      resourceGroup,
      subscriptionName: "",
      impact: impact.toLowerCase() as "high" | "medium" | "low",
      title,
      description: String(sd.solution ?? ""),
      solution: String(ep.recommendedActions ?? sd.solution ?? ""),
      potentialSavings: savings,
      agenticStage: classification.stage,
      riskLevel: classification.risk,
      confidenceScore: classification.confidence,
      requiresApproval: classification.requiresApproval,
      actionType,
      recommendationCategory: classifyRecommendationCategory(actionType),
    };
  });
}
