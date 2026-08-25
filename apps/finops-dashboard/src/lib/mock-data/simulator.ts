import type {
  PriceSource,
  ServiceOption,
  SimulatorEstimate,
  SimulatorInput,
} from "../types";

const MONTHLY_HOURS = 730;

export const mockServiceOptions: ServiceOption[] = [
  {
    label: "Virtual Machines",
    value: "VM",
    supportedRegions: ["brazilsouth", "eastus", "westeurope"],
    defaultSku: "Standard_D2s_v5",
    skus: [
      { sku: "Standard_B2s", unit: "1 Hour", baseHourlyPrice: 0.055 },
      { sku: "Standard_D2s_v5", unit: "1 Hour", baseHourlyPrice: 0.11 },
      { sku: "Standard_D4s_v5", unit: "1 Hour", baseHourlyPrice: 0.22 },
    ],
  },
  {
    label: "Storage",
    value: "Storage",
    supportedRegions: ["brazilsouth", "eastus", "northeurope"],
    defaultSku: "Premium SSD v2",
    skus: [
      { sku: "Standard HDD", unit: "1 GB/Month", baseHourlyPrice: 0.00007 },
      { sku: "Standard SSD", unit: "1 GB/Month", baseHourlyPrice: 0.00016 },
      { sku: "Premium SSD v2", unit: "1 GB/Month", baseHourlyPrice: 0.00028 },
    ],
  },
  {
    label: "SQL Database",
    value: "DB",
    supportedRegions: ["brazilsouth", "eastus2", "westeurope"],
    defaultSku: "General Purpose 2 vCore",
    skus: [
      {
        sku: "General Purpose 2 vCore",
        unit: "1 Hour",
        baseHourlyPrice: 0.504,
      },
      {
        sku: "Business Critical 2 vCore",
        unit: "1 Hour",
        baseHourlyPrice: 1.04,
      },
      { sku: "Serverless 2 vCore", unit: "1 Hour", baseHourlyPrice: 0.42 },
    ],
  },
  {
    label: "Azure Kubernetes Service",
    value: "AKS",
    supportedRegions: ["brazilsouth", "eastus", "westus2"],
    defaultSku: "D4s worker node",
    skus: [
      { sku: "B4ms worker node", unit: "1 Hour", baseHourlyPrice: 0.18 },
      { sku: "D4s worker node", unit: "1 Hour", baseHourlyPrice: 0.28 },
      { sku: "D8s worker node", unit: "1 Hour", baseHourlyPrice: 0.56 },
    ],
  },
];

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export function enrichSimulatorEstimate(
  monthlyOnDemand: number,
  monthly1yr: number,
  monthly3yr: number,
): Pick<
  SimulatorEstimate,
  | "savingsDelta1yr"
  | "savingsDelta3yr"
  | "breakEvenMonths1yr"
  | "breakEvenMonths3yr"
  | "recommendedCommitment"
> {
  const monthlySavings1yr = roundCurrency(monthlyOnDemand - monthly1yr);
  const monthlySavings3yr = roundCurrency(monthlyOnDemand - monthly3yr);

  // Calculate savings percentages
  const savingsDelta1yr = Math.round(
    (monthlySavings1yr / monthlyOnDemand) * 100,
  );
  const savingsDelta3yr = Math.round(
    (monthlySavings3yr / monthlyOnDemand) * 100,
  );

  // Calculate breakeven months
  const breakEvenMonths1yr = monthlySavings1yr > 0 ? 1 : 12;
  const breakEvenMonths3yr = monthlySavings3yr > 0 ? 3 : 36;

  // Recommend commitment
  let recommendedCommitment: "on-demand" | "1-year" | "3-year" = "on-demand";
  if (savingsDelta3yr >= 35 && monthlySavings3yr > monthlySavings1yr + 5) {
    recommendedCommitment = "3-year";
  } else if (savingsDelta1yr >= 20) {
    recommendedCommitment = "1-year";
  }

  return {
    savingsDelta1yr,
    savingsDelta3yr,
    breakEvenMonths1yr,
    breakEvenMonths3yr,
    recommendedCommitment,
  };
}

function getRegionMultiplier(region: string): number {
  const normalized = region.toLowerCase();

  if (normalized.includes("brazil")) {
    return 1.12;
  }

  if (normalized.includes("eastus") || normalized.includes("westus")) {
    return 1.0;
  }

  if (normalized.includes("europe")) {
    return 1.04;
  }

  return 1.03;
}

function findUnitPrice(input: SimulatorInput): number {
  const service = mockServiceOptions.find(
    (option) => option.value === input.service,
  );
  if (!service) {
    return 0;
  }

  const sku = service.skus.find((option) => option.sku === input.sku);
  if (!sku) {
    return 0;
  }

  return sku.baseHourlyPrice;
}

export function generateSimulatorEstimate(
  input: SimulatorInput,
): SimulatorEstimate {
  const qty = Math.max(1, input.qty);
  const regionMultiplier = getRegionMultiplier(input.region);
  const unitPrice = findUnitPrice(input);
  const sourceMultiplier = getSourceMultiplier(input.priceSource);

  const monthlyOnDemand = roundCurrency(
    unitPrice * MONTHLY_HOURS * qty * regionMultiplier * sourceMultiplier,
  );
  const monthly1yr = roundCurrency(monthlyOnDemand * 0.78);
  const monthly3yr = roundCurrency(monthlyOnDemand * 0.61);
  const monthlySavings1yr = roundCurrency(monthlyOnDemand - monthly1yr);
  const monthlySavings3yr = roundCurrency(monthlyOnDemand - monthly3yr);

  // Calculate savings percentages
  const savingsDelta1yr = Math.round(
    (monthlySavings1yr / monthlyOnDemand) * 100,
  );
  const savingsDelta3yr = Math.round(
    (monthlySavings3yr / monthlyOnDemand) * 100,
  );

  // Calculate breakeven months (when monthly savings compensate commitment cost)
  // Assumption: 1-year breaks even in 1 month, 3-year in 3 months
  const breakEvenMonths1yr = monthlySavings1yr > 0 ? 1 : 12;
  const breakEvenMonths3yr = monthlySavings3yr > 0 ? 3 : 36;

  // Recommend commitment based on savings and usage patterns
  let recommendedCommitment: "on-demand" | "1-year" | "3-year" = "on-demand";
  if (savingsDelta3yr >= 35 && monthlySavings3yr > monthlySavings1yr + 5) {
    recommendedCommitment = "3-year";
  } else if (savingsDelta1yr >= 20) {
    recommendedCommitment = "1-year";
  }

  return {
    monthlyOnDemand,
    monthly1yr,
    monthly3yr,
    monthlySavings1yr,
    monthlySavings3yr,
    savingsDelta1yr,
    savingsDelta3yr,
    breakEvenMonths1yr,
    breakEvenMonths3yr,
    recommendedCommitment,
  };
}

function getSourceMultiplier(priceSource?: PriceSource): number {
  if (priceSource === "contract") {
    return 0.92;
  }

  return 1;
}

export const mockDefaultSimulatorInput: SimulatorInput = {
  service: "VM",
  qty: 3,
  region: "brazilsouth",
  sku: "Standard_D2s_v5",
};

export const mockSimulatorEstimate: SimulatorEstimate =
  generateSimulatorEstimate(mockDefaultSimulatorInput);
