import type {
  ChargebackKpi,
  ChargebackByBU,
  ChargebackTrendPoint,
} from "@/lib/types";
import type { ApiResponse } from "@/lib/types";

export const mockChargebackKpi: ApiResponse<ChargebackKpi> = {
  data: {
    totalAllocated: 2210000,
    untaggedCost: 154700,
    businessUnits: 7,
    topBU: "Engineering",
  },
  metadata: { queriedAt: new Date().toISOString(), isMock: true },
};

export const mockChargebackByBU: ApiResponse<ChargebackByBU[]> = {
  data: [
    { businessUnit: "Engineering",  cost: 842000,  percentage: 38.1 },
    { businessUnit: "Data & AI",    cost: 530400,  percentage: 24.0 },
    { businessUnit: "Platform",     cost: 375700,  percentage: 17.0 },
    { businessUnit: "Security",     cost: 220800,  percentage: 10.0 },
    { businessUnit: "Finance",      cost: 132600,  percentage: 6.0  },
    { businessUnit: "Marketing",    cost: 108500,  percentage: 4.9  },
  ],
  metadata: { queriedAt: new Date().toISOString(), isMock: true },
};

export const mockChargebackTrend: ApiResponse<ChargebackTrendPoint[]> = {
  data: [
    { month: "Oct/24", Engineering: 760000, "Data & AI": 490000, Platform: 340000, Security: 200000, Finance: 118000, Marketing: 98000 },
    { month: "Nov/24", Engineering: 800000, "Data & AI": 510000, Platform: 358000, Security: 208000, Finance: 124000, Marketing: 103000 },
    { month: "Dec/24", Engineering: 830000, "Data & AI": 520000, Platform: 368000, Security: 215000, Finance: 128000, Marketing: 106000 },
    { month: "Jan/25", Engineering: 842000, "Data & AI": 530400, Platform: 375700, Security: 220800, Finance: 132600, Marketing: 108500 },
  ],
  metadata: { queriedAt: new Date().toISOString(), isMock: true },
};
