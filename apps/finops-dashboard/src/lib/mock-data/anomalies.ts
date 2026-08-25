import type { AnomalyPoint, AnomalySummary, AnomalyResource } from "../types";

function generateAnomalyTimeline(): AnomalyPoint[] {
  const result: AnomalyPoint[] = [];
  const now = new Date();
  for (let i = 89; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const baseline = 9200 + Math.sin(i / 7) * 800;
    const noise = (Math.random() - 0.5) * 1200;
    let spike = 0;
    let flag = 0;
    let score = 0;
    if (i === 72 || i === 45 || i === 18 || i === 5) {
      spike = 4000 + Math.random() * 3000;
      flag = 1;
      score = 2.5 + Math.random() * 2;
    }
    if (i === 60) {
      spike = -3500;
      flag = -1;
      score = -(2.0 + Math.random());
    }
    const actual = Math.round((baseline + noise + spike) * 100) / 100;
    result.push({
      day: d.toISOString().split("T")[0],
      actualCost: Math.max(actual, 0),
      baseline: Math.round(baseline * 100) / 100,
      anomalyFlag: flag,
      anomalyScore: Math.round(score * 100) / 100,
    });
  }
  return result;
}

export const mockAnomalyTimeline: AnomalyPoint[] = generateAnomalyTimeline();

export const mockAnomalySummary: AnomalySummary = {
  anomalies7d: 1,
  anomalies30d: 3,
  largestDeviation: 6842.31,
  lastAnomalyDate: new Date(Date.now() - 5 * 86400000)
    .toISOString()
    .split("T")[0],
};

export const mockAnomalyTopResources: AnomalyResource[] = [
  {
    consumedService: "Virtual Machines",
    resourceName: "vm-batch-processor",
    dayCost: 4250.0,
  },
  {
    consumedService: "Cosmos DB",
    resourceName: "cosmos-analytics-hot",
    dayCost: 2180.5,
  },
  {
    consumedService: "SQL Database",
    resourceName: "sql-reporting-prod",
    dayCost: 1850.0,
  },
  {
    consumedService: "Kubernetes Service",
    resourceName: "aks-ml-cluster",
    dayCost: 1420.3,
  },
  {
    consumedService: "Storage",
    resourceName: "st-datalake-ingestion",
    dayCost: 980.0,
  },
  {
    consumedService: "App Service",
    resourceName: "app-api-gateway",
    dayCost: 720.5,
  },
  {
    consumedService: "Azure Functions",
    resourceName: "func-event-processor",
    dayCost: 540.2,
  },
];
