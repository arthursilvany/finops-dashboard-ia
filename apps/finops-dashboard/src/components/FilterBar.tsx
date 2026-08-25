"use client";

import { useState } from "react";
import { useFilters } from "@/hooks/useFilters";
import { useFilterOptions, useTagValues } from "@/hooks/useFilterOptions";
import { MultiSelectDropdown } from "./MultiSelectDropdown";
import { DateRangePicker } from "./DateRangePicker";

export function FilterBar() {
  const { filters, setFilter, resetFilters, addTag, removeTag } = useFilters();
  const { data: options, isLoading } = useFilterOptions();
  const [tagKeyInput, setTagKeyInput] = useState<string | null>(null);
  const { data: tagValues } = useTagValues(tagKeyInput);

  const hasActiveFilters =
    filters.dateFrom ||
    filters.dateTo ||
    filters.providers.length > 0 ||
    filters.subscriptions.length > 0 ||
    filters.regions.length > 0 ||
    filters.services.length > 0 ||
    filters.resourceGroups.length > 0 ||
    filters.tags.length > 0;

  // A single-cloud dataset gains nothing from a provider dropdown with one
  // entry — it just adds a control that can only ever be a no-op.
  const providerOptions = options?.providers ?? [];
  const showProviderFilter = providerOptions.length > 1;

  return (
    <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <DateRangePicker
          label="Period"
          dateFrom={filters.dateFrom}
          dateTo={filters.dateTo}
          onChangeFrom={(d) => setFilter("dateFrom", d)}
          onChangeTo={(d) => setFilter("dateTo", d)}
        />

        {showProviderFilter && (
          <MultiSelectDropdown
            label="Provider"
            options={providerOptions}
            selected={filters.providers}
            onChange={(v) => setFilter("providers", v)}
            loading={isLoading}
          />
        )}

        <MultiSelectDropdown
          label="Subscriptions"
          options={options?.subscriptions ?? []}
          selected={filters.subscriptions}
          onChange={(v) => setFilter("subscriptions", v)}
          loading={isLoading}
        />

        <MultiSelectDropdown
          label="Regions"
          options={options?.regions ?? []}
          selected={filters.regions}
          onChange={(v) => setFilter("regions", v)}
          loading={isLoading}
        />

        <MultiSelectDropdown
          label="Services"
          options={options?.services ?? []}
          selected={filters.services}
          onChange={(v) => setFilter("services", v)}
          loading={isLoading}
        />

        <MultiSelectDropdown
          label="Resource Groups"
          options={options?.resourceGroups ?? []}
          selected={filters.resourceGroups}
          onChange={(v) => setFilter("resourceGroups", v)}
          loading={isLoading}
        />

        {/* Tag filter */}
        <div>
          <label className="mb-1 block text-xs text-zinc-400">Tag Filter</label>
          <div className="flex items-center gap-1">
            <select
              value={tagKeyInput ?? ""}
              onChange={(e) => setTagKeyInput(e.target.value || null)}
              className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 outline-none"
            >
              <option value="">Tag key…</option>
              {(options?.tagKeys ?? []).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            {tagKeyInput && tagValues && tagValues.length > 0 && (
              <MultiSelectDropdown
                label=""
                options={tagValues}
                selected={
                  filters.tags.find((t) => t.key === tagKeyInput)?.values ?? []
                }
                onChange={(vals) => {
                  if (vals.length > 0) {
                    addTag({ key: tagKeyInput, values: vals });
                  } else {
                    removeTag(tagKeyInput);
                  }
                }}
                placeholder="Values…"
              />
            )}
          </div>
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={resetFilters}
            className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-red-400 hover:bg-zinc-800 hover:text-red-300"
          >
            Reset
          </button>
        )}
      </div>

      {/* Active tag badges */}
      {filters.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {filters.tags.map((tag) => (
            <span
              key={tag.key}
              className="inline-flex items-center gap-1 rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300"
            >
              {tag.key}: {tag.values.join(", ")}
              <button
                type="button"
                onClick={() => removeTag(tag.key)}
                className="ml-0.5 text-zinc-500 hover:text-red-400"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
