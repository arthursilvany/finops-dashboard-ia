/**
 * Generates a synthetic Azure Cost Export for testing the customer POC ingest.
 *
 * Usage:
 *   npx tsx scripts/generate-sample-export.ts --format focus --out ../../input/customer/sample.csv
 *   npx tsx scripts/generate-sample-export.ts --format focus --parquet --out sample.parquet
 *
 * The output is fake data only — never commit a real customer export.
 */
import fs from "node:fs";
import path from "node:path";

type Format = "focus" | "legacy";

const args = process.argv.slice(2);
function arg(name: string, fallback: string): string {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
}

const format = arg("format", "focus") as Format;
const days = Number(arg("days", "70"));
const asParquet = args.includes("--parquet");
const outPath = path.resolve(arg("out", asParquet ? "sample-export.parquet" : "sample-export.csv"));

const services = [
  { name: "Virtual Machines", category: "Compute", type: "microsoft.compute/virtualmachines" },
  { name: "Azure OpenAI", category: "AI and Machine Learning", type: "microsoft.cognitiveservices/accounts" },
  { name: "Storage", category: "Storage", type: "microsoft.storage/storageaccounts" },
  { name: "Azure SQL Database", category: "Databases", type: "microsoft.sql/servers/databases" },
  { name: "Bandwidth", category: "Networking", type: "microsoft.network/publicipaddresses" },
];
const subscriptions = ["prod-sub", "dev-sub"];

/**
 * Meter subcategories for the AI service. Real Azure OpenAI billing names the
 * model in the meter, which is the only place a Cost Export exposes it, so the
 * sample has to carry realistic names for the model-breakdown panel to be
 * exercised at all.
 */
const aiMeters = ["gpt-4o", "gpt-35-turbo", "text-embedding-ada-002"];
const regions = ["brazilsouth", "eastus"];
const businessUnits = ["finance", "engineering", ""];

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const focusHeaders = [
  "ChargePeriodStart",
  "BillingCurrency",
  "ChargeCategory",
  "PricingCategory",
  "PricingUnit",
  "EffectiveCost",
  "ListCost",
  "x_EffectiveCostInUsd",
  "ServiceName",
  "ServiceCategory",
  "SubAccountName",
  "RegionName",
  "ResourceId",
  "ResourceName",
  "ResourceType",
  "x_ResourceGroupName",
  "Tags",
  "CommitmentDiscountId",
  "CommitmentDiscountName",
  "CommitmentDiscountType",
  "CommitmentDiscountCategory",
  "CommitmentDiscountStatus",
  "x_SkuTerm",
  "x_SkuMeterCategory",
  "x_SkuMeterSubcategory",
];

const legacyHeaders = [
  "Date",
  "BillingCurrency",
  "ChargeType",
  "PricingModel",
  "UnitOfMeasure",
  "CostInBillingCurrency",
  "CostInUsd",
  "ConsumedService",
  "SubscriptionName",
  "ResourceLocation",
  "ResourceId",
  "ResourceGroup",
  "Tags",
  "ReservationId",
  "MeterCategory",
  "MeterSubCategory",
];

const anchor = new Date();
anchor.setUTCHours(0, 0, 0, 0);

const headers = format === "focus" ? focusHeaders : legacyHeaders;
/** Structured rows, so the same data can be emitted as CSV or as Parquet. */
const records: string[][] = [];

// Deterministic pseudo-random so repeated runs produce comparable numbers.
let seed = 42;
function random(): number {
  seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
  return seed / 2_147_483_648;
}

for (let d = days - 1; d >= 0; d -= 1) {
  const date = new Date(anchor);
  date.setUTCDate(date.getUTCDate() - d);
  const iso = date.toISOString().slice(0, 10);
  // One clear spike so the anomaly detection has something to find.
  const spike = d === 5 ? 6 : 1;

  for (let i = 0; i < services.length; i += 1) {
    const service = services[i];
    const subscription = subscriptions[i % subscriptions.length];
    const region = regions[i % regions.length];
    const bu = businessUnits[i % businessUnits.length];
    const committed = i === 0;
    const cost = Number(((5 + random() * 40) * spike).toFixed(4));
    const resourceGroup = `rg-${service.category.toLowerCase().split(" ")[0]}`;
    const meterSubcategory =
      service.category === "AI and Machine Learning"
        ? aiMeters[d % aiMeters.length]
        : "Standard";
    const resourceName = `res-${i}`;
    const resourceId = `/subscriptions/00000000-0000-0000-0000-00000000000${i}/resourceGroups/${resourceGroup}/providers/${service.type}/${resourceName}`;
    // Real tenants spell the cost-centre tag every possible way, so the fixture
    // rotates through the spellings a customer actually sends. Matching only
    // one of these silently reports the whole estate as untagged.
    const buTagKey = ["cost-center", "costcenter", "Cost Center", "cost_center"][i % 4];
    const tags = bu
      ? `{"env":"prod","owner":"team-${i}","${buTagKey}":"${bu}"}`
      : `{"env":"dev"}`;

    const row =
      format === "focus"
        ? [
            iso,
            "BRL",
            "Usage",
            committed ? "Committed" : "Standard",
            "1 Hour",
            String(cost),
            String(Number((cost * 1.25).toFixed(4))),
            String(Number((cost / 5).toFixed(4))),
            service.name,
            service.category,
            subscription,
            region,
            resourceId,
            resourceName,
            service.type,
            resourceGroup,
            tags,
            committed ? "ri-0001" : "",
            committed ? "VM_RI_prod_01" : "",
            committed ? "Reservation" : "",
            committed ? "Usage" : "",
            committed ? "Used" : "",
            committed ? "36" : "",
            service.name,
            meterSubcategory,
          ]
        : [
            iso,
            "BRL",
            "Usage",
            committed ? "Reservation" : "OnDemand",
            "1 Hour",
            String(cost),
            String(Number((cost / 5).toFixed(4))),
            service.name,
            subscription,
            region,
            resourceId,
            resourceGroup,
            tags,
            committed ? "ri-0001" : "",
            service.name,
            meterSubcategory,
          ];

    records.push(row.map((value) => String(value)));

    // Unused commitment capacity. Without this the sample would imply a
    // perfectly utilised reservation, and the utilisation panel could never be
    // exercised (nor could a regression in the legacy Unused mapping be caught).
    if (committed) {
      const unusedCost = Number((cost * 0.25).toFixed(4));
      const unusedRow =
        format === "focus"
          ? [
              iso,
              "BRL",
              "Usage",
              "Committed",
              "1 Hour",
              String(unusedCost),
              String(Number((unusedCost * 1.25).toFixed(4))),
              String(Number((unusedCost / 5).toFixed(4))),
              service.name,
              service.category,
              subscription,
              region,
              resourceId,
              resourceName,
              service.type,
              resourceGroup,
              tags,
              "ri-0001",
              "VM_RI_prod_01",
              "Reservation",
              "Usage",
              "Unused",
              "36",
              service.name,
              "Standard",
            ]
          : [
              iso,
              "BRL",
              // Legacy encodes unused capacity as its own ChargeType rather
              // than a status column.
              "UnusedReservation",
              "Reservation",
              "1 Hour",
              String(unusedCost),
              String(Number((unusedCost / 5).toFixed(4))),
              service.name,
              subscription,
              region,
              resourceId,
              resourceGroup,
              tags,
              "ri-0001",
              service.name,
              "Standard",
            ];

      records.push(unusedRow.map((value) => String(value)));
    }
  }
}

async function write(): Promise<void> {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  if (asParquet) {
    // hyparquet-writer is ESM-only; import dynamically so this script still
    // runs under tsx's CommonJS output.
    const { parquetWriteFile } = await import("hyparquet-writer");
    parquetWriteFile({
      filename: outPath,
      columnData: headers.map((name, column) => ({
        name,
        data: records.map((record) => record[column] ?? ""),
        type: "STRING" as const,
      })),
      // Azure compresses its own Parquet exports with Snappy, so the fixture
      // matches what a customer actually sends.
      codec: "SNAPPY",
      // Deliberately small: fixtures are a few hundred rows, and this forces
      // several row groups so the reader's group-by-group loop is exercised.
      rowGroupSize: 64,
    });
  } else {
    const lines = [headers.join(",")];
    for (const record of records) lines.push(record.map(csvEscape).join(","));
    fs.writeFileSync(outPath, `${lines.join("\n")}\n`, "utf8");
  }

  process.stdout.write(
    `Wrote ${records.length} ${format} rows over ${days} days to ${outPath}` +
      `${asParquet ? " (parquet/snappy)" : ""}\n`,
  );
}

void write();
