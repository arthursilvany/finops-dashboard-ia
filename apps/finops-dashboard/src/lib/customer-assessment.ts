import fs from "node:fs";

import type {
  BudgetEvidenceRow,
  CommitmentEvidenceRow,
  HealthEvidenceRow,
  MetricEvidenceRow,
  OperationsEvidenceRow,
  OptionalEvidenceFile,
  PatchEvidenceRow,
  PolicyEvidenceRow,
  SecurityEvidenceRow,
} from "./customer-data/assessment-evidence";
import type {
  AdvisorEvidenceRow,
  CustomerEvidenceFile,
  ResourceGraphEvidenceRow,
} from "./customer-data/evidence";
import {
  activeCustomerPaths,
  customerSlugFromCookieHeader,
} from "./customer-data/workspace";
import { getCustomerDataset } from "./customer-dataset";

export interface CustomerAssessment {
  resources: ResourceGraphEvidenceRow[];
  advisor: AdvisorEvidenceRow[];
  policy: PolicyEvidenceRow[];
  security: SecurityEvidenceRow[];
  health: HealthEvidenceRow[];
  patch: PatchEvidenceRow[];
  operations: OperationsEvidenceRow[];
  metrics: MetricEvidenceRow[];
  budgets: BudgetEvidenceRow[];
  commitments: CommitmentEvidenceRow[];
}

/** Evidence is cached per workspace so switching customers cannot leak rows. */
const cacheBySlug = new Map<string, CustomerAssessment | null>();

function readRecords<T>(file: string, generatedAtUtc: string): T[] {
  if (!fs.existsSync(file)) return [];
  const evidence = JSON.parse(fs.readFileSync(file, "utf8")) as
    | CustomerEvidenceFile<T>
    | OptionalEvidenceFile<T>;
  if (
    evidence.status !== "available" ||
    evidence.datasetGeneratedAtUtc !== generatedAtUtc
  ) {
    return [];
  }
  return evidence.records;
}

export function getCustomerAssessment(
  customerSlug?: string | null,
): CustomerAssessment | null {
  const paths = activeCustomerPaths(customerSlug);
  const cachedForSlug = cacheBySlug.get(paths.slug);
  if (cachedForSlug !== undefined) return cachedForSlug;

  const dataset = getCustomerDataset(paths.slug);
  if (!dataset) {
    cacheBySlug.set(paths.slug, null);
    return null;
  }

  let assessment: CustomerAssessment | null = null;
  try {
    const version = dataset.manifest.generatedAtUtc;
    assessment = {
      resources: readRecords<ResourceGraphEvidenceRow>(
        paths.resourceGraph,
        version,
      ),
      advisor: readRecords<AdvisorEvidenceRow>(paths.advisor, version),
      policy: readRecords<PolicyEvidenceRow>(paths.policy, version),
      security: readRecords<SecurityEvidenceRow>(paths.security, version),
      health: readRecords<HealthEvidenceRow>(paths.health, version),
      patch: readRecords<PatchEvidenceRow>(paths.patch, version),
      operations: readRecords<OperationsEvidenceRow>(
        paths.operations,
        version,
      ),
      metrics: readRecords<MetricEvidenceRow>(paths.metrics, version),
      budgets: readRecords<BudgetEvidenceRow>(paths.budgets, version),
      commitments: readRecords<CommitmentEvidenceRow>(
        paths.commitments,
        version,
      ),
    };
  } catch (error) {
    console.error("[customer-assessment] failed to load evidence:", error);
    assessment = null;
  }

  cacheBySlug.set(paths.slug, assessment);
  return assessment;
}

export function getCustomerAssessmentForRequest(
  request: Pick<Request, "headers">,
): CustomerAssessment | null {
  return getCustomerAssessment(
    customerSlugFromCookieHeader(request.headers.get("cookie")),
  );
}

export function resetCustomerAssessmentCache(slug?: string): void {
  if (slug) {
    cacheBySlug.delete(slug);
    return;
  }
  cacheBySlug.clear();
}
