export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { isMockMode } from "@/lib/adx-client";
import { getCustomerAssessment } from "@/lib/customer-assessment";
import { getCustomerDataset } from "@/lib/customer-dataset";
import { LEGACY_WORKSPACE_SLUG } from "@/lib/customer-data/paths";
import {
  customerSlugFromCookieHeader,
  resolveActiveCustomerSlug,
} from "@/lib/customer-data/workspace";
import type { AdvisorRemediationDetail } from "@/lib/resource-graph-client";
import { parseResourceId } from "@/lib/resource-graph-client";
import {
  computeRemediationCards,
  generateRemediationInsight,
  fallbackInsight,
} from "@/lib/queries/remediation-impact";
import type { RemediationAiInsight } from "@/lib/types";

const SUBSCRIPTION_ID =
  process.env.AZURE_SUBSCRIPTION_ID ?? "<SUBSCRIPTION_ID>";

// In-memory cache: source namespace + card id → { insight, expiresAt }
const insightCache = new Map<
  string,
  { insight: RemediationAiInsight; expiresAt: number }
>();
const CACHE_TTL = 3_600_000; // 1 hour

function customerRecommendation(
  customerSlug: string,
  cardId: string,
): AdvisorRemediationDetail | null {
  const assessment = getCustomerAssessment(customerSlug);
  if (!assessment) return null;

  const row = assessment.advisor.find((candidate) => candidate.id === cardId);
  if (!row) return null;

  const resource = assessment.resources.find(
    (candidate) => candidate.id.toLowerCase() === row.resourceId.toLowerCase(),
  );
  const parsed = parseResourceId(row.resourceId);

  return {
    id: row.id,
    category: row.category,
    impact: row.impact,
    title: row.title,
    description: row.description,
    resourceId: row.resourceId,
    resourceType: row.resourceType || resource?.type || "",
    resourceGroup: resource?.resourceGroup ?? parsed.resourceGroup,
    resourceName: resource?.name ?? parsed.resourceName,
    region:
      resource?.location ??
      row.extendedProperties.region ??
      row.extendedProperties.location ??
      "",
    extendedProperties: row.extendedProperties,
  };
}

async function liveRecommendation(
  cardId: string,
): Promise<AdvisorRemediationDetail | null> {
  const cards = await computeRemediationCards([SUBSCRIPTION_ID]);
  const card = cards.find((candidate) => candidate.id === cardId);
  if (!card) return null;

  return {
    id: card.id,
    category: card.category === "Security" ? "Security" : "HighAvailability",
    impact: card.impact,
    title: card.recommendation,
    description: card.description,
    resourceId: card.id,
    resourceType: card.resourceType,
    resourceGroup: card.resourceGroup,
    resourceName: card.resourceName,
    region: card.region,
    extendedProperties: {},
  };
}

/**
 * POST /api/remediation-insight
 * Body: { id }
 * Generates an AI insight on-demand, cached for 1h.
 *
 * Recommendation facts are always reloaded from the selected customer's
 * assessment or from Resource Graph. Client-supplied descriptions are not
 * trusted as AI grounding.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body", data: null },
      { status: 400 },
    );
  }

  const cardId = String(body.id ?? "");
  if (!cardId) {
    return NextResponse.json(
      { ok: false, error: "Missing 'id' in body", data: null },
      { status: 400 },
    );
  }

  const requestSlug = customerSlugFromCookieHeader(
    request.headers.get("cookie"),
  );
  const activeSlug =
    resolveActiveCustomerSlug(requestSlug) ?? LEGACY_WORKSPACE_SLUG;
  const customerMode = isMockMode() && getCustomerDataset(activeSlug) !== null;
  const sourceNamespace = customerMode
    ? `customer:${activeSlug}`
    : `live:${SUBSCRIPTION_ID}`;
  const cacheKey = `${sourceNamespace}:${cardId}`;

  // Check in-memory cache
  const cached = insightCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({ ok: true, data: cached.insight });
  }

  try {
    const rec = customerMode
      ? customerRecommendation(activeSlug, cardId)
      : await liveRecommendation(cardId);
    if (!rec) {
      return NextResponse.json(
        { ok: false, error: "Recommendation not found", data: null },
        { status: 404 },
      );
    }

    const insight =
      (await generateRemediationInsight(rec)) ?? fallbackInsight(rec);

    insightCache.set(cacheKey, {
      insight,
      expiresAt: Date.now() + CACHE_TTL,
    });

    return NextResponse.json({ ok: true, data: insight });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[remediation-insight] Error:", message);
    return NextResponse.json(
      { ok: false, error: message, data: null },
      { status: 500 },
    );
  }
}
