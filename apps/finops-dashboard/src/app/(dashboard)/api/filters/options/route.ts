export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { isMockMode, executeQuery } from "@/lib/adx-client";
import {
  getCustomerDatasetForRequest,
} from "@/lib/customer-dataset";
import { normalizeProvider } from "@/lib/customer-data/contract";
import type { ApiResponse, FilterOptions } from "@/lib/types";

function filterOptionsQuery(): string {
  return `
let subs = Costs() | distinct SubAccountName | where isnotempty(SubAccountName) | order by SubAccountName asc | project SubAccountName;
let regions = Costs() | distinct RegionName | where isnotempty(RegionName) | order by RegionName asc | project RegionName;
let services = Costs() | distinct ServiceName | where isnotempty(ServiceName) | order by ServiceName asc | project ServiceName;
let rgs = Costs() | distinct x_ResourceGroupName | where isnotempty(x_ResourceGroupName) | order by x_ResourceGroupName asc | project x_ResourceGroupName;
let tagKeys = Costs() | where isnotempty(Tags) | mv-apply tag = bag_keys(todynamic(Tags)) to typeof(string) on (summarize by tag) | distinct tag | order by tag asc | project tag;
print placeholder=1
`;
}

const mockOptions: FilterOptions = {
  providers: ["Azure"],
  subscriptions: ["Sub-1", "Sub-2"],
  regions: ["eastus", "westeurope"],
  services: ["Microsoft.Compute", "Microsoft.Storage"],
  resourceGroups: ["rg-app-prod", "rg-data-prod"],
  tagKeys: ["Environment", "CostCenter", "Owner"],
};

function distinctSorted(values: Iterable<string>): string[] {
  return Array.from(
    new Set(
      Array.from(values)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

export async function GET(request: Request) {
  const now = new Date().toISOString();

  if (isMockMode()) {
    const dataset = getCustomerDatasetForRequest(request);
    if (dataset) {
      const data: FilterOptions = {
        providers: distinctSorted(dataset.rows.map((row) => row.providerName)),
        subscriptions: distinctSorted(
          dataset.rows.map((row) => row.subAccountName),
        ),
        regions: distinctSorted(dataset.rows.map((row) => row.regionName)),
        services: distinctSorted(dataset.rows.map((row) => row.serviceName)),
        resourceGroups: distinctSorted(
          dataset.rows.map((row) => row.resourceGroupName),
        ),
        tagKeys: distinctSorted(
          dataset.rows.flatMap((row) => Object.keys(row.tags)),
        ),
      };

      return NextResponse.json({
        data,
        metadata: {
          queriedAt: now,
          isMock: false,
          dataSource: "customer",
          customerName: dataset.manifest.customer,
        },
      } satisfies ApiResponse<FilterOptions>);
    }

    return NextResponse.json({
      data: mockOptions,
      metadata: { queriedAt: now, isMock: true },
    } satisfies ApiResponse<FilterOptions>);
  }

  const queries = [
    "Costs() | distinct SubAccountName | where isnotempty(SubAccountName) | order by SubAccountName asc",
    "Costs() | distinct RegionName | where isnotempty(RegionName) | order by RegionName asc",
    "Costs() | distinct ServiceName | where isnotempty(ServiceName) | order by ServiceName asc",
    "Costs() | distinct x_ResourceGroupName | where isnotempty(x_ResourceGroupName) | order by x_ResourceGroupName asc",
    "Costs() | where isnotempty(Tags) | mv-apply tag = bag_keys(todynamic(Tags)) to typeof(string) on (summarize by tag) | distinct tag | order by tag asc",
    "Costs() | distinct ProviderName | where isnotempty(ProviderName) | order by ProviderName asc",
  ];

  const [subs, regions, services, rgs, tagKeys, providers] = await Promise.all(
    queries.map((q) => executeQuery(q)),
  );

  const data: FilterOptions = {
    // FOCUS ProviderName is the raw vendor spelling ("Microsoft"), while the
    // filter values are normalized ("Azure"). `normalizeProvider` bridges the
    // two so the option list matches what `buildFilterClauses` expects back.
    // A hub can ingest non-Azure connectors, so a blank ProviderName here is
    // an unknown vendor, not an implied Azure.
    providers: distinctSorted(
      providers.rows.map((r) =>
        normalizeProvider(String(r.ProviderName ?? ""), "Other"),
      ),
    ),
    subscriptions: subs.rows.map((r) => String(r.SubAccountName ?? "")),
    regions: regions.rows.map((r) => String(r.RegionName ?? "")),
    services: services.rows.map((r) => String(r.ServiceName ?? "")),
    resourceGroups: rgs.rows.map((r) => String(r.x_ResourceGroupName ?? "")),
    tagKeys: tagKeys.rows.map((r) => String(r.tag ?? "")),
  };

  return NextResponse.json({
    data,
    metadata: { queriedAt: now, isMock: false },
  } satisfies ApiResponse<FilterOptions>);
}
