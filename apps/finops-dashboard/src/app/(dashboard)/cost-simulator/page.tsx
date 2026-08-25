"use client";

import { useState, useMemo, useEffect } from "react";
import { useCostSimulator } from "@/hooks/useCostSimulator";
import { mockServiceOptions } from "@/lib/mock-data/simulator";
import type {
  PriceSource,
  SimulatorInput,
  SimulatorService,
} from "@/lib/types";
import { KpiCard } from "@/components/KpiCard";
import { LoadingSkeleton, ErrorCard } from "@/components/StatusCards";

const PRICE_SOURCE_STORAGE_KEY = "finops.costSimulator.priceSource";

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(n);
}

export default function CostSimulatorPage() {
  const simulator = useCostSimulator();

  // Form state
  const [selectedService, setSelectedService] = useState<SimulatorService>(
    mockServiceOptions[0]?.value ?? "VM",
  );
  const [qty, setQty] = useState(3);
  const [selectedRegion, setSelectedRegion] = useState("brazilsouth");
  const [selectedSku, setSelectedSku] = useState(
    mockServiceOptions[0]?.skus[1]?.sku ?? "Standard_D2s_v5",
  );
  const [priceSource, setPriceSource] = useState<PriceSource>("retail");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(PRICE_SOURCE_STORAGE_KEY);
      if (stored === "retail" || stored === "contract") {
        setPriceSource(stored);
      }
    } catch {
      // Ignore browser storage failures and keep the in-memory default.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(PRICE_SOURCE_STORAGE_KEY, priceSource);
    } catch {
      // Ignore browser storage failures and continue without persistence.
    }
  }, [priceSource]);

  // Derive available options based on selections
  const serviceOption = useMemo(() => {
    return mockServiceOptions.find((s) => s.value === selectedService);
  }, [selectedService]);

  const validRegions = useMemo(() => {
    return serviceOption?.supportedRegions ?? [];
  }, [serviceOption]);

  const validSkus = useMemo(() => {
    return serviceOption?.skus.map((s) => s.sku) ?? [];
  }, [serviceOption]);

  // Reset region/sku if invalid
  const region = validRegions.includes(selectedRegion)
    ? selectedRegion
    : validRegions[0];
  const sku = validSkus.includes(selectedSku) ? selectedSku : validSkus[0];

  const handleEstimate = () => {
    if (!region || !sku) return;
    simulator.estimate({
      service: selectedService,
      qty,
      region,
      sku,
      priceSource,
    } satisfies SimulatorInput);
  };

  const data = simulator.result;
  const metadata = simulator.metadata;
  const usedContractToRetailFallback =
    metadata?.pricingFallback === "contract_to_retail";
  const recommendationLabel =
    data?.recommendedCommitment === "3-year"
      ? "3-Year Commitment"
      : data?.recommendedCommitment === "1-year"
        ? "1-Year Commitment"
        : "Pay-As-You-Go (On-Demand)";

  const recommendationIcon =
    data?.recommendedCommitment === "3-year"
      ? "🎯"
      : data?.recommendedCommitment === "1-year"
        ? "📅"
        : "💵";

  const recommendationDetail =
    data?.recommendedCommitment === "3-year"
      ? `Save ${data.savingsDelta3yr}% (${fmt(data.monthlySavings3yr)}/month) with break-even in ${data.breakEvenMonths3yr} months`
      : data?.recommendedCommitment === "1-year"
        ? `Save ${data.savingsDelta1yr}% (${fmt(data.monthlySavings1yr)}/month) with break-even in ${data.breakEvenMonths1yr} ${data.breakEvenMonths1yr === 1 ? "month" : "months"}`
        : data
          ? `Best fit for variable or short-term workloads. If usage becomes stable, a 3-year plan may save up to ${fmt(data.monthlySavings3yr)}/month.`
          : "";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white">Cost Simulator</h1>
        <p className="mt-1 text-sm text-slate-400">
          Estimate cloud costs before deploy — compare on-demand, 1-year, and
          3-year commitments
        </p>
      </div>

      {/* Input Section */}
      <div className="rounded-xl border border-white/10 bg-navy-800/60 p-6 backdrop-blur-sm space-y-5">
        <h3 className="text-sm font-semibold text-white">Configuration</h3>

        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400">
            Price Source
          </label>
          <div className="flex rounded-lg border border-white/10 bg-navy-900/80 p-0.5">
            <button
              onClick={() => setPriceSource("retail")}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                priceSource === "retail"
                  ? "bg-sky-500 text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              💲 Retail
            </button>
            <button
              onClick={() => setPriceSource("contract")}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                priceSource === "contract"
                  ? "bg-sky-500 text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              📄 Contract
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {priceSource === "retail"
              ? "Using public list pricing reference."
              : "Using contract/price sheet reference when available."}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-5">
          {/* Service Selector */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">
              Service
            </label>
            <select
              value={selectedService}
              onChange={(e) =>
                setSelectedService(e.target.value as SimulatorService)
              }
              className="w-full px-3 py-2 rounded-lg bg-navy-900 border border-white/10 text-white text-sm focus:outline-none focus:border-sky-500"
            >
              {mockServiceOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Region Selector */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">
              Region
            </label>
            <select
              value={region}
              onChange={(e) => setSelectedRegion(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-navy-900 border border-white/10 text-white text-sm focus:outline-none focus:border-sky-500"
            >
              {validRegions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {/* SKU Selector */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">
              SKU
            </label>
            <select
              value={sku}
              onChange={(e) => setSelectedSku(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-navy-900 border border-white/10 text-white text-sm focus:outline-none focus:border-sky-500"
            >
              {validSkus.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* Quantity Slider */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">
              Quantity: <span className="text-white font-semibold">{qty}</span>
            </label>
            <input
              type="range"
              min="1"
              max="100"
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              className="w-full"
            />
          </div>
        </div>

        {/* Estimate Button */}
        <button
          onClick={handleEstimate}
          disabled={simulator.isLoading || !sku || !region}
          className="w-full px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 disabled:bg-sky-500/50 text-white font-medium text-sm transition-colors"
        >
          {simulator.isLoading ? "Estimating..." : "Calculate Estimate"}
        </button>
      </div>

      {/* Error State */}
      {simulator.error && (
        <ErrorCard message={simulator.error} onRetry={handleEstimate} />
      )}

      {/* Loading State */}
      {simulator.isLoading && (
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <LoadingSkeleton key={i} rows={1} height={100} />
          ))}
        </div>
      )}

      {/* Estimate Results */}
      {data && (
        <>
          {usedContractToRetailFallback && (
            <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-200">
              <p className="font-semibold">Price source fallback applied</p>
              <p className="mt-1 text-amber-100/90">
                {metadata?.pricingNote ??
                  "Contract price was unavailable for this SKU/region. The estimate used retail public pricing instead."}
              </p>
            </div>
          )}

          {/* KPI Cards Row */}
          <div className="grid grid-cols-3 gap-4">
            <KpiCard
              title="On-Demand (Monthly)"
              value={fmt(data.monthlyOnDemand)}
              subtitle="baseline pricing"
              icon="💵"
              accentColor="#64748b"
            />
            <KpiCard
              title="1-Year Commitment (Monthly)"
              value={fmt(data.monthly1yr)}
              subtitle={`save ${fmt(data.monthlySavings1yr)}/mo`}
              icon="📅"
              accentColor="#3b82f6"
            />
            <KpiCard
              title="3-Year Commitment (Monthly)"
              value={fmt(data.monthly3yr)}
              subtitle={`save ${fmt(data.monthlySavings3yr)}/mo`}
              icon="🎯"
              accentColor="#10b981"
            />
          </div>

          {/* Recommendation Card */}
          <div
            className={`rounded-xl border-2 p-6 backdrop-blur-sm ${
              data.recommendedCommitment === "3-year"
                ? "border-emerald-500/30 bg-emerald-500/5"
                : data.recommendedCommitment === "1-year"
                  ? "border-blue-500/30 bg-blue-500/5"
                  : "border-slate-500/30 bg-slate-500/5"
            }`}
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white mb-2">
                  💡 Recommended Plan
                </h3>
                <p className="text-2xl font-bold text-white mb-1">
                  {recommendationLabel}
                </p>
                <p className="text-sm text-slate-400 mb-3">
                  {recommendationDetail}
                </p>
              </div>
              <div
                className={`text-4xl ${
                  data.recommendedCommitment === "3-year"
                    ? "text-emerald-400"
                    : data.recommendedCommitment === "1-year"
                      ? "text-blue-400"
                      : "text-slate-400"
                }`}
              >
                {recommendationIcon}
              </div>
            </div>
          </div>

          {/* Break-Even Timeline */}
          <div className="rounded-xl border border-white/10 bg-navy-800/60 p-6 backdrop-blur-sm">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">
                Break-Even Timeline
              </h3>
              <p className="text-xs text-slate-400">
                Estimated payback point for commitment options
              </p>
            </div>

            <div className="space-y-4">
              {data.recommendedCommitment === "on-demand" && (
                <div className="rounded-lg border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-xs text-sky-300">
                  On-demand is recommended due to flexibility. Break-even is
                  still shown for planning if your usage pattern stabilizes.
                </div>
              )}

              <div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-slate-300">1-Year Commitment</span>
                  <span className="font-semibold text-blue-400">
                    Month {data.breakEvenMonths1yr} / 12
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-2 rounded-full bg-blue-500"
                    style={{
                      width: `${Math.min((data.breakEvenMonths1yr / 12) * 100, 100)}%`,
                    }}
                  />
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-slate-300">3-Year Commitment</span>
                  <span className="font-semibold text-emerald-400">
                    Month {data.breakEvenMonths3yr} / 36
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-2 rounded-full bg-emerald-500"
                    style={{
                      width: `${Math.min((data.breakEvenMonths3yr / 36) * 100, 100)}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Comparison Table */}
          <div className="rounded-xl border border-white/10 bg-navy-800/60 p-6 backdrop-blur-sm">
            <h3 className="text-sm font-semibold text-white mb-4">
              Pricing Comparison
            </h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-3 px-4 font-medium text-slate-400">
                    Commitment Type
                  </th>
                  <th className="text-right py-3 px-4 font-medium text-slate-400">
                    Monthly Cost
                  </th>
                  <th className="text-right py-3 px-4 font-medium text-slate-400">
                    Annual Cost
                  </th>
                  <th className="text-right py-3 px-4 font-medium text-slate-400">
                    Savings vs On-Demand
                  </th>
                  <th className="text-right py-3 px-4 font-medium text-slate-400">
                    Break-Even
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-white/10 hover:bg-white/5">
                  <td className="py-3 px-4 text-slate-300">On-Demand</td>
                  <td className="text-right py-3 px-4 text-white font-semibold">
                    {fmt(data.monthlyOnDemand)}
                  </td>
                  <td className="text-right py-3 px-4 text-white font-semibold">
                    {fmt(data.monthlyOnDemand * 12)}
                  </td>
                  <td className="text-right py-3 px-4 text-slate-400">—</td>
                  <td className="text-right py-3 px-4 text-slate-400">—</td>
                </tr>
                <tr className="border-b border-white/10 hover:bg-white/5 bg-blue-500/5 border-l-4 border-l-blue-500">
                  <td className="py-3 px-4 text-slate-300">
                    1-Year Commitment
                  </td>
                  <td className="text-right py-3 px-4 text-white font-semibold">
                    {fmt(data.monthly1yr)}
                  </td>
                  <td className="text-right py-3 px-4 text-white font-semibold">
                    {fmt(data.monthly1yr * 12)}
                  </td>
                  <td className="text-right py-3 px-4 text-emerald-400 font-semibold">
                    {data.savingsDelta1yr}% ({fmt(data.monthlySavings1yr)}/mo)
                  </td>
                  <td className="text-right py-3 px-4 text-blue-400 font-semibold">
                    {data.breakEvenMonths1yr}{" "}
                    {data.breakEvenMonths1yr === 1 ? "month" : "months"}
                  </td>
                </tr>
                <tr className="border-b border-white/10 hover:bg-white/5 bg-emerald-500/5 border-l-4 border-l-emerald-500">
                  <td className="py-3 px-4 text-slate-300">
                    3-Year Commitment
                  </td>
                  <td className="text-right py-3 px-4 text-white font-semibold">
                    {fmt(data.monthly3yr)}
                  </td>
                  <td className="text-right py-3 px-4 text-white font-semibold">
                    {fmt(data.monthly3yr * 12)}
                  </td>
                  <td className="text-right py-3 px-4 text-emerald-400 font-semibold">
                    {data.savingsDelta3yr}% ({fmt(data.monthlySavings3yr)}/mo)
                  </td>
                  <td className="text-right py-3 px-4 text-emerald-400 font-semibold">
                    {data.breakEvenMonths3yr} months
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Visual Equation */}
          <div className="rounded-xl border border-white/10 bg-navy-800/60 p-6 backdrop-blur-sm">
            <h3 className="text-sm font-semibold text-white mb-4">
              Savings Calculation
            </h3>
            <div className="flex items-center justify-between text-white">
              <div className="text-center">
                <p className="text-xs text-slate-400 mb-1">On-Demand</p>
                <p className="text-2xl font-bold text-slate-300">
                  {fmt(data.monthlyOnDemand)}
                </p>
              </div>
              <div className="text-3xl text-slate-500">−</div>
              <div className="text-center">
                <p className="text-xs text-slate-400 mb-1">1-Year Cost</p>
                <p className="text-2xl font-bold text-slate-300">
                  {fmt(data.monthly1yr)}
                </p>
              </div>
              <div className="text-3xl text-slate-500">=</div>
              <div className="text-center bg-emerald-500/10 rounded-lg p-4 border border-emerald-500/20">
                <p className="text-xs text-slate-400 mb-1">Monthly Savings</p>
                <p className="text-2xl font-bold text-emerald-400">
                  {fmt(data.monthlySavings1yr)}
                </p>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="rounded-xl border border-white/10 bg-navy-800/60 p-6 backdrop-blur-sm">
            <h3 className="text-sm font-semibold text-white mb-3">Notes</h3>
            <ul className="space-y-2 text-sm text-slate-400">
              <li>
                • Pricing is based on the selected region and service tier
              </li>
              <li>
                • Selected price source is applied to the monthly baseline
                calculation
              </li>
              <li>
                • Commitment discounts are estimated at 22% for 1-year and 39%
                for 3-year
              </li>
              <li>
                • Actual pricing may vary based on your Azure contract and
                negotiated rates
              </li>
              <li>• Break-even analysis assumes consistent monthly usage</li>
              <li>
                • Consider Azure Resource Advisor for ongoing optimization
                recommendations
              </li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
