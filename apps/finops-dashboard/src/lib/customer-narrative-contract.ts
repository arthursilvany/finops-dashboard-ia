import { z } from "zod";

export const NARRATIVE_SCHEMA_VERSION = "1.1.0";

const riskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
const frameworkSchema = z.enum(["CAF", "WAF"]);
const wafPillarSchema = z.enum([
  "Reliability",
  "Security",
  "Cost Optimization",
  "Operational Excellence",
  "Performance Efficiency",
]);

export const businessImpactDimensionSchema = z.enum([
  "financial",
  "risk",
  "operational",
  "productivity",
]);

export type BusinessImpactDimension = z.infer<
  typeof businessImpactDimensionSchema
>;

const sourceReferenceSchema = z.object({
  title: z.string().min(1),
  url: z.string().url().refine((url) => {
    try {
      return new URL(url).hostname === "learn.microsoft.com";
    } catch {
      return false;
    }
  }, "Narrative sources must be hosted on learn.microsoft.com"),
});

export const narrativeActionSchema = z.object({
  id: z.string().regex(/^action-\d+$/),
  title: z.string().min(1),
  priority: z.number().int().min(1).max(10),
  framework: frameworkSchema,
  frameworkArea: z.string().min(1),
  wafPillar: wafPillarSchema.nullable(),
  evidence: z.array(z.string().min(1)).min(1).max(5),
  businessImpact: z.string().min(1),
  businessImpactDimension: businessImpactDimensionSchema,
  recommendedChange: z.string().min(1),
  changeRisk: riskLevelSchema,
  changeImpact: z.string().min(1),
  inactionRisk: riskLevelSchema,
  inactionImpact: z.string().min(1),
  nextAction: z.string().min(1),
  commitment: z.string().min(1),
  effort: z.enum(["small", "medium", "large"]),
  confidence: z.number().min(0).max(1),
  sourceUrls: z.array(z.string().url()).min(1).max(5),
});

export const customerNarrativeSchema = z.object({
  schemaVersion: z.literal(NARRATIVE_SCHEMA_VERSION),
  generatedAtUtc: z.string().datetime(),
  datasetGeneratedAtUtc: z.string().datetime(),
  sourceLastModifiedAtUtc: z.string().datetime(),
  model: z.string().min(1),
  assessmentCoverage: z.object({
    costExport: z.boolean(),
    resourceGraph: z.boolean(),
    advisor: z.boolean(),
    policy: z.boolean().default(false),
    security: z.boolean().default(false),
    health: z.boolean().default(false),
    operations: z.boolean().default(false),
    metrics: z.boolean().default(false),
    budgets: z.boolean().default(false),
    commitments: z.boolean().default(false),
    limitations: z.array(z.string()),
  }),
  executiveSummary: z.string().min(1),
  decisionHeadline: z.string().min(1),
  executiveCommitment: z.string().min(1),
  actions: z.array(narrativeActionSchema).min(1).max(10),
  sources: z.array(sourceReferenceSchema).min(1).max(20),
});

export type CustomerNarrative = z.infer<typeof customerNarrativeSchema>;

export const customerNarrativeStatusSchema = z.object({
  schemaVersion: z.literal(NARRATIVE_SCHEMA_VERSION),
  state: z.enum(["ready", "failed"]),
  attemptedAtUtc: z.string().datetime(),
  narrativeGeneratedAtUtc: z.string().datetime().optional(),
  error: z.string().min(1).optional(),
});

export type CustomerNarrativeStatus = z.infer<
  typeof customerNarrativeStatusSchema
>;

export const sanitizedAssessmentFactsSchema = z.object({
  schemaVersion: z.literal(NARRATIVE_SCHEMA_VERSION),
  datasetGeneratedAtUtc: z.string().datetime(),
  sourceLastModifiedAtUtc: z.string().datetime(),
  coverage: z.object({
    costExport: z.boolean(),
    resourceGraph: z.boolean(),
    advisor: z.boolean(),
    policy: z.boolean().default(false),
    security: z.boolean().default(false),
    health: z.boolean().default(false),
    operations: z.boolean().default(false),
    metrics: z.boolean().default(false),
    budgets: z.boolean().default(false),
    commitments: z.boolean().default(false),
    limitations: z
      .array(
        z.enum([
          "static-snapshot",
          "no-runtime-telemetry",
          "no-policy-assignments",
          "missing-cost-export",
          "missing-resource-graph",
          "missing-advisor",
          "missing-policy",
          "missing-security",
          "missing-health",
          "missing-operations",
          "missing-metrics",
          "missing-budgets",
          "missing-commitments",
          "partial-runtime-telemetry",
        ]),
      )
      .max(20),
  }),
  cost: z.object({
    currencies: z.array(z.string().regex(/^[A-Z]{3}$/)).max(4),
    periodDays: z.number().int().nonnegative(),
    totalEffectiveCost: z.number(),
    topServices: z
      .array(
        z.object({
          serviceCategory: z.enum([
            "AI and Machine Learning",
            "Compute",
            "Storage",
            "Databases",
            "Networking",
            "Management and Governance",
            "Security",
            "Analytics",
            "Other",
          ]),
          cost: z.number(),
          percentage: z.number().min(0).max(100),
        }),
      )
      .max(10),
  }),
  inventory: z
    .array(
      z.object({
        resourceType: z
          .string()
          .regex(/^microsoft\.[a-z0-9.]+\/[a-z0-9./]+$/),
        count: z.number().int().positive(),
      }),
    )
    .max(100),
  advisor: z
    .array(
      z
        .object({
        category: z.enum([
          "Cost",
          "HighAvailability",
          "Security",
          "Performance",
          "OperationalExcellence",
          "Other",
        ]),
        impact: z.enum(["High", "Medium", "Low"]),
        recommendationTheme: z.enum([
          "availability",
          "backup-and-recovery",
          "security-hardening",
          "cost-optimization",
          "performance-efficiency",
          "operational-excellence",
          "governance",
          "other",
        ]),
        count: z.number().int().positive(),
        annualSavings: z.number().nonnegative().optional(),
          currency: z.string().regex(/^[A-Z]{3}$/).optional(),
        })
        .refine(
          (item) =>
            (item.annualSavings === undefined) ===
            (item.currency === undefined),
          "Advisor savings and currency must be provided together",
        ),
    )
    .max(100),
  governance: z.object({
    policyStates: z.object({
      total: z.number().int().nonnegative(),
      compliant: z.number().int().nonnegative(),
      nonCompliant: z.number().int().nonnegative(),
      unknown: z.number().int().nonnegative(),
    }),
  }).default({
    policyStates: { total: 0, compliant: 0, nonCompliant: 0, unknown: 0 },
  }),
  security: z.object({
    assessments: z.object({
      total: z.number().int().nonnegative(),
      unhealthy: z.number().int().nonnegative(),
      highSeverity: z.number().int().nonnegative(),
    }),
  }).default({
    assessments: { total: 0, unhealthy: 0, highSeverity: 0 },
  }),
  reliability: z.object({
    healthStates: z.object({
      total: z.number().int().nonnegative(),
      unavailable: z.number().int().nonnegative(),
      degraded: z.number().int().nonnegative(),
    }),
    backupSignals: z.object({
      total: z.number().int().nonnegative(),
      unhealthy: z.number().int().nonnegative(),
    }),
  }).default({
    healthStates: { total: 0, unavailable: 0, degraded: 0 },
    backupSignals: { total: 0, unhealthy: 0 },
  }),
  operations: z.object({
    monitoredResources: z.number().int().nonnegative(),
    inventoryResources: z.number().int().nonnegative(),
    metricCoveragePercentage: z.number().min(0).max(100),
    diagnosticSignals: z.number().int().nonnegative(),
    alertSignals: z.number().int().nonnegative(),
    missingCriticalPatches: z.number().int().nonnegative(),
    missingSecurityPatches: z.number().int().nonnegative(),
  }).default({
    monitoredResources: 0,
    inventoryResources: 0,
    metricCoveragePercentage: 0,
    diagnosticSignals: 0,
    alertSignals: 0,
    missingCriticalPatches: 0,
    missingSecurityPatches: 0,
  }),
  financialGovernance: z.object({
    budgets: z
      .array(
        z.object({
          currency: z.string().regex(/^[A-Z]{3}$/),
          count: z.number().int().positive(),
          totalAmount: z.number().nonnegative(),
        }),
      )
      .max(4),
    commitments: z.object({
      recommendationCount: z.number().int().nonnegative(),
      annualSavingsByCurrency: z
        .array(
          z.object({
            currency: z.string().regex(/^[A-Z]{3}$/),
            annualSavings: z.number().nonnegative(),
          }),
        )
        .max(4),
    }),
  }).default({
    budgets: [],
    commitments: { recommendationCount: 0, annualSavingsByCurrency: [] },
  }),
});

export type SanitizedAssessmentFacts = z.infer<
  typeof sanitizedAssessmentFactsSchema
>;

const IDENTIFIER_PATTERNS = [
  /\/subscriptions\/[^/\s]+/i,
  /\/resourceGroups\/[^/\s]+/i,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
];

export function sanitizeAssessmentText(value: string): string {
  let sanitized = value.replace(/\s+/g, " ").trim();
  for (const pattern of IDENTIFIER_PATTERNS) {
    sanitized = sanitized.replace(new RegExp(pattern.source, pattern.flags + "g"), "[redacted]");
  }
  return sanitized;
}

export function assertSanitizedAssessmentFacts(
  value: unknown,
): SanitizedAssessmentFacts {
  const facts = sanitizedAssessmentFactsSchema.parse(value);
  const serialized = JSON.stringify(facts);
  for (const pattern of IDENTIFIER_PATTERNS) {
    if (pattern.test(serialized)) {
      throw new Error(
        "Sanitized assessment contains a forbidden customer identifier",
      );
    }
  }
  return facts;
}
