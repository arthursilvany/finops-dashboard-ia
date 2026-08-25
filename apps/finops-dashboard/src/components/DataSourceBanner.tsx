"use client";

import { usePathname } from "next/navigation";
import { useConfig } from "@/hooks/useConfig";

/**
 * Tells the viewer, on every page, where the numbers come from.
 *
 * This exists for one reason: during a pre-sales POC the dashboard mixes the
 * customer's real Cost Export with sample data on the pages an export cannot
 * feed (Advisor recommendations, price sheet, CPU telemetry). Showing sample
 * numbers as if they were the customer's own would be misleading, so pages
 * without coverage say so explicitly.
 */
export function DataSourceBanner() {
  const { config, loading } = useConfig();
  const pathname = usePathname();

  if (loading) return null;
  // ADX is connected: everything on screen is live production data.
  if (config.dataSource === "adx") return null;

  const dataset = config.customerDataset;

  if (!dataset) {
    return (
      <Banner tone="slate">
        <strong className="font-semibold">Sample data.</strong> No Azure Data
        Explorer connection and no customer Cost Export loaded — every figure on
        this page is illustrative.
      </Banner>
    );
  }

  const matches = (page: string) =>
    pathname === page || pathname.startsWith(`${page}/`);

  const covered = dataset.coveredPages.some(matches);
  const partial = (dataset.partialPages ?? []).find(({ page }) => matches(page));

  // Multicloud datasets only: on a single-cloud dataset there is no other
  // provider to omit, so the caveat would be noise.
  const nonAzureProviders = (dataset.providers ?? []).filter((p) => p !== "Azure");
  const azureOnlyPage = (dataset.azureOnlyPages ?? []).some(matches);
  const azureOnlyNotice =
    azureOnlyPage && nonAzureProviders.length > 0 ? (
      <span className="mt-1 block text-xs opacity-90">
        <strong className="font-semibold">Azure-only page.</strong> This view is
        built on Azure-specific data (Retail Prices, ARM resource ids, Advisor /
        Resource Graph), so it covers the Azure rows only and excludes{" "}
        {nonAzureProviders
          .map(
            (provider) =>
              `${provider} (${(
                dataset.rowCountByProvider?.[provider] ?? 0
              ).toLocaleString()} rows)`,
          )
          .join(", ")}
        . Use the Provider filter on the FOCUS-native pages to compare clouds.
      </span>
    ) : null;

  if (!covered && !partial) {
    return (
      <Banner tone="amber">
        <strong className="font-semibold">Sample data on this page.</strong> An
        Azure Cost Export cannot supply it (it needs Advisor recommendations,
        the price sheet or resource telemetry). {dataset.customer}&apos;s real
        data is available on every other page.
        {azureOnlyNotice}
      </Banner>
    );
  }

  const summary = (
    <>
      <strong className="font-semibold">{dataset.customer}</strong> — real cost
      data from a FOCUS cost export ({dataset.format.toUpperCase()},{" "}
      {dataset.rowCount.toLocaleString()} rows,{" "}
      {dataset.currencies.join(", ") || "n/a"}
      {(dataset.providers ?? []).length > 1
        ? `, ${dataset.providers.join(" + ")}`
        : ""}
      ) covering {dataset.periodStart} to {dataset.periodEnd}.
    </>
  );

  // Real customer costs, but some fields on this page are not in a Cost Export.
  // Saying so beats letting a viewer assume a blank field was measured.
  if (partial) {
    return (
      <Banner tone="sky">
        {summary}
        <span className="mt-1 block text-xs opacity-90">{partial.caveat}</span>
        {azureOnlyNotice}
        {dataset.warnings.length > 0 ? (
          <span className="mt-1 block text-xs opacity-80">
            {dataset.warnings.join(" ")}
          </span>
        ) : null}
      </Banner>
    );
  }

  return (
    <Banner tone="emerald">
      {summary}
      {azureOnlyNotice}
      {dataset.warnings.length > 0 ? (
        <span className="mt-1 block text-xs opacity-80">
          {dataset.warnings.join(" ")}
        </span>
      ) : null}
    </Banner>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "slate" | "amber" | "emerald" | "sky";
  children: React.ReactNode;
}) {
  const tones = {
    slate: "border-slate-500/30 bg-slate-500/10 text-slate-300",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    sky: "border-sky-500/30 bg-sky-500/10 text-sky-200",
  } as const;

  return (
    <div
      role="status"
      className={`mb-4 rounded-lg border px-4 py-2 text-sm ${tones[tone]}`}
    >
      {children}
    </div>
  );
}
