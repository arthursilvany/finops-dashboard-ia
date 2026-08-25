"use client";

import { useState, useRef, useCallback } from "react";
import {
  usePricingQuery,
  useFileUpload,
  useRiComparison,
  type PriceSource,
  type Environment,
  type RiCompareRow,
  type RiCompareResult,
} from "@/hooks/useAzurePricing";

type ActiveTab = "query" | "ri-sp";

const quickQueries = [
  "Virtual Machines Standard_D4s_v5 brazilsouth",
  "Azure SQL Database vCore General Purpose",
  "Storage Account Standard_LRS brazilsouth",
  "App Service Plan P1v3",
  "Azure Kubernetes Service",
  "Cosmos DB Request Units",
  "Reserved Instance Virtual Machines Standard_D4s_v5 brazilsouth",
  "Savings Plan Azure SQL Database vCore",
];

export default function AzurePricingPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("query");
  const [priceSource, setPriceSource] = useState<PriceSource>("retail");
  const [environment, setEnvironment] = useState<Environment>("production");
  const [queryText, setQueryText] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pricing = usePricingQuery();
  const fileUpload = useFileUpload();
  const riComparison = useRiComparison();

  const handleSearch = useCallback(
    (text?: string) => {
      const q = text ?? queryText;
      if (!q.trim() && !fileUpload.skuList) return;

      pricing.query({
        priceSource,
        environment,
        query: q.trim(),
        skuList: fileUpload.skuList ?? undefined,
      });
    },
    [queryText, priceSource, environment, fileUpload.skuList, pricing],
  );

  const handleFileSelect = useCallback(
    async (file: File) => {
      const skus = await fileUpload.upload(file);
      if (skus && skus.length > 0) {
        pricing.query({
          priceSource,
          environment,
          query: `Pricing for ${skus.length} SKUs from uploaded file`,
          skuList: skus,
        });
      }
    },
    [priceSource, environment, fileUpload, pricing],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white">Azure Pricing</h1>
        <p className="mt-1 text-sm text-slate-400">
          Query Azure service prices — retail or contract — with AI-powered
          analysis
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-white/10 bg-navy-800/60 p-1">
        <button
          onClick={() => setActiveTab("query")}
          className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "query"
              ? "bg-sky-500 text-white shadow-sm"
              : "text-slate-400 hover:text-white"
          }`}
        >
          🔍 Free Query
        </button>
        <button
          onClick={() => setActiveTab("ri-sp")}
          className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "ri-sp"
              ? "bg-violet-500 text-white shadow-sm"
              : "text-slate-400 hover:text-white"
          }`}
        >
          📊 RI/SP Simulation
        </button>
      </div>

      {/* Filters (only for Free Query tab) */}
      {activeTab === "query" && (
        <>
          {/* Filters */}
          <div className="rounded-xl border border-white/10 bg-navy-800 p-5">
            <div className="flex flex-wrap items-center gap-6">
              {/* Price Source Toggle */}
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
              </div>

              {/* Environment Toggle */}
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400">
                  Environment
                </label>
                <div className="flex rounded-lg border border-white/10 bg-navy-900/80 p-0.5">
                  <button
                    onClick={() => setEnvironment("production")}
                    className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                      environment === "production"
                        ? "bg-emerald-500 text-white shadow-sm"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    🏢 Production
                  </button>
                  <button
                    onClick={() => setEnvironment("non-production")}
                    className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                      environment === "non-production"
                        ? "bg-amber-500 text-white shadow-sm"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    🧪 Non-Production
                  </button>
                </div>
              </div>

              {/* Info badge */}
              <div className="ml-auto hidden sm:block">
                <div className="rounded-lg bg-white/5 px-3 py-2 text-xs text-slate-400">
                  {priceSource === "retail" ? (
                    <span>🌐 Microsoft public pricing API</span>
                  ) : (
                    <span>🔒 EA/MCA prices from FinOps Hub</span>
                  )}
                  {environment === "non-production" && (
                    <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-300">
                      Dev/Test
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Phase 1: EA Price Sheet Context Card — shown when contract source is selected */}
            {priceSource === "contract" && <PriceSourceContextCard />}
            {/* Search Bar */}
            <div className="mt-4 flex gap-3">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={queryText}
                  onChange={(e) => setQueryText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder="Ex: Virtual Machines Standard_D4s_v5 brazilsouth..."
                  className="w-full rounded-lg border border-white/10 bg-navy-900/80 px-4 py-3 pr-10 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/20"
                />
                <svg
                  className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </div>
              <button
                onClick={() => handleSearch()}
                disabled={
                  pricing.isLoading ||
                  (!queryText.trim() && !fileUpload.skuList)
                }
                className="flex items-center gap-2 rounded-lg bg-sky-500 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-sky-400 disabled:opacity-50"
              >
                {pricing.isLoading ? (
                  <>
                    <Spinner /> Consultando...
                  </>
                ) : (
                  "Consultar"
                )}
              </button>
            </div>

            {/* Quick Queries */}
            <div className="mt-3 flex flex-wrap gap-2">
              {quickQueries.map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    setQueryText(q);
                    handleSearch(q);
                  }}
                  disabled={pricing.isLoading}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-400 transition-colors hover:border-sky-500/30 hover:text-sky-300 disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* File Upload Zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
              isDragOver
                ? "border-sky-500 bg-sky-500/5"
                : "border-white/10 bg-navy-800/50 hover:border-white/20"
            }`}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelect(file);
                e.target.value = "";
              }}
            />

            {fileUpload.isUploading ? (
              <div className="flex items-center justify-center gap-2 text-sky-400">
                <Spinner /> Processing file...
              </div>
            ) : fileUpload.skuList ? (
              <div className="flex items-center justify-center gap-3">
                <span className="text-emerald-400">✓</span>
                <span className="text-sm text-slate-300">
                  <strong className="text-white">{fileUpload.fileName}</strong>{" "}
                  — {fileUpload.skuList.length} SKUs detected
                </span>
                <button
                  onClick={() => fileUpload.clear()}
                  className="ml-2 rounded bg-white/5 px-2 py-1 text-xs text-slate-400 hover:text-white"
                >
                  Clear
                </button>
              </div>
            ) : (
              <div>
                <div className="mb-2 text-2xl">📁</div>
                <p className="text-sm text-slate-300">
                  Drag a CSV/TSV file or{" "}
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="text-sky-400 underline underline-offset-2 hover:text-sky-300"
                  >
                    select from your computer
                  </button>
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Maximum 50 SKUs • 512KB • Columns detected automatically
                  (SKU, ServiceName, etc.)
                </p>
              </div>
            )}
          </div>

          {/* Errors */}
          {(pricing.error || fileUpload.error) && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              ⚠️ {pricing.error || fileUpload.error}
            </div>
          )}

          {/* Results Area */}
          {pricing.isLoading && !pricing.result && (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-navy-800 p-12">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-500/10">
                <svg
                  className="h-8 w-8 animate-spin text-sky-400"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              </div>
              <p className="mt-4 text-sm font-medium text-white">
                Querying prices...
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {priceSource === "retail"
                  ? "Querying the Microsoft pricing API..."
                  : "Querying contract prices in ADX..."}
              </p>
            </div>
          )}

          {pricing.result && (
            <div>
              <div className="mb-3 flex items-center gap-3 text-xs text-slate-500">
                <span className="rounded bg-white/5 px-2 py-1">
                  {pricing.result.priceSource === "retail"
                    ? "💲 Retail"
                    : "📄 Contract"}
                </span>
                <span className="rounded bg-white/5 px-2 py-1">
                  {pricing.result.environment === "production"
                    ? "🏢 Production"
                    : "🧪 Non-Production"}
                </span>
                {pricing.result.usage && (
                  <span className="ml-auto">
                    Tokens: {pricing.result.usage.total_tokens.toLocaleString()}
                  </span>
                )}
              </div>
              <ResultRenderer content={pricing.result.content} />
            </div>
          )}
        </>
      )}

      {/* Phase 2: RI/SP Comparison Panel */}
      {activeTab === "ri-sp" && (
        <RiComparisonPanel riComparison={riComparison} />
      )}
    </div>
  );
}

/* ── Phase 1: EA Price Sheet vs Calculator Context Card ─────── */

function PriceSourceContextCard() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-amber-400">⚠️</span>
          <span className="text-sm font-semibold text-amber-300">
            EA Price Sheet vs Azure Pricing Calculator
          </span>
        </div>
        <span className="text-xs text-slate-500">
          {expanded ? "▲ Collapse" : "▼ Learn more"}
        </span>
      </button>

      {expanded && (
        <div className="mt-4 space-y-4 text-sm text-slate-300">
          <p>
            When you select <strong className="text-white">Contract</strong>,
            prices are read from the EA Price Sheet — the{" "}
            <strong className="text-white">
              only valid source for financial governance and auditing
            </strong>
            . The Azure Calculator serves a different purpose.
          </p>

          {/* Risk callout */}
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-red-400">
              Risk: silent fallback to retail pricing
            </p>
            <p className="mt-1 text-xs text-slate-400">
              When you use Azure Pricing Calculator while signed into EA and
              query a SKU that does not exist in the contract, it{" "}
              <strong className="text-white">
                does not warn and does not fail — it silently applies the list
                price (retail)
              </strong>
              . This can generate incorrect estimates that do not reflect the
              actual contract price.
            </p>
          </div>

          {/* Decision table */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              When to use each tool
            </p>
            <div className="overflow-x-auto rounded-lg border border-white/10">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-white/[0.04]">
                    <th className="px-3 py-2 text-left font-semibold uppercase tracking-wider text-slate-400">
                      Scenario
                    </th>
                    <th className="px-3 py-2 text-center font-semibold uppercase tracking-wider text-slate-400">
                      Calculator
                    </th>
                    <th className="px-3 py-2 text-center font-semibold uppercase tracking-wider text-slate-400">
                      Price Sheet
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {[
                    ["Architecture / pre-project", "✅", "—"],
                    ["Initial business case", "✅", "—"],
                    ["Approved budget / forecast", "—", "✅"],
                    ["Chargeback / Showback", "—", "✅"],
                    ["Audit / contract", "—", "✅"],
                  ].map(([label, calc, ps]) => (
                    <tr key={label} className="hover:bg-white/[0.02]">
                      <td className="px-3 py-2 text-slate-300">{label}</td>
                      <td className="px-3 py-2 text-center text-slate-400">
                        {calc}
                      </td>
                      <td className="px-3 py-2 text-center text-emerald-400">
                        {ps}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Key quote */}
          <blockquote className="border-l-2 border-amber-500/50 pl-3 italic text-slate-400">
            &ldquo;The calculator answers &apos;what could this cost?&apos;.
            The Price Sheet answers &apos;what will this actually cost?&apos;.&rdquo;
          </blockquote>
        </div>
      )}
    </div>
  );
}

/* ── Phase 2: RI/SP Comparison Panel ────────────────────────── */

const recBadge: Record<string, string> = {
  Strong: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
  Moderate: "bg-amber-500/10 text-amber-300 border-amber-500/20",
  Weak: "bg-white/5 text-slate-400 border-white/10",
  "—": "bg-white/5 text-slate-500 border-white/10",
};

function RiComparisonPanel({
  riComparison,
}: {
  riComparison: ReturnType<typeof useRiComparison>;
}) {
  const [serviceName, setServiceName] = useState("");
  const [skuName, setSkuName] = useState("");
  const [region, setRegion] = useState("");

  const handleCompare = () => {
    if (!serviceName.trim()) return;
    riComparison.compare({
      service_name: serviceName.trim(),
      sku_name: skuName.trim() || undefined,
      region: region.trim() || undefined,
    });
  };

  const fmt = (v: number | null, decimals = 2) =>
    v !== null ? `$${v.toFixed(decimals)}` : "—";

  return (
    <div className="space-y-5">
      {/* Explainer */}
      <div className="rounded-xl border border-white/10 bg-navy-800 p-5">
        <div className="mb-4 flex items-start gap-3">
          <span className="text-2xl">📊</span>
          <div>
            <p className="text-sm font-semibold text-white">
              ROI Simulation — Reserved Instances &amp; Savings Plans
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              Compare PAYG vs RI 1 Year vs RI 3 Years with savings and payback
              calculations. Data comes from Azure Retail Prices API with
              discount applied.
            </p>
          </div>
        </div>

        {/* Inputs */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              Service <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCompare()}
              placeholder="Ex: Virtual Machines"
              className="w-full rounded-lg border border-white/10 bg-navy-900/80 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              SKU (optional)
            </label>
            <input
              type="text"
              value={skuName}
              onChange={(e) => setSkuName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCompare()}
              placeholder="Ex: Standard_D4s_v5"
              className="w-full rounded-lg border border-white/10 bg-navy-900/80 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              Region (optional)
            </label>
            <input
              type="text"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCompare()}
              placeholder="Ex: brazilsouth"
              className="w-full rounded-lg border border-white/10 bg-navy-900/80 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={handleCompare}
            disabled={riComparison.isLoading || !serviceName.trim()}
            className="flex items-center gap-2 rounded-lg bg-violet-500 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-violet-400 disabled:opacity-50"
          >
            {riComparison.isLoading ? (
              <>
                <Spinner /> Calculando...
                <Spinner /> Calculating...
              </>
            ) : (
              "Compare"
            )}
          </button>
          {riComparison.result && (
            <button
              onClick={riComparison.clear}
              className="rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-400 hover:text-white"
            >
              Clear
            </button>
          )}
          {/* Quick example chips */}
          <div className="ml-auto flex flex-wrap gap-2">
            {[
              {
                label: "VMs D4s_v5",
                svc: "Virtual Machines",
                sku: "Standard_D4s_v5",
              },
              { label: "SQL vCore", svc: "SQL Database", sku: "" },
              { label: "AKS", svc: "Azure Kubernetes Service", sku: "" },
            ].map((ex) => (
              <button
                key={ex.label}
                onClick={() => {
                  setServiceName(ex.svc);
                  setSkuName(ex.sku);
                  riComparison.compare({
                    service_name: ex.svc,
                    sku_name: ex.sku || undefined,
                  });
                }}
                disabled={riComparison.isLoading}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-400 transition-colors hover:border-violet-500/30 hover:text-violet-300 disabled:opacity-50"
              >
                {ex.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Error */}
      {riComparison.error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          ⚠️ {riComparison.error}
        </div>
      )}

      {/* Loading */}
      {riComparison.isLoading && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-navy-800 p-12">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500/10">
            <svg
              className="h-8 w-8 animate-spin text-violet-400"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          </div>
          <p className="mt-4 text-sm font-medium text-white">
            Calculating RI/SP scenarios...
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Querying 1 Year and 3 Year prices in parallel
          </p>
        </div>
      )}

      {/* Results Table */}
      {riComparison.result && !riComparison.isLoading && (
        <RiResultTable result={riComparison.result} fmt={fmt} />
      )}
    </div>
  );
}

function RiResultTable({
  result,
  fmt,
}: {
  result: RiCompareResult;
  fmt: (v: number | null, decimals?: number) => string;
}) {
  const hasData = result.rows.some((r) => r.monthly_cost !== null);
  const payg = result.rows.find((r) => r.mode === "PAYG (On-demand)");

  return (
    <div className="rounded-xl border border-white/10 bg-navy-800 overflow-hidden">
      {/* Header */}
      <div className="border-b border-white/10 bg-white/[0.02] px-5 py-3 flex items-center justify-between">
        <div>
          <span className="text-sm font-semibold text-white">
            {result.service_name}
            {result.sku_name && (
              <span className="ml-2 text-slate-400 font-normal text-xs">
                {result.sku_name}
              </span>
            )}
          </span>
          {result.region && (
            <span className="ml-3 text-xs text-slate-500">{result.region}</span>
          )}
        </div>
        <span className="text-xs text-slate-500">{result.currency}</span>
      </div>

      {!hasData ? (
        <div className="px-5 py-8 text-center text-sm text-slate-400">
          Could not retrieve pricing data for this service/SKU.
          <br />
          <span className="text-xs text-slate-500">
            Check the service name or try again without specifying the SKU.
          </span>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-white/[0.02]">
                  {[
                    "Option",
                    "Cost/Month",
                    "Cost/Year",
                    "Savings/Year",
                    "Break-even",
                    "Recommendation",
                  ].map((h, i) => (
                    <th
                      key={h}
                      className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400 ${
                        i === 0 ? "text-left" : "text-right"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {result.rows.map((row) => {
                  const savingsAnnual =
                    payg?.annual_cost != null &&
                    row.annual_cost != null &&
                    row.mode !== "PAYG (On-demand)"
                      ? payg.annual_cost - row.annual_cost
                      : null;

                  return (
                    <tr
                      key={row.mode}
                      className="transition-colors hover:bg-white/[0.02]"
                    >
                      <td className="px-4 py-3 font-medium text-slate-200">
                        {row.mode}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300">
                        {fmt(row.monthly_cost)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300">
                        {fmt(row.annual_cost)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {savingsAnnual !== null ? (
                          <span className="text-emerald-400">
                            {fmt(savingsAnnual)}
                            {row.savings_pct !== null && (
                              <span className="ml-1 text-xs text-emerald-500">
                                ({row.savings_pct.toFixed(1)}%)
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300">
                        {row.break_even_months !== null
                          ? `${row.break_even_months} months`
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${recBadge[row.recommendation]}`}
                        >
                          {row.recommendation}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Footer note */}
          <div className="border-t border-white/10 px-5 py-3 text-xs text-slate-500 italic">
            ⚠️ Prices come from Azure Retail Prices API (retail). For actual
            contract pricing, use the EA Price Sheet as the source of truth.
            Recommendation is based on estimated savings: Strong ≥30%, Moderate
            15–29%, Weak &lt;15%.
          </div>
        </>
      )}
    </div>
  );
}

/* ── Markdown Rendering (reused pattern from daily-insights) ─── */

function ResultRenderer({ content }: { content: string }) {
  const sections = splitIntoSections(content);

  return (
    <div className="space-y-6">
      {sections.map((section, i) => {
        if (section.type === "title") {
          return (
            <div key={i} className="border-b border-white/10 pb-4">
              <h1 className="text-xl font-bold text-white">{section.text}</h1>
            </div>
          );
        }
        if (section.type === "section") {
          return (
            <div
              key={i}
              className="rounded-xl border border-white/10 bg-navy-900/50 overflow-hidden"
            >
              {section.heading && (
                <div className="border-b border-white/10 bg-white/[0.02] px-5 py-3">
                  <h2 className="text-base font-semibold text-white">
                    {section.heading}
                  </h2>
                </div>
              )}
              <div className="px-5 py-4 space-y-2">
                <SectionBody lines={section.lines} />
              </div>
            </div>
          );
        }
        if (section.type === "footer") {
          return (
            <div
              key={i}
              className="border-t border-white/10 pt-3 text-center text-xs text-slate-500 italic"
            >
              {section.text}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

type Section =
  | { type: "title"; text: string }
  | { type: "section"; heading: string; lines: string[] }
  | { type: "footer"; text: string };

function splitIntoSections(content: string): Section[] {
  const lines = content.split("\n");
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const line of lines) {
    if (line.startsWith("# ") && !line.startsWith("## ")) {
      if (current) sections.push(current);
      current = null;
      sections.push({ type: "title", text: line.slice(2).trim() });
      continue;
    }
    if (line.startsWith("## ")) {
      if (current) sections.push(current);
      current = { type: "section", heading: line.slice(3).trim(), lines: [] };
      continue;
    }
    if (line.trim() === "---") {
      if (current) sections.push(current);
      current = null;
      continue;
    }
    if (
      !current &&
      line.startsWith("*") &&
      line.endsWith("*") &&
      !line.startsWith("**")
    ) {
      sections.push({
        type: "footer",
        text: line.replace(/^\*+|\*+$/g, "").trim(),
      });
      continue;
    }
    if (current && current.type === "section") {
      current.lines.push(line);
    } else if (line.trim()) {
      if (!current) {
        current = { type: "section", heading: "", lines: [] };
      }
      if (current.type === "section") current.lines.push(line);
    }
  }
  if (current) sections.push(current);
  return sections;
}

function SectionBody({ lines }: { lines: string[] }) {
  const groups = groupContent(lines);

  return (
    <>
      {groups.map((group, i) => {
        if (group.type === "table")
          return <MarkdownTable key={i} rows={group.rows} />;
        if (group.type === "code") {
          return (
            <div key={i} className="overflow-x-auto rounded-lg bg-navy-900 p-4">
              {group.lang && (
                <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
                  {group.lang}
                </div>
              )}
              <pre className="text-xs text-emerald-400">
                <code>{group.code}</code>
              </pre>
            </div>
          );
        }
        return (
          <div key={i}>
            {group.lines.map((line, j) => (
              <MarkdownLine key={j} line={line} />
            ))}
          </div>
        );
      })}
    </>
  );
}

type ContentGroup =
  | { type: "table"; rows: string[] }
  | { type: "code"; lang: string; code: string }
  | { type: "text"; lines: string[] };

function groupContent(lines: string[]): ContentGroup[] {
  const groups: ContentGroup[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      groups.push({ type: "code", lang, code: codeLines.join("\n") });
      continue;
    }

    if (line.startsWith("|") && line.endsWith("|")) {
      const tableRows: string[] = [];
      while (
        i < lines.length &&
        lines[i].startsWith("|") &&
        lines[i].endsWith("|")
      ) {
        tableRows.push(lines[i]);
        i++;
      }
      groups.push({ type: "table", rows: tableRows });
      continue;
    }

    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.type === "text") {
      lastGroup.lines.push(line);
    } else {
      groups.push({ type: "text", lines: [line] });
    }
    i++;
  }
  return groups;
}

function MarkdownTable({ rows }: { rows: string[] }) {
  const parsed = rows
    .filter((r) => !r.replace(/[|\s-:]/g, "").length === false)
    .filter((r) => !/^\|[\s-:|]+\|$/.test(r))
    .map((r) =>
      r
        .split("|")
        .filter((_, ci, arr) => ci > 0 && ci < arr.length - 1)
        .map((c) => c.trim()),
    );

  if (parsed.length === 0) return null;
  const header = parsed[0];
  const body = parsed.slice(1);

  return (
    <div className="overflow-x-auto rounded-lg border border-white/10">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-white/[0.04]">
            {header.map((cell, i) => (
              <th
                key={i}
                className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400 ${
                  i === 0 ? "text-left" : "text-right"
                }`}
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {body.map((row, ri) => (
            <tr key={ri} className="transition-colors hover:bg-white/[0.02]">
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className={`px-4 py-2.5 ${
                    ci === 0
                      ? "font-medium text-slate-200 text-left"
                      : "text-right text-slate-300"
                  }`}
                >
                  {renderInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MarkdownLine({ line }: { line: string }) {
  if (!line.trim()) return <div className="h-1.5" />;

  if (line.startsWith("### "))
    return (
      <h3 className="mt-2 text-sm font-semibold text-sky-300">
        {line.slice(4)}
      </h3>
    );

  if (line.startsWith("- ") || line.startsWith("* "))
    return (
      <div className="flex gap-2 py-0.5 text-sm text-slate-300">
        <span className="mt-0.5 text-sky-400">•</span>
        <span>{renderInline(line.slice(2))}</span>
      </div>
    );

  if (/^\d+\.\s/.test(line)) {
    const match = line.match(/^(\d+)\.\s(.*)$/);
    if (match)
      return (
        <div className="flex gap-2 py-0.5 text-sm text-slate-300">
          <span className="mt-0.5 min-w-[1.2rem] text-right text-sky-400">
            {match[1]}.
          </span>
          <span>{renderInline(match[2])}</span>
        </div>
      );
  }

  if (line.startsWith("> "))
    return (
      <blockquote className="border-l-2 border-sky-500/40 pl-3 py-1 text-sm italic text-slate-400">
        {renderInline(line.slice(2))}
      </blockquote>
    );

  return (
    <p className="text-sm text-slate-300 leading-relaxed">
      {renderInline(line)}
    </p>
  );
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          className="rounded bg-navy-900 px-1 py-0.5 text-xs text-emerald-400"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
