import type {
  AiCostKpi,
  AiCostByModel,
  AiCostDailyPoint,
  AiCostByResource,
  AiAnomalyTimelinePoint,
  AiAnomalyResource,
  AiCostAllocation,
  ApiResponse,
} from "@/lib/types";

export const mockAiCostKpi: ApiResponse<AiCostKpi> = {
  data: {
    totalCost30d: 42850.0,
    costPrevious30d: 38200.0,
    momChangePercent: 12.17,
    resourceCount: 8,
    avgCostPerResource: 5356.25,
    topModel: "gpt-4o-deployment",
    topModelCost: 18400.0,
  },
  metadata: { queriedAt: new Date().toISOString(), isMock: true },
};

export const mockAiCostByModel: ApiResponse<AiCostByModel[]> = {
  data: [
    { resourceName: "gpt-4o-deployment", cost: 18400, percentage: 42.9 },
    { resourceName: "gpt-4-turbo-prod", cost: 9800, percentage: 22.9 },
    { resourceName: "text-embedding-ada-002", cost: 6200, percentage: 14.5 },
    { resourceName: "gpt-35-turbo-chat", cost: 4100, percentage: 9.6 },
    { resourceName: "whisper-transcription", cost: 2350, percentage: 5.5 },
    { resourceName: "dall-e-3-creative", cost: 1200, percentage: 2.8 },
    { resourceName: "gpt-4o-mini-dev", cost: 800, percentage: 1.8 },
  ],
  metadata: { queriedAt: new Date().toISOString(), isMock: true },
};

function generateDailyData(): AiCostDailyPoint[] {
  const points: AiCostDailyPoint[] = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const base = 1200 + Math.random() * 600;
    const spike = i === 7 || i === 12 ? 800 : 0;
    points.push({
      day: d.toISOString().split("T")[0],
      cost: Math.round((base + spike) * 100) / 100,
    });
  }
  return points;
}

export const mockAiCostDaily: ApiResponse<AiCostDailyPoint[]> = {
  data: generateDailyData(),
  metadata: { queriedAt: new Date().toISOString(), isMock: true },
};

export const mockAiCostByResource: ApiResponse<AiCostByResource[]> = {
  data: [
    {
      resourceName: "gpt-4o-deployment",
      resourceGroup: "rg-ai-prod",
      subscriptionName: "Production",
      cost: 18400,
      dailyAvg: 613.33,
      model: "gpt-4o",
    },
    {
      resourceName: "gpt-4-turbo-prod",
      resourceGroup: "rg-ai-prod",
      subscriptionName: "Production",
      cost: 9800,
      dailyAvg: 326.67,
      model: "gpt-4-turbo",
    },
    {
      resourceName: "text-embedding-ada-002",
      resourceGroup: "rg-ai-prod",
      subscriptionName: "Production",
      cost: 6200,
      dailyAvg: 206.67,
      model: "ada-002",
    },
    {
      resourceName: "gpt-35-turbo-chat",
      resourceGroup: "rg-ai-staging",
      subscriptionName: "Staging",
      cost: 4100,
      dailyAvg: 136.67,
      model: "gpt-35-turbo",
    },
    {
      resourceName: "whisper-transcription",
      resourceGroup: "rg-ai-prod",
      subscriptionName: "Production",
      cost: 2350,
      dailyAvg: 78.33,
      model: "whisper",
    },
    {
      resourceName: "dall-e-3-creative",
      resourceGroup: "rg-ai-dev",
      subscriptionName: "Development",
      cost: 1200,
      dailyAvg: 40.0,
      model: "dall-e-3",
    },
    {
      resourceName: "gpt-4o-mini-dev",
      resourceGroup: "rg-ai-dev",
      subscriptionName: "Development",
      cost: 800,
      dailyAvg: 26.67,
      model: "gpt-4o-mini",
    },
  ],
  metadata: { queriedAt: new Date().toISOString(), isMock: true },
};

function generateAnomalyTimeline(): AiAnomalyTimelinePoint[] {
  const points: AiAnomalyTimelinePoint[] = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const baseline = 1400;
    const actual =
      i === 7 ? 3200 : i === 12 ? 2800 : baseline + (Math.random() - 0.5) * 300;
    points.push({
      day: d.toISOString().split("T")[0],
      actualCost: Math.round(actual * 100) / 100,
      baseline,
      anomalyFlag: actual > baseline * 2 ? 1 : 0,
    });
  }
  return points;
}

export const mockAiAnomalyTimeline: ApiResponse<AiAnomalyTimelinePoint[]> = {
  data: generateAnomalyTimeline(),
  metadata: { queriedAt: new Date().toISOString(), isMock: true },
};

export const mockAiAnomalyTopResources: ApiResponse<AiAnomalyResource[]> = {
  data: [
    {
      resourceName: "gpt-4o-deployment",
      consumedService: "Microsoft.CognitiveServices",
      dayCost: 3200,
      baselineCost: 613,
      deviationPercent: 421.9,
    },
    {
      resourceName: "gpt-4-turbo-prod",
      consumedService: "Microsoft.CognitiveServices",
      dayCost: 1800,
      baselineCost: 327,
      deviationPercent: 450.5,
    },
    {
      resourceName: "text-embedding-ada-002",
      consumedService: "Microsoft.CognitiveServices",
      dayCost: 900,
      baselineCost: 207,
      deviationPercent: 334.8,
    },
  ],
  metadata: { queriedAt: new Date().toISOString(), isMock: true },
};

export const mockAiCostAllocation: ApiResponse<AiCostAllocation[]> = {
  data: [
    {
      businessUnit: "Customer Support",
      aiApp: "support-copilot",
      aiModel: "gpt-4o",
      cost: 14200,
      percentage: 33.1,
    },
    {
      businessUnit: "Engineering",
      aiApp: "code-assistant",
      aiModel: "gpt-4-turbo",
      cost: 9800,
      percentage: 22.9,
    },
    {
      businessUnit: "Product",
      aiApp: "search-service",
      aiModel: "ada-002",
      cost: 6200,
      percentage: 14.5,
    },
    {
      businessUnit: "Customer Support",
      aiApp: "voice-bot",
      aiModel: "whisper",
      cost: 4350,
      percentage: 10.1,
    },
    {
      businessUnit: "Marketing",
      aiApp: "content-gen",
      aiModel: "gpt-4o",
      cost: 4200,
      percentage: 9.8,
    },
    {
      businessUnit: "Marketing",
      aiApp: "creative-studio",
      aiModel: "dall-e-3",
      cost: 2300,
      percentage: 5.4,
    },
    {
      businessUnit: "Engineering",
      aiApp: "dev-playground",
      aiModel: "gpt-4o-mini",
      cost: 1800,
      percentage: 4.2,
    },
  ],
  metadata: { queriedAt: new Date().toISOString(), isMock: true },
};
