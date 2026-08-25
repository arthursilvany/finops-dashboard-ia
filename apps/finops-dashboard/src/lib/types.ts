// API response types aligned with CostsPlus table (FOCUS schema)

// --- Cost Summary ---

export interface KpiSummary {
  costLastMonth: number;
  costPreviousMonth: number;
  changePercent: number;
  dailyAverage: number;
  topService: string;
  topServiceCost: number;
  reservationCoverage?: number;
}

export interface CostOverTimePoint {
  month: string;
  cost: number;
}

export interface ServiceBreakdown {
  service: string;
  cost: number;
  percentage: number;
}

export interface SubscriptionCost {
  subscriptionName: string;
  cost: number;
  percentage: number;
}

/** Cost split by cloud provider. Only meaningful on a multicloud dataset. */
export interface ProviderCost {
  providerName: string;
  cost: number;
  percentage: number;
}

export interface DailyCostPoint {
  day: string;
  cost: number;
}

// --- Cost Summary v2 (redesigned dashboard) ---

export interface CostSummaryKpi {
  totalCost30d: number;
  subscriptionCount: number;
  resourceCount: number;
  momChangePercent: number;
  momChangeDelta: number;
  savingsIdentified: number;
  savingsRecommendations: number;
  savingsRealized: number;
  savingsActions: number;
}

export interface MiniKpiGauge {
  label: string;
  value: number;
  target: number;
  targetLabel: string;
  status: "good" | "warning" | "danger";
}

export interface PricingModelBreakdown {
  model: string;
  cost: number;
}

export interface DailyCostByCategory {
  day: string;
  categories: Record<string, number>;
}

export interface ServiceTrendItem {
  service: string;
  cost: number;
  momPercent: number;
}

// --- Rate Optimization ---

export interface CommitmentGapItem {
  service: string;
  onDemandCost: number;
  committedCost: number;
  commitmentCoverage: number;
  /**
   * MODELED, not measured: on-demand spend times a flat 30% assumed commitment
   * discount. A cost export carries no reservation prices, so the real figure
   * cannot be derived from the data — it needs a price sheet. Always present it
   * as an assumption.
   */
  potentialSavings: number;
}

export interface SavingsSummary {
  /** Modeled at a flat 30% discount — see `CommitmentGapItem.potentialSavings`. */
  commitmentGapSavings: number;
  /** Measured from the data: spend on resources that are effectively idle. */
  idleResourceSavings: number;
  /** Mixes the modeled commitment gap with measured idle waste. */
  totalPotentialSavings: number;
}

export interface OptimizationAction {
  action: string;
  category: string;
  potentialMonthlySavings: number;
}

export interface IdleResource {
  resourceName: string;
  consumedService: string;
  subscriptionName: string;
  monthlyCost: number;
  avgDailyCost: number;
  daysActive: number;
}

export interface EffectiveSavingsRateSummary {
  totalSavings: number;
  listCost: number;
  effectiveCost: number;
  effectiveSavingsRate: number;
  /**
   * Spend on commitments that covered nothing (`CommitmentDiscountStatus` =
   * Unused). Pure waste: it has no baseline, so it is excluded from the rate
   * above and surfaced on its own. `null` when the data source does not report
   * it (ADX path).
   */
  unusedCommitmentCost: number | null;
}

export interface EffectiveSavingsRateBreakdownItem {
  month: string;
  listCost: number;
  effectiveCost: number;
  savings: number;
  esr: number;
  /** See `EffectiveSavingsRateSummary.unusedCommitmentCost`. */
  unusedCommitmentCost: number | null;
}

// --- Cost Simulator (E3) ---

export type SimulatorService = "VM" | "Storage" | "DB" | "AKS";

export type SimulatorCommitment = "ondemand" | "1yr" | "3yr";

export type PriceSource = "retail" | "contract";

export interface ServiceSkuOption {
  sku: string;
  unit: string;
  baseHourlyPrice: number;
}

export interface ServiceOption {
  label: string;
  value: SimulatorService;
  supportedRegions: string[];
  defaultSku: string;
  skus: ServiceSkuOption[];
}

export interface SimulatorInput {
  service: SimulatorService;
  qty: number;
  region: string;
  sku: string;
  priceSource?: PriceSource;
  commitment?: SimulatorCommitment;
}

export interface SimulatorEstimate {
  monthlyOnDemand: number;
  monthly1yr: number;
  monthly3yr: number;
  monthlySavings1yr: number;
  monthlySavings3yr: number;
  savingsDelta1yr: number; // percentage savings vs on-demand (22)
  savingsDelta3yr: number; // percentage savings vs on-demand (39)
  breakEvenMonths1yr: number; // months to recoup 1-year commitment
  breakEvenMonths3yr: number; // months to recoup 3-year commitment
  recommendedCommitment: "on-demand" | "1-year" | "3-year";
}

// --- Anomalies ---

export interface AnomalyPoint {
  day: string;
  actualCost: number;
  baseline: number;
  anomalyFlag: number;
  anomalyScore: number;
}

export interface AnomalySummary {
  anomalies7d: number;
  anomalies30d: number;
  largestDeviation: number;
  lastAnomalyDate: string;
}

export interface AnomalyResource {
  consumedService: string;
  resourceName: string;
  dayCost: number;
}

// --- Budgets ---

export interface BudgetBurnRate {
  spentSoFar: number;
  dailyBurnRate: number;
  projectedMonthEnd: number;
  budget: number;
  budgetVariance: number;
  budgetUsedPercent: number;
  /**
   * `NO_BUDGET` is set by the customer POC tier when no budget data is
   * available in the Cost Export. It must never render as "on track".
   */
  status: "ON_TRACK" | "AT_RISK" | "EXCEEDED" | "NO_BUDGET";
}

export interface BudgetVsActualPoint {
  day: string;
  dailyCost: number;
  cumulativeActual: number;
  cumulativeBudget: number;
}

export interface BudgetBySubscription {
  subscriptionName: string;
  cost: number;
  percentOfBudget: number;
}

export interface ForecastPoint {
  day: string;
  dailyCost: number | null;
  dailyForecast: number | null;
  dailyBudgetTarget: number;
}

export interface ForecastConfidencePoint {
  day: string;
  actual: number | null;
  forecast: number;
  lowerBound: number;
  upperBound: number;
}

// --- API wrapper ---

export interface ApiResponse<T> {
  data: T;
  metadata: {
    queriedAt: string;
    isMock: boolean;
    /**
     * Where the numbers came from. `customer` means a Cost Export loaded for a
     * pre-sales POC — real data, but not served from ADX. Absent means `adx`
     * when `isMock` is false and `mock` when it is true.
     */
    dataSource?: "adx" | "customer" | "mock";
    /** Set alongside `dataSource: "customer"`, for the UI badge. */
    customerName?: string;
    /**
     * Which of the SKU Advisor's three sources answered: the live microservice,
     * an export in the customer workspace, or the bundled sample. Only set by
     * the `/api/sku-advisor/*` routes.
     */
    skuAdvisorSource?: "service" | "customer" | "mock";
    /**
     * For `skuAdvisorSource: "service"`: whether the VM inventory behind the
     * recommendations was discovered live or came from the advisor's bundled
     * offline sample. The savings are not comparable between the two.
     */
    skuAdvisorInventory?: "live" | "offline";
    /**
     * For `skuAdvisorSource: "service"`: whether rightsizing was guided by a
     * live 90-day P99 CPU/memory/IOPS busy-signal from Azure Monitor, or fell
     * back to spec-parity sizing alone because telemetry was not requested or
     * was refused by the advisor.
     */
    skuAdvisorTelemetry?: "live" | "unavailable";
    /** When the advisor produced the payload, as reported by the payload. */
    generatedAt?: string;
    priceSourceRequested?: PriceSource;
    priceSourceApplied?: PriceSource;
    pricingFallback?: "none" | "contract_to_retail";
    pricingNote?: string;
  };
}

// --- Filters ---

export interface TagFilter {
  key: string;
  values: string[];
}

export interface FilterState {
  dateFrom: string;
  dateTo: string;
  /** Cloud providers. Empty means "all providers". */
  providers: string[];
  subscriptions: string[];
  regions: string[];
  services: string[];
  resourceGroups: string[];
  tags: TagFilter[];
  currency: "billing" | "usd";
}

export interface FilterOptions {
  /** Providers present in the data. One entry means a single-cloud dataset. */
  providers: string[];
  subscriptions: string[];
  regions: string[];
  services: string[];
  resourceGroups: string[];
  tagKeys: string[];
}

export const DEFAULT_FILTERS: FilterState = {
  dateFrom: "",
  dateTo: "",
  providers: [],
  subscriptions: [],
  regions: [],
  services: [],
  resourceGroups: [],
  tags: [],
  currency: "billing",
};

// --- Reservation / Commitment Detail ---

export interface ReservationRow {
  [key: string]: unknown;
  commitmentName: string;
  commitmentId: string;
  commitmentType: string; // "Reservation" | "SavingsPlan"
  term: string;
  resourceType: string;
  upfrontPaid: number;
  consumed: number;
  used: number;
  unused: number;
  utilization: number;
  days: number;
}

export interface ReservationTrendPoint {
  month: string;
  used: number;
  unused: number;
}

export interface ReservationFilterOptions {
  commitmentNames: string[];
  resourceTypes: string[];
  commitmentTypes: string[];
}

// --- Dashboard params ---

export interface DashboardParams {
  monthlyBudget: number;
  numberOfMonths: number;
  numberOfDays: number;
  maxGroupCount: number;
}

// --- Workload ---

export interface WorkloadKpi {
  totalVMs: number;
  rightsizingCandidates: number;
  potentialMonthlySavings: number;
  avgCpuUtilization: number;
}

export interface CpuCostPoint {
  name: string;
  cpuAvg: number;
  monthlyCost: number;
  service: string;
}

export interface RightsizingRow {
  resourceName: string;
  resourceGroup: string;
  subscriptionName: string;
  currentSku: string;
  recommendedSku: string;
  cpuAvg: number;
  currentCost: number;
  projectedCost: number;
  monthlySavings: number;
}

// --- Governance ---

export interface GovernanceKpi {
  overallCompliance: number;
  taggedResources: number;
  totalResources: number;
  policiesActive: number;
  /** Per-tag coverage, so a single unused tag does not read as zero governance. */
  tagCoverage: TagCoverage[];
}

export interface TagComplianceBar {
  subscriptionName: string;
  compliancePct: number;
  total: number;
  /**
   * Coverage of each required tag on its own, as a percentage of rows.
   *
   * `compliancePct` demands every required tag at once, so a single tag the
   * customer does not use drags it to zero and the chart reads as "nothing is
   * tagged". Reporting each tag separately shows which one is actually missing
   * instead of hiding a real 75% behind a 0%.
   */
  tagCoverage: TagCoverage[];
}

export interface TagCoverage {
  tag: string;
  /** Percentage of rows carrying the tag. */
  pct: number;
  /** Percentage of cost carrying the tag. Spend is what a FinOps owner acts on. */
  costPct: number;
}

export interface BudgetVsActualBar {
  subscriptionName: string;
  budget: number;
  actual: number;
  variance: number;
}

// --- Chargeback ---

export interface ChargebackKpi {
  totalAllocated: number;
  untaggedCost: number;
  businessUnits: number;
  topBU: string;
}

export interface ChargebackByBU {
  businessUnit: string;
  cost: number;
  percentage: number;
}

export interface ChargebackTrendPoint {
  month: string;
  [bu: string]: number | string;
}

// --- AI Insights ---

export interface AiInsight {
  id: string;
  title: string;
  summary: string;
  impact: "high" | "medium" | "low";
  category: string;
  savingsEstimate?: number;
  resourceCount?: number;
}

export interface AiInsightsCost {
  categories: string[];
  actual: (number | null)[];
  forecast: number[];
  lowerBound: number[];
  upperBound: number[];
}

export interface AiRadarDataset {
  indicators: { name: string; max: number }[];
  series: { name: string; values: number[]; color?: string }[];
}

// --- Remediation Impact ---

export interface RemediationAiInsight {
  downtimeRisk: string;
  confidence: number;
  confidenceLabel: string;
  contextWarning: string;
  riskIfNotRemediated: string;
  sourceReferences?: { title: string; url: string }[];
}

export interface RemediationCard {
  id: string;
  resourceType: string;
  resourceName: string;
  resourceGroup: string;
  region: string;
  recommendation: string;
  description: string;
  category: "Reliability" | "Security";
  impact: "high" | "medium" | "low";
  tags: string[];
  factTags: string[];
  aiInsight: RemediationAiInsight | null;
  remediationCostMonthly: number;
  remediationCostAnnual: number;
  advisorOffsetMonthly: number;
  advisorOffsetAnnual: number;
  netMonthly: number;
  costSource: "pricesheet" | "mcp" | "retail-api" | "estimate";
}

export interface RemediationSummary {
  totalSavingsMonthly: number;
  totalSavingsAnnual: number;
  reliabilityCostMonthly: number;
  reliabilityCostAnnual: number;
  reliabilitySources: string[];
  securityCostMonthly: number;
  securityCostAnnual: number;
  securitySources: string[];
  totalRemediationMonthly: number;
  totalRemediationAnnual: number;
  netImpactMonthly: number;
  netImpactAnnual: number;
  zeroCostCount: number;
  currency: string;
}

export interface KpiSummaryWithReservation extends KpiSummary {
  reservationCoverage: number;
}

// --- Agentic FinOps ---

export type AgenticStage =
  | "detect"
  | "analyze"
  | "decide"
  | "ready"
  | "pending-approval";

export type AgenticRiskLevel = "low" | "medium" | "high";

export interface AgenticRecommendation {
  id: string;
  resourceId: string;
  resourceName: string;
  resourceType: string;
  resourceGroup: string;
  subscriptionName: string;
  impact: "high" | "medium" | "low";
  title: string;
  description: string;
  solution: string;
  potentialSavings: number;
  agenticStage: AgenticStage;
  riskLevel: AgenticRiskLevel;
  confidenceScore: number;
  requiresApproval: boolean;
  actionType: string;
  recommendationCategory: string;
}

export interface AgenticSummary {
  totalRecommendations: number;
  totalPotentialSavings: number;
  readyForAction: number;
  pendingApproval: number;
  byRisk: { low: number; medium: number; high: number };
  byCategory: Record<string, number>;
  byStage: Record<AgenticStage, number>;
}

// --- Execution Engine (E1 — Automated Remediation) ---

export type RemediationAction =
  | "stop_vm"
  | "resize_vm"
  | "delete_disk"
  | "delete_ip"
  | "change_sku";

export interface ExecutionRequest {
  recommendationId: string;
  action: RemediationAction;
  resourceId: string;
  resourceName: string;
  dryRun?: boolean;
}

export interface ExecutionResult {
  executionId: string;
  status: "success" | "failed" | "rolled_back" | "dry_run";
  action: RemediationAction;
  resourceId: string;
  resourceName: string;
  beforeCost: number;
  estimatedAfterCost: number;
  executedAt: string;
  executedBy: string;
  message: string;
  rollbackStatus?: "none" | "pending" | "completed" | "failed";
}

export interface ExecutionLogEntry {
  [key: string]: unknown;
  executionId: string;
  resourceId: string;
  resourceName: string;
  action: RemediationAction;
  beforeCost: number;
  afterCost: number;
  status: "success" | "failed" | "rolled_back";
  executedBy: string;
  timestamp: string;
  recommendationId: string;
  rollbackStatus: string;
}

export interface ExecutionSavingsKpi {
  totalRealizedSavings: number;
  totalEstimatedSavings: number;
  accuracyPercent: number;
  executionsCount: number;
  successCount: number;
  failedCount: number;
}

export interface ExecutionSavingsRow {
  resourceId: string;
  resourceName: string;
  action: RemediationAction;
  beforeCost: number;
  estimatedAfterCost: number;
  actualAfterCost: number;
  estimatedSavings: number;
  actualSavings: number;
  accuracy: number;
}

export type PreConditionStatus = "pass" | "warn" | "block";

export interface PreConditionCheck {
  check: string;
  status: PreConditionStatus;
  message: string;
}

export interface PreConditionResult {
  canProceed: boolean;
  checks: PreConditionCheck[];
  blockedReason?: string;
}

// --- AI Cost Observability (E2) ---

export interface AiCostKpi {
  totalCost30d: number;
  costPrevious30d: number;
  momChangePercent: number;
  resourceCount: number;
  avgCostPerResource: number;
  topModel: string;
  topModelCost: number;
}

export interface AiCostByModel {
  resourceName: string;
  cost: number;
  percentage: number;
}

export interface AiCostDailyPoint {
  day: string;
  cost: number;
}

export interface AiCostByResource {
  resourceName: string;
  resourceGroup: string;
  subscriptionName: string;
  cost: number;
  dailyAvg: number;
  model: string;
}

export interface AiAnomalyTimelinePoint {
  day: string;
  actualCost: number;
  baseline: number;
  anomalyFlag: number;
}

export interface AiAnomalyResource {
  resourceName: string;
  consumedService: string;
  dayCost: number;
  baselineCost: number;
  deviationPercent: number;
}

export interface AiCostAllocation {
  businessUnit: string;
  aiApp: string;
  aiModel: string;
  cost: number;
  percentage: number;
}
