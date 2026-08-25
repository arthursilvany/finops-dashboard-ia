import type { SimulatorInput, SimulatorService } from "../types";

function escapeKqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function serviceCategoryHint(service: SimulatorService): string {
  switch (service) {
    case "VM":
      return "virtual";
    case "Storage":
      return "storage";
    case "DB":
      return "database";
    case "AKS":
      return "kubernetes";
    default:
      return "";
  }
}

function regionDisplayCandidates(region: string): string[] {
  const normalized = region.trim().toLowerCase();

  const known: Record<string, string[]> = {
    brazilsouth: ["br south", "brazil south"],
    eastus: ["east us", "us east"],
    eastus2: ["east us 2", "us east 2"],
    westus2: ["west us 2", "us west 2"],
    westeurope: ["west europe", "europe west"],
    northeurope: ["north europe", "europe north"],
  };

  return [normalized, ...(known[normalized] || [])];
}

function buildRegionFilter(region: string): string {
  const candidates = regionDisplayCandidates(region)
    .map((candidate) => escapeKqlString(candidate))
    .map(
      (candidate) =>
        `tolower(x_SkuRegion) contains "${candidate}" or tolower(replace_string(x_SkuRegion, " ", "")) contains "${candidate.replace(/\s+/g, "")}"`,
    );

  return candidates.length > 0 ? `| where (${candidates.join(" or ")})` : "";
}

export function simulatorEstimateQuery(input: SimulatorInput): string {
  const sku = escapeKqlString(input.sku);
  const regionFilter = buildRegionFilter(input.region);
  const serviceHint = escapeKqlString(serviceCategoryHint(input.service));
  const qty = Number.isFinite(input.qty) && input.qty > 0 ? input.qty : 1;
  const priceColumn =
    input.priceSource === "contract" ? "ContractedUnitPrice" : "ListUnitPrice";

  return `
let qty = ${qty};
Prices_v1_2()
| where isnotempty(${priceColumn})
| where tolower(x_SkuDescription) contains tolower("${sku}")
${regionFilter}
| where isempty("${serviceHint}") or tolower(x_SkuMeterCategory) contains "${serviceHint}" or tolower(x_SkuMeterSubcategory) contains "${serviceHint}"
| summarize
    OnDemandUnit = minif(${priceColumn}, (tolower(x_SkuPriceType) contains "consumption" or isempty(x_SkuPriceType)) and (toint(x_SkuTerm) == 0 or isempty(x_SkuTerm))),
    OneYearUnit = minif(${priceColumn}, toint(x_SkuTerm) == 12),
    ThreeYearUnit = minif(${priceColumn}, toint(x_SkuTerm) == 36),
    PricingUnit = take_any(PricingUnit),
    BillingCurrency = take_any(BillingCurrency)
| extend
    OnDemandUnit = coalesce(OnDemandUnit, 0.0),
    OneYearUnit = iff(isnull(OneYearUnit) or OneYearUnit == 0.0, OnDemandUnit * 0.78, OneYearUnit),
    ThreeYearUnit = iff(isnull(ThreeYearUnit) or ThreeYearUnit == 0.0, OnDemandUnit * 0.61, ThreeYearUnit)
| extend UnitToMonthFactor = iff(tolower(PricingUnit) contains "hour", 730.0, 1.0)
| extend
    MonthlyOnDemand = round(OnDemandUnit * UnitToMonthFactor * qty, 2),
    Monthly1yr = round(OneYearUnit * UnitToMonthFactor * qty, 2),
    Monthly3yr = round(ThreeYearUnit * UnitToMonthFactor * qty, 2)
| extend
    MonthlySavings1yr = round(MonthlyOnDemand - Monthly1yr, 2),
    MonthlySavings3yr = round(MonthlyOnDemand - Monthly3yr, 2)
| project
    MonthlyOnDemand,
    Monthly1yr,
    Monthly3yr,
    MonthlySavings1yr,
    MonthlySavings3yr,
    BillingCurrency,
    PricingUnit
`;
}

export function simulatorComparisonQuery(input: SimulatorInput): string {
  const base = simulatorEstimateQuery(input);

  return `
${base}
| extend Commitment = dynamic(["OnDemand", "1yr", "3yr"])
| extend MonthlyCost = dynamic([MonthlyOnDemand, Monthly1yr, Monthly3yr])
| mv-expand Commitment to typeof(string), MonthlyCost to typeof(real)
| project
    Commitment,
    MonthlyCost = round(MonthlyCost, 2),
    AnnualCost = round(MonthlyCost * 12.0, 2),
    SavingsVsOnDemand = round(MonthlyOnDemand - MonthlyCost, 2)
| order by case(Commitment == "OnDemand", 0, Commitment == "1yr", 1, 2) asc
`;
}
