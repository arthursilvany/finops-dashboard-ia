/**
 * Demo dataset for the multicloud comparison.
 *
 * Deliberately expressed as billing *rows*, not as a finished
 * `MulticloudFacts` object. A hand-written facts object would render a
 * beautiful page while exercising none of the classification, unit
 * normalization or scoring logic — the demo would keep working after those
 * broke. These rows go through exactly the same pipeline as customer data.
 *
 * The vendor spellings are intentionally inconsistent ("1 Hour" / "Hrs" /
 * "hour", "1 GB/Month" / "GB-Mo" / "gibibyte month") because that
 * inconsistency is real, and a demo that only used tidy units would hide the
 * single most likely source of a wrong rate.
 *
 * The numbers describe a plausible mid-size estate. They are illustrative and
 * are labelled as mock everywhere they surface.
 */

import type { ComparableRow } from "../multicloud/facts";
import type { CloudProvider } from "../customer-data/contract";

const PERIOD_START = "2026-01-01";
const PERIOD_END = "2026-02-01";

interface Spec {
  provider: CloudProvider;
  serviceName: string;
  serviceCategory: string;
  meterCategory: string;
  meterSubcategory: string;
  resourceType: string;
  pricingUnit: string;
  /** Quantity in the vendor's own pricing unit. */
  quantity: number;
  /** Effective cost for that quantity. */
  cost: number;
  /** 0 when the row carries no baseline. */
  baselineCost: number;
  pricingCategory?: string;
  skuTerm?: string;
}

const SPECS: Spec[] = [
  // ── General purpose compute ────────────────────────────────────────────
  {
    provider: "Azure",
    serviceName: "Virtual Machines",
    serviceCategory: "Compute",
    meterCategory: "Virtual Machines",
    meterSubcategory: "Dv5 Series",
    resourceType: "microsoft.compute/virtualmachines",
    pricingUnit: "1 Hour",
    quantity: 292_000,
    cost: 56_064,
    baselineCost: 56_064,
  },
  {
    provider: "Azure",
    serviceName: "Virtual Machines",
    serviceCategory: "Compute",
    meterCategory: "Virtual Machines",
    meterSubcategory: "Dv5 Series Reserved",
    resourceType: "microsoft.compute/virtualmachines",
    pricingUnit: "1 Hour",
    quantity: 146_000,
    cost: 17_374,
    baselineCost: 28_032,
    pricingCategory: "Committed",
    skuTerm: "36",
  },
  {
    provider: "AWS",
    serviceName: "Amazon Elastic Compute Cloud",
    serviceCategory: "Compute",
    meterCategory: "AmazonEC2",
    meterSubcategory: "BoxUsage:m6i.xlarge",
    resourceType: "AWS::EC2::Instance",
    pricingUnit: "Hrs",
    quantity: 214_000,
    cost: 43_442,
    baselineCost: 43_442,
  },
  {
    provider: "AWS",
    serviceName: "Amazon Elastic Compute Cloud",
    serviceCategory: "Compute",
    meterCategory: "AmazonEC2",
    meterSubcategory: "SavingsPlanCoveredUsage",
    resourceType: "AWS::EC2::Instance",
    pricingUnit: "Hrs",
    quantity: 98_000,
    cost: 13_524,
    baselineCost: 19_894,
    pricingCategory: "Committed",
    skuTerm: "12",
  },
  {
    provider: "GCP",
    serviceName: "Compute Engine",
    serviceCategory: "Compute",
    meterCategory: "Compute Engine",
    meterSubcategory: "N2 Instance Core running in Americas",
    resourceType: "compute.googleapis.com/Instance",
    pricingUnit: "hour",
    quantity: 121_000,
    cost: 22_264,
    baselineCost: 22_264,
  },

  // ── Object storage ─────────────────────────────────────────────────────
  {
    provider: "Azure",
    serviceName: "Storage",
    serviceCategory: "Storage",
    meterCategory: "Storage",
    meterSubcategory: "Blob Storage Hot LRS",
    resourceType: "microsoft.storage/storageaccounts",
    pricingUnit: "1 GB/Month",
    quantity: 412_000,
    cost: 8_651,
    baselineCost: 8_651,
  },
  {
    provider: "AWS",
    serviceName: "Amazon Simple Storage Service",
    serviceCategory: "Storage",
    meterCategory: "AmazonS3",
    meterSubcategory: "TimedStorage-ByteHrs",
    resourceType: "AWS::S3::Bucket",
    pricingUnit: "GB-Mo",
    quantity: 306_000,
    cost: 7_038,
    baselineCost: 7_038,
  },
  {
    provider: "GCP",
    serviceName: "Cloud Storage",
    serviceCategory: "Storage",
    meterCategory: "Cloud Storage",
    meterSubcategory: "Standard Storage US Multi-region",
    resourceType: "storage.googleapis.com/Bucket",
    pricingUnit: "gibibyte month",
    quantity: 88_000,
    cost: 1_848,
    baselineCost: 1_848,
  },

  // ── Managed Kubernetes ─────────────────────────────────────────────────
  {
    provider: "Azure",
    serviceName: "Azure Kubernetes Service",
    serviceCategory: "Compute",
    meterCategory: "Azure Kubernetes Service",
    meterSubcategory: "Standard Uptime SLA",
    resourceType: "microsoft.containerservice/managedclusters",
    pricingUnit: "1 Hour",
    quantity: 8_760,
    cost: 876,
    baselineCost: 876,
  },
  {
    provider: "AWS",
    serviceName: "Amazon Elastic Kubernetes Service",
    serviceCategory: "Compute",
    meterCategory: "AmazonEKS",
    meterSubcategory: "AmazonEKS-Hours:perCluster",
    resourceType: "AWS::EKS::Cluster",
    pricingUnit: "Hrs",
    quantity: 8_760,
    cost: 876,
    baselineCost: 876,
  },

  // ── Relational database ────────────────────────────────────────────────
  {
    provider: "Azure",
    serviceName: "SQL Database",
    serviceCategory: "Databases",
    meterCategory: "SQL Database",
    meterSubcategory: "General Purpose vCore",
    resourceType: "microsoft.sql/servers/databases",
    pricingUnit: "1 Hour",
    quantity: 70_080,
    cost: 14_016,
    baselineCost: 14_016,
  },
  {
    provider: "AWS",
    serviceName: "Amazon Relational Database Service",
    serviceCategory: "Databases",
    meterCategory: "AmazonRDS",
    meterSubcategory: "InstanceUsage:db.m6g.xlarge",
    resourceType: "AWS::RDS::DBInstance",
    pricingUnit: "Hrs",
    quantity: 35_040,
    cost: 8_059,
    baselineCost: 8_059,
  },

  // ── AI inference ───────────────────────────────────────────────────────
  {
    provider: "Azure",
    serviceName: "Azure OpenAI",
    serviceCategory: "AI and Machine Learning",
    meterCategory: "Azure OpenAI",
    meterSubcategory: "gpt-4o Input Tokens",
    resourceType: "microsoft.cognitiveservices/accounts",
    pricingUnit: "1K tokens",
    quantity: 940_000,
    cost: 4_700,
    baselineCost: 4_700,
  },
  {
    provider: "AWS",
    serviceName: "Amazon Bedrock",
    serviceCategory: "AI and Machine Learning",
    meterCategory: "AmazonBedrock",
    meterSubcategory: "InputTokenCount",
    resourceType: "AWS::Bedrock::Model",
    pricingUnit: "1K tokens",
    quantity: 320_000,
    cost: 1_760,
    baselineCost: 1_760,
  },

  // ── Network egress ─────────────────────────────────────────────────────
  {
    provider: "Azure",
    serviceName: "Bandwidth",
    serviceCategory: "Networking",
    meterCategory: "Bandwidth",
    meterSubcategory: "Data Transfer Out",
    resourceType: "microsoft.network/publicipaddresses",
    pricingUnit: "1 GB",
    quantity: 148_000,
    cost: 11_988,
    baselineCost: 11_988,
  },
  {
    provider: "AWS",
    serviceName: "AWS Data Transfer",
    serviceCategory: "Networking",
    meterCategory: "AWSDataTransfer",
    meterSubcategory: "DataTransfer-Out-Bytes",
    resourceType: "AWS::EC2::Instance",
    pricingUnit: "GB",
    quantity: 96_000,
    cost: 8_640,
    baselineCost: 8_640,
  },
  {
    provider: "GCP",
    serviceName: "Compute Engine",
    serviceCategory: "Networking",
    meterCategory: "Network Internet Egress",
    meterSubcategory: "Network Internet Egress from Americas",
    resourceType: "compute.googleapis.com/Instance",
    pricingUnit: "gibibyte",
    quantity: 41_000,
    cost: 4_920,
    baselineCost: 4_920,
  },
];

export const mockMulticloudRows: ComparableRow[] = SPECS.map((spec) => ({
  providerName: spec.provider,
  serviceName: spec.serviceName,
  serviceCategory: spec.serviceCategory,
  skuMeterCategory: spec.meterCategory,
  skuMeterSubcategory: spec.meterSubcategory,
  resourceType: spec.resourceType,
  chargePeriodStart: PERIOD_START,
  chargePeriodEnd: PERIOD_END,
  chargeCategory: "Usage",
  pricingCategory: spec.pricingCategory ?? "Standard",
  pricingUnit: spec.pricingUnit,
  consumedQuantity: spec.quantity,
  cost: spec.cost,
  baselineCost: spec.baselineCost,
  skuTerm: spec.skuTerm ?? "",
}));

export const mockMulticloudProviders: CloudProvider[] = ["Azure", "AWS", "GCP"];
