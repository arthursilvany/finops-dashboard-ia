/**
 * The equivalence taxonomy: which vendor SKUs count as the same workload.
 *
 * This file encodes the single most contestable claim in the whole feature.
 * Saying that an Azure `Standard_D4s_v5`, an AWS `m6i.xlarge` and a GCP
 * `n2-standard-4` are "the same thing" is an engineering judgement about
 * architecture, not a fact that can be read out of a billing export. Two
 * competent architects can disagree about it.
 *
 * That is exactly why it lives here: declared in one place, versioned in git,
 * reviewable in a pull request, and echoed back into the UI through
 * `equivalenceLabel` so the reader can see the mapping that produced the
 * number and reject it. The alternative — letting a language model decide the
 * equivalence per request — would make the comparison unreviewable and
 * irreproducible.
 *
 * Matching runs against the normalized FOCUS fields, so it works identically
 * for the ADX path and the customer POC path.
 */

import type { CloudProvider } from "../customer-data/contract";
import type { ArchetypeId, CanonicalUnit } from "./types";

/**
 * How to recognise one provider's rows for an archetype.
 *
 * `include` and `exclude` are lowercase substrings tested against a haystack
 * built from the row's service name, meter category, meter subcategory and
 * resource type. Substring matching is used rather than exact SKU lists
 * because vendors rename meters continuously; an exact list silently stops
 * matching and the archetype quietly empties out.
 *
 * `exclude` is load-bearing, not decorative. Without it "Virtual Machines"
 * sweeps in the managed-disk and IP-address meters attached to a VM, and the
 * resulting vCPU-hour rate is inflated by storage the archetype does not
 * claim to price.
 */
export interface ProviderMatcher {
  include: string[];
  exclude?: string[];
  /**
   * What this archetype was taken to mean for this vendor, in the vendor's own
   * vocabulary. Rendered in the UI next to the rate.
   */
  equivalenceLabel: string;
}

export interface ArchetypeDefinition {
  id: ArchetypeId;
  label: string;
  /** Short statement of what is being held constant across providers. */
  basis: string;
  unit: CanonicalUnit;
  /**
   * FOCUS `ServiceCategory` values that can contain this archetype. Used as a
   * cheap pre-filter; `matchers` still decide. Empty means "any category".
   */
  serviceCategories: string[];
  matchers: Partial<Record<CloudProvider, ProviderMatcher>>;
}

/**
 * Meters that are never the workload itself.
 *
 * Support charges, tax and marketplace resale ride along inside the same
 * service categories and would otherwise be divided by a compute quantity, so
 * they are dropped before any archetype is considered.
 */
export const GLOBAL_EXCLUDE = [
  "support",
  "tax",
  "marketplace",
  "reservation purchase",
];

export const ARCHETYPES: ArchetypeDefinition[] = [
  {
    id: "general-purpose-compute",
    label: "General purpose compute",
    basis:
      "Balanced vCPU:memory instances (roughly 1:4), on-demand or committed, " +
      "excluding attached storage and networking.",
    unit: "vcpu-hour",
    serviceCategories: ["Compute"],
    matchers: {
      Azure: {
        include: ["virtual machines", "virtual machine"],
        exclude: ["disk", "snapshot", "ip address", "bandwidth", "image"],
        equivalenceLabel: "Virtual Machines (D/Dv-series general purpose)",
      },
      AWS: {
        include: ["amazonec2", "elastic compute cloud", "ec2"],
        exclude: ["ebs", "snapshot", "data transfer", "elastic ip", "nat"],
        equivalenceLabel: "EC2 (m-series general purpose)",
      },
      GCP: {
        include: ["compute engine", "computeengine"],
        exclude: ["pd-", "persistent disk", "snapshot", "egress", "ip address"],
        equivalenceLabel: "Compute Engine (n2/e2-standard)",
      },
    },
  },
  {
    id: "object-storage",
    label: "Object storage",
    basis: "Hot/standard tier capacity at rest. Excludes transactions and egress.",
    unit: "gib-month",
    serviceCategories: ["Storage"],
    matchers: {
      Azure: {
        include: ["blob", "storage"],
        exclude: [
          "disk",
          "file",
          "netapp",
          "backup",
          "transaction",
          "operations",
          "bandwidth",
        ],
        equivalenceLabel: "Blob Storage (Hot LRS)",
      },
      AWS: {
        include: ["amazons3", "simple storage service", "s3"],
        exclude: ["request", "data transfer", "glacier", "select"],
        equivalenceLabel: "S3 (Standard)",
      },
      GCP: {
        include: ["cloud storage", "gcs"],
        exclude: ["operations", "egress", "retrieval", "nearline", "coldline"],
        equivalenceLabel: "Cloud Storage (Standard)",
      },
    },
  },
  {
    id: "managed-kubernetes",
    label: "Managed Kubernetes",
    basis:
      "Control-plane and cluster management fees only. Worker nodes are " +
      "priced under general purpose compute and would be double counted here.",
    unit: "cluster-hour",
    serviceCategories: ["Compute"],
    matchers: {
      Azure: {
        include: ["kubernetes", "aks"],
        exclude: ["virtual machines", "disk", "bandwidth"],
        equivalenceLabel: "AKS (Standard tier uptime SLA)",
      },
      AWS: {
        include: ["amazoneks", "elastic kubernetes"],
        exclude: ["ec2", "ebs", "data transfer"],
        equivalenceLabel: "EKS (cluster hour)",
      },
      GCP: {
        include: ["kubernetes engine", "gke"],
        exclude: ["compute engine", "persistent disk"],
        equivalenceLabel: "GKE (cluster management fee)",
      },
    },
  },
  {
    id: "relational-database",
    label: "Managed relational database",
    basis:
      "Managed relational compute (vCore / instance hours). Excludes storage, " +
      "backup and I/O charges.",
    unit: "vcpu-hour",
    serviceCategories: ["Databases"],
    matchers: {
      Azure: {
        include: ["sql database", "sql managed", "postgresql", "mysql", "mariadb"],
        exclude: ["storage", "backup", "long term retention", "bandwidth"],
        equivalenceLabel: "Azure SQL Database / Flexible Server (vCore)",
      },
      AWS: {
        include: ["amazonrds", "relational database service", "amazonaurora"],
        exclude: ["storage", "backup", "i/o", "snapshot", "data transfer"],
        equivalenceLabel: "RDS / Aurora (instance hour)",
      },
      GCP: {
        include: ["cloud sql", "alloydb"],
        exclude: ["storage", "backup", "egress"],
        equivalenceLabel: "Cloud SQL / AlloyDB (vCPU hour)",
      },
    },
  },
  {
    id: "serverless-functions",
    label: "Serverless functions",
    basis:
      "Event-driven execution priced per invocation. GB-seconds are billed " +
      "separately by every vendor and are not folded in here.",
    unit: "million-requests",
    serviceCategories: ["Compute", "Web"],
    matchers: {
      Azure: {
        include: ["functions", "azure functions"],
        exclude: ["app service plan", "premium plan", "storage"],
        equivalenceLabel: "Azure Functions (Consumption)",
      },
      AWS: {
        include: ["awslambda", "lambda"],
        exclude: ["data transfer", "provisioned concurrency"],
        equivalenceLabel: "Lambda (requests)",
      },
      GCP: {
        include: ["cloud functions", "cloud run"],
        exclude: ["egress", "cpu allocation"],
        equivalenceLabel: "Cloud Functions / Cloud Run (requests)",
      },
    },
  },
  {
    id: "data-warehouse",
    label: "Data warehouse",
    basis:
      "Analytical query processing. Note that the vendors bill on genuinely " +
      "different models (provisioned capacity vs. bytes scanned); see the " +
      "caveat rendered with this row.",
    unit: "tb-scanned",
    serviceCategories: ["Analytics", "Databases"],
    matchers: {
      Azure: {
        include: ["synapse", "fabric", "data warehouse"],
        exclude: ["storage", "data integration", "pipeline"],
        equivalenceLabel: "Synapse / Fabric capacity",
      },
      AWS: {
        include: ["amazonredshift", "redshift", "amazonathena", "athena"],
        exclude: ["storage", "backup", "spectrum"],
        equivalenceLabel: "Redshift / Athena",
      },
      GCP: {
        include: ["bigquery"],
        exclude: ["storage", "streaming insert"],
        equivalenceLabel: "BigQuery (analysis)",
      },
    },
  },
  {
    id: "ai-inference",
    label: "AI / LLM inference",
    basis:
      "Token-billed model inference. Model families differ in capability, so " +
      "a lower token rate is not automatically better value.",
    unit: "thousand-tokens",
    serviceCategories: ["AI and Machine Learning"],
    matchers: {
      Azure: {
        include: ["openai", "azure ai", "cognitive services"],
        exclude: ["speech", "translator", "search", "fine-tun", "storage"],
        equivalenceLabel: "Azure OpenAI (token inference)",
      },
      AWS: {
        include: ["bedrock", "amazonsagemaker", "sagemaker"],
        exclude: ["training", "storage", "notebook"],
        equivalenceLabel: "Bedrock (on-demand inference)",
      },
      GCP: {
        include: ["vertex", "generative ai", "gemini"],
        exclude: ["training", "storage", "notebook"],
        equivalenceLabel: "Vertex AI (prediction)",
      },
    },
  },
  {
    id: "network-egress",
    label: "Network egress",
    basis:
      "Data leaving the provider to the internet. The dominant lock-in cost " +
      "and the one most often missing from a naive comparison.",
    unit: "gb-egress",
    serviceCategories: ["Networking"],
    matchers: {
      Azure: {
        include: ["bandwidth", "data transfer out", "egress"],
        exclude: ["inter-region", "expressroute", "vpn gateway"],
        equivalenceLabel: "Bandwidth (internet egress)",
      },
      AWS: {
        include: ["data transfer", "datatransfer"],
        // "in" alone would be a two-letter substring matching unrelated meter
        // words, so the inbound and private-path meters are named explicitly.
        exclude: [
          "transfer in",
          "-in-",
          "ingress",
          "intra-region",
          "direct connect",
        ],
        equivalenceLabel: "Data Transfer Out",
      },
      GCP: {
        include: ["egress", "network internet"],
        exclude: ["ingress", "interconnect", "intra-region"],
        equivalenceLabel: "Network Egress (internet)",
      },
    },
  },
];

export const ARCHETYPE_BY_ID = new Map<ArchetypeId, ArchetypeDefinition>(
  ARCHETYPES.map((a) => [a.id, a]),
);

/**
 * Providers the taxonomy can actually recognise rows for.
 *
 * Anything else — `"Other"` from `normalizeProvider`, a partner feed, a new
 * connector — can never produce an observation, so it must never influence the
 * comparison. In particular it must not participate in the comparison window:
 * a handful of unmapped rows spanning one month would otherwise clip an
 * Azure-vs-AWS comparison to that month, or empty it entirely if the spans do
 * not overlap.
 */
export const COMPARABLE_PROVIDERS: CloudProvider[] = Array.from(
  new Set(ARCHETYPES.flatMap((a) => Object.keys(a.matchers))),
) as CloudProvider[];

/**
 * Archetypes whose vendors bill on structurally different models, where even a
 * correctly computed rate comparison can mislead.
 */
export const STRUCTURALLY_DIVERGENT: ArchetypeId[] = [
  "data-warehouse",
  "ai-inference",
  "serverless-functions",
];

/** Fields a row must expose to be classified. Kept minimal on purpose. */
export interface ClassifiableRow {
  providerName: CloudProvider;
  serviceName: string;
  serviceCategory: string;
  skuMeterCategory: string;
  skuMeterSubcategory: string;
  resourceType: string;
}

function haystackOf(row: ClassifiableRow): string {
  return [
    row.serviceName,
    row.skuMeterCategory,
    row.skuMeterSubcategory,
    row.resourceType,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * The archetype a row belongs to, or null when it belongs to none.
 *
 * Returning null is the common and correct outcome: most of a bill is not part
 * of any comparable archetype, and forcing every row into a bucket would be
 * how a support charge ends up priced per vCPU-hour.
 *
 * The first matching archetype wins, so `ARCHETYPES` is ordered from most to
 * least specific.
 */
export function classifyRow(row: ClassifiableRow): ArchetypeId | null {
  const haystack = haystackOf(row);
  if (!haystack) return null;
  if (GLOBAL_EXCLUDE.some((term) => haystack.includes(term))) return null;

  for (const archetype of ARCHETYPES) {
    const matcher = archetype.matchers[row.providerName];
    if (!matcher) continue;

    if (
      archetype.serviceCategories.length > 0 &&
      row.serviceCategory &&
      !archetype.serviceCategories.includes(row.serviceCategory)
    ) {
      continue;
    }

    if (matcher.exclude?.some((term) => haystack.includes(term))) continue;
    if (matcher.include.some((term) => haystack.includes(term))) {
      return archetype.id;
    }
  }

  return null;
}
