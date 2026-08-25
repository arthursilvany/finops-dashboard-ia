import { z } from "zod";

import {
  createChatCompletion,
  getFastDeployment,
  isTruncatedByReasoning,
} from "./openai-client";
import {
  searchMicrosoftDocsStructured,
  type MicrosoftLearnReference,
  type MicrosoftLearnSearchResult,
} from "./microsoft-learn-client";
import {
  NARRATIVE_SCHEMA_VERSION,
  assertSanitizedAssessmentFacts,
  customerNarrativeSchema,
  type CustomerNarrative,
  type SanitizedAssessmentFacts,
} from "./customer-narrative-contract";
import {
  assertNarrativeIsQuantified,
  assertQuantifiedImpact,
  assertTakeControlCommitment,
  buildAllowedNumbers,
} from "./customer-narrative-guardrails";

const modelActionSchema = z.object({
  title: z.string().min(1),
  priority: z.number().int().min(1).max(10),
  framework: z.enum(["CAF", "WAF"]),
  frameworkArea: z.string().min(1),
  wafPillar: z
    .enum([
      "Reliability",
      "Security",
      "Cost Optimization",
      "Operational Excellence",
      "Performance Efficiency",
    ])
    .nullable(),
  evidence: z.array(z.string().min(1)).min(1).max(5),
  businessImpact: z.string().min(1),
  businessImpactDimension: z.enum([
    "financial",
    "risk",
    "operational",
    "productivity",
  ]),
  recommendedChange: z.string().min(1),
  changeRisk: z.enum(["low", "medium", "high", "critical"]),
  changeImpact: z.string().min(1),
  inactionRisk: z.enum(["low", "medium", "high", "critical"]),
  inactionImpact: z.string().min(1),
  nextAction: z.string().min(1),
  commitment: z.string().min(1),
  effort: z.enum(["small", "medium", "large"]),
  confidence: z.number().min(0).max(1),
  sourceUrls: z.array(z.string().url()).min(1).max(5),
});

const modelResponseSchema = z.object({
  executiveSummary: z.string().min(1),
  decisionHeadline: z.string().min(1),
  executiveCommitment: z.string().min(1),
  limitations: z.array(z.string()).max(10),
  actions: z.array(modelActionSchema).min(1).max(10),
});

interface GroundingContext {
  excerpts: string;
  sources: MicrosoftLearnReference[];
}

export interface NarrativeGenerationDependencies {
  searchDocs: (query: string) => Promise<MicrosoftLearnSearchResult>;
  complete: (
    prompt: string,
    deployment: string,
  ) => Promise<{ content: string; model: string }>;
}

const defaultDependencies: NarrativeGenerationDependencies = {
  searchDocs: searchMicrosoftDocsStructured,
  complete: async (prompt, deployment) => {
    const completion = await createChatCompletion(
      {
        model: deployment,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 2_500,
        response_format: { type: "json_object" },
      },
      { timeout: 60_000 },
    );

    if (isTruncatedByReasoning(completion)) {
      throw new Error("Foundry returned a truncated Narrative IA response");
    }

    const content = completion.choices[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("Foundry returned an empty Narrative IA response");
    }
    return { content, model: completion.model || deployment };
  },
};

function buildLearnQueries(facts: SanitizedAssessmentFacts): string[] {
  const resourceTypes = facts.inventory
    .slice(0, 12)
    .map((item) => item.resourceType)
    .join(", ");
  const advisorThemes = facts.advisor
    .slice(0, 12)
    .map((item) => `${item.category}: ${item.recommendationTheme}`)
    .join("; ");
  const postureSignals = [
    facts.governance.policyStates.nonCompliant > 0 ? "policy compliance" : "",
    facts.security.assessments.unhealthy > 0 ? "security assessments" : "",
    facts.reliability.healthStates.unavailable > 0 ? "resource health" : "",
    facts.operations.missingCriticalPatches > 0 ? "critical patching" : "",
    facts.operations.metricCoveragePercentage < 100 ? "monitoring coverage" : "",
  ].filter(Boolean).join(", ");

  return [
    "Microsoft Cloud Adoption Framework Azure governance ready adopt manage methodology official guidance",
    `Azure Well-Architected Framework pillars assessment guidance for these generic resource types: ${resourceTypes || "Azure infrastructure"}`,
    `Azure Well-Architected Framework risk mitigation guidance for these Advisor themes and aggregate posture signals: ${advisorThemes || "reliability security cost optimization"}; ${postureSignals || "static assessment coverage"}`,
  ];
}

async function fetchFrameworkGrounding(
  facts: SanitizedAssessmentFacts,
  searchDocs: NarrativeGenerationDependencies["searchDocs"],
): Promise<GroundingContext> {
  const results = await Promise.all(
    buildLearnQueries(facts).map((query) => searchDocs(query)),
  );

  const sources = new Map<string, MicrosoftLearnReference>();
  const excerpts: string[] = [];
  for (const result of results) {
    excerpts.push(result.content.slice(0, 2_400));
    for (const reference of result.references) {
      sources.set(reference.url, reference);
    }
  }

  if (sources.size === 0) {
    throw new Error(
      "Microsoft Learn MCP returned no verifiable CAF/WAF references",
    );
  }

  return {
    excerpts: excerpts.join("\n\n---\n\n").slice(0, 7_200),
    sources: Array.from(sources.values()).slice(0, 20),
  };
}

export async function generateCustomerNarrative(
  rawFacts: unknown,
  dependencies: NarrativeGenerationDependencies = defaultDependencies,
): Promise<CustomerNarrative> {
  const facts = assertSanitizedAssessmentFacts(rawFacts);
  if (!facts.coverage.resourceGraph || !facts.coverage.advisor) {
    throw new Error(
      "Resource Graph and Advisor evidence are required for the CAF/WAF narrative",
    );
  }

  const grounding = await fetchFrameworkGrounding(
    facts,
    dependencies.searchDocs,
  );
  const allowedUrls = new Set(grounding.sources.map((source) => source.url));
  const deployment = getFastDeployment();

  const basePrompt = `You are a Microsoft Azure architecture assessment specialist.
Your audience is an enterprise decision maker who needs to act quickly.

Generate a concise action narrative grounded ONLY in:
1. the sanitized aggregate facts below; and
2. the official Microsoft Learn excerpts below.

Constraints:
- Never invent resources, topology, costs, incidents, controls, or references.
- Treat missing evidence as a limitation, not as proof of good or bad posture.
- Every action must cite at least one exact URL from ALLOWED SOURCE URLS.
- Compare the delivery risk/impact of making the change with the business and
  technical risk/impact of not acting.
- Prioritize actions by urgency, impact of inaction, confidence, and effort.
- Use CAF for adoption/governance/management concerns and WAF for workload
  quality. Set wafPillar to null for CAF actions.
- Evidence must use aggregate facts only and must not infer customer identity.
- Output pure JSON, with no markdown.

Take Control requirements:
- "businessImpact" answers "why does this matter?" for an executive. Quantify it
  whenever the facts allow, using ONLY figures present in the sanitized facts
  (or simple derivations of them such as monthly/annual conversion). Never
  estimate, extrapolate, or invent a monetary amount, percentage, or count. If
  no figure supports the impact, describe it qualitatively instead.
- "businessImpactDimension" classifies that impact as financial, risk,
  operational, or productivity.
- Round monetary figures to whole currency units and percentages to at most one
  decimal. Never reproduce a raw float from the facts.
- "nextAction" stays the internal execution task (who does what).
- "commitment" is the ask you make of the customer to close the conversation. It
  must request a decision, a validation, or a working session, and must be
  phrased as a question or open with "My recommendation is", "The suggested next
  step is", "Can we validate", or "Who should".
- "executiveCommitment" is the single ask that closes the whole narrative.
- Never use non-committal language such as "what do you think", "let's think
  about it", "just a suggestion", "we could consider", or "feel free to".

Required JSON:
{
  "executiveSummary": "string",
  "decisionHeadline": "string",
  "executiveCommitment": "string",
  "limitations": ["string"],
  "actions": [{
    "title": "string",
    "priority": 1,
    "framework": "CAF|WAF",
    "frameworkArea": "string",
    "wafPillar": "Reliability|Security|Cost Optimization|Operational Excellence|Performance Efficiency|null",
    "evidence": ["string"],
    "businessImpact": "string",
    "businessImpactDimension": "financial|risk|operational|productivity",
    "recommendedChange": "string",
    "changeRisk": "low|medium|high|critical",
    "changeImpact": "string",
    "inactionRisk": "low|medium|high|critical",
    "inactionImpact": "string",
    "nextAction": "string",
    "commitment": "string",
    "effort": "small|medium|large",
    "confidence": 0.0,
    "sourceUrls": ["exact allowed URL"]
  }]
}

SANITIZED AGGREGATE FACTS:
${JSON.stringify(facts)}

ALLOWED SOURCE URLS:
${grounding.sources.map((source) => `- ${source.url}`).join("\n")}

OFFICIAL MICROSOFT LEARN EXCERPTS:
${grounding.excerpts}`;

  const allowedNumbers = buildAllowedNumbers(facts);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const prompt =
      attempt === 0
        ? basePrompt
        : `${basePrompt}

YOUR PREVIOUS RESPONSE WAS REJECTED. Fix the problem below and return the complete JSON again.
REJECTION REASON: ${lastError?.message ?? "unknown validation failure"}`;

    const completion = await dependencies.complete(prompt, deployment);

    try {
      const modelResult = modelResponseSchema.parse(
        JSON.parse(completion.content),
      );

      let traceableImpactCount = 0;
      for (const action of modelResult.actions) {
        if (action.sourceUrls.some((url) => !allowedUrls.has(url))) {
          throw new Error(
            "Foundry returned a source that was not provided by Learn MCP",
          );
        }
        traceableImpactCount += assertQuantifiedImpact(action, allowedNumbers);
        assertTakeControlCommitment(
          action.commitment,
          `Commitment for action "${action.title}"`,
        );
      }
      assertNarrativeIsQuantified(traceableImpactCount);
      assertTakeControlCommitment(
        modelResult.executiveCommitment,
        "Executive commitment",
      );

      return customerNarrativeSchema.parse({
        schemaVersion: NARRATIVE_SCHEMA_VERSION,
        generatedAtUtc: new Date().toISOString(),
        datasetGeneratedAtUtc: facts.datasetGeneratedAtUtc,
        sourceLastModifiedAtUtc: facts.sourceLastModifiedAtUtc,
        model: completion.model || deployment,
        assessmentCoverage: {
          ...facts.coverage,
          limitations: Array.from(
            new Set([...facts.coverage.limitations, ...modelResult.limitations]),
          ),
        },
        executiveSummary: modelResult.executiveSummary,
        decisionHeadline: modelResult.decisionHeadline,
        executiveCommitment: modelResult.executiveCommitment,
        actions: modelResult.actions
          .sort((a, b) => a.priority - b.priority)
          .map((action, index) => ({
            ...action,
            id: `action-${index + 1}`,
          })),
        sources: grounding.sources,
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("Narrative IA generation failed validation");
}
