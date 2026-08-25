import type {
  BudgetBurnRate,
  BudgetVsActualPoint,
  BudgetBySubscription,
  ForecastPoint,
  ForecastConfidencePoint,
} from "../types";

export function mockBudgetBurnRate(budget: number): BudgetBurnRate {
  const dayOfMonth = new Date().getDate();
  const daysInMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth() + 1,
    0,
  ).getDate();
  const spent =
    budget *
    0.38 *
    (dayOfMonth / daysInMonth) *
    (1 + (Math.random() - 0.5) * 0.1);
  const dailyRate = spent / Math.max(dayOfMonth, 1);
  const projected = dailyRate * daysInMonth;
  return {
    spentSoFar: Math.round(spent * 100) / 100,
    dailyBurnRate: Math.round(dailyRate * 100) / 100,
    projectedMonthEnd: Math.round(projected * 100) / 100,
    budget,
    budgetVariance: Math.round((projected - budget) * 100) / 100,
    budgetUsedPercent: Math.round((spent / budget) * 10000) / 100,
    status: projected > budget ? "AT_RISK" : "ON_TRACK",
  };
}

export function mockBudgetVsActual(budget: number): BudgetVsActualPoint[] {
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
  ).getDate();
  const dailyBudget = budget / daysInMonth;
  const result: BudgetVsActualPoint[] = [];
  let cumulative = 0;
  for (let d = 1; d <= dayOfMonth; d++) {
    const date = new Date(now.getFullYear(), now.getMonth(), d);
    const daily = dailyBudget * (0.85 + Math.random() * 0.3);
    cumulative += daily;
    result.push({
      day: date.toISOString().split("T")[0],
      dailyCost: Math.round(daily * 100) / 100,
      cumulativeActual: Math.round(cumulative * 100) / 100,
      cumulativeBudget: Math.round(dailyBudget * d * 100) / 100,
    });
  }
  return result;
}

export const mockBudgetBySubscription: BudgetBySubscription[] = [
  { subscriptionName: "Production-Core", cost: 1925.4, percentOfBudget: 19.3 },
  { subscriptionName: "Production-Data", cost: 1280.2, percentOfBudget: 12.8 },
  { subscriptionName: "Staging", cost: 640.1, percentOfBudget: 6.4 },
  { subscriptionName: "Development", cost: 420.8, percentOfBudget: 4.2 },
  { subscriptionName: "Sandbox", cost: 110.0, percentOfBudget: 1.1 },
];

export function mockForecastVsBudget(budget: number): ForecastPoint[] {
  const now = new Date();
  const daysInMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
  ).getDate();
  const dailyBudget = budget / daysInMonth;
  const result: ForecastPoint[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(now.getFullYear(), now.getMonth(), d);
    const isActual = d <= now.getDate();
    const dailyCost = isActual
      ? Math.round(dailyBudget * (0.85 + Math.random() * 0.3) * 100) / 100
      : null;
    const dailyForecast = !isActual
      ? Math.round(dailyBudget * (0.9 + Math.random() * 0.2) * 100) / 100
      : null;
    result.push({
      day: date.toISOString().split("T")[0],
      dailyCost,
      dailyForecast,
      dailyBudgetTarget: Math.round(dailyBudget * 100) / 100,
    });
  }
  return result;
}

export function mockForecastConfidence(): ForecastConfidencePoint[] {
  const now = new Date();
  const result: ForecastConfidencePoint[] = [];
  for (let i = -14; i <= 30; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    const base = 9200 + Math.sin((i + 14) / 7) * 600;
    const isActual = i <= 0;
    const spread = Math.abs(i) * 120;
    result.push({
      day: d.toISOString().split("T")[0],
      actual: isActual
        ? Math.round((base + (Math.random() - 0.5) * 800) * 100) / 100
        : null,
      forecast: Math.round(base * 100) / 100,
      lowerBound: Math.round((base - spread) * 100) / 100,
      upperBound: Math.round((base + spread) * 100) / 100,
    });
  }
  return result;
}
