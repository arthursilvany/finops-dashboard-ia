// Reservation / Commitment Detail KQL queries — FinOps Hub FOCUS schema

import type { ParsedFilters } from "../filter-schema";
import { buildFilterClauses, costColumn } from "./filter-builder";

interface ReservationQueryParams {
  commitmentName?: string;
  resourceType?: string;
  commitmentType?: string;
}

export function reservationDetail(
  filters?: ParsedFilters,
  params?: ReservationQueryParams,
): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";

  const extraFilters: string[] = [];
  if (params?.commitmentName) {
    extraFilters.push(
      `| where CommitmentDiscountName contains "${params.commitmentName}"`,
    );
  }
  if (params?.resourceType) {
    extraFilters.push(
      `| where x_ResourceType contains "${params.resourceType}"`,
    );
  }
  if (params?.commitmentType) {
    extraFilters.push(
      `| where CommitmentDiscountType == "${params.commitmentType}"`,
    );
  }
  const ef = extraFilters.join("\n");

  return `
Costs()
${fc}
| where isnotempty(CommitmentDiscountId)
| where ChargeCategory == "Usage"
${ef}
| summarize
    Used = round(sumif(${cc}, CommitmentDiscountStatus == "Used"), 2),
    Unused = round(sumif(${cc}, CommitmentDiscountStatus == "Unused"), 2),
    Days = dcount(startofday(ChargePeriodStart)),
    x_SkuTerm = take_any(x_SkuTerm),
    x_ResourceType = take_any(x_ResourceType)
    by CommitmentDiscountName, CommitmentDiscountId, CommitmentDiscountType
| extend Utilization = iff(Used + Unused == 0, 0.0, round(Used / (Used + Unused) * 100, 1))
| project
    CommitmentDiscountName,
    CommitmentDiscountId,
    CommitmentDiscountType,
    x_SkuTerm,
    x_ResourceType,
    Used,
    Unused,
    Utilization,
    Days
| order by Unused desc
`;
}

export function reservationTrend(
  filters?: ParsedFilters,
  params?: ReservationQueryParams,
): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  const cc = filters ? costColumn(filters.currency) : "EffectiveCost";

  const extraFilters: string[] = [];
  if (params?.commitmentName) {
    extraFilters.push(
      `| where CommitmentDiscountName contains "${params.commitmentName}"`,
    );
  }
  if (params?.commitmentType) {
    extraFilters.push(
      `| where CommitmentDiscountType == "${params.commitmentType}"`,
    );
  }
  const ef = extraFilters.join("\n");

  return `
Costs()
${fc}
| where isnotempty(CommitmentDiscountId)
| where ChargeCategory == "Usage"
${ef}
| summarize
    Used = round(sumif(${cc}, CommitmentDiscountStatus == "Used"), 2),
    Unused = round(sumif(${cc}, CommitmentDiscountStatus == "Unused"), 2)
    by Month = startofmonth(ChargePeriodStart)
| order by Month asc
| project Month, Used, Unused
`;
}

export function reservationFilterOptions(filters?: ParsedFilters): string {
  const fc = filters ? buildFilterClauses(filters) : "";
  return `
Costs()
${fc}
| where isnotempty(CommitmentDiscountId)
| where ChargeCategory == "Usage"
| summarize by CommitmentDiscountName, CommitmentDiscountType, x_ResourceType
| summarize
    Names = make_set(CommitmentDiscountName, 500),
    ResourceTypes = make_set(x_ResourceType, 100),
    CommitmentTypes = make_set(CommitmentDiscountType, 10)
`;
}
