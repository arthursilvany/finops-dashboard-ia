"use client";

import { useState, useRef, useEffect } from "react";

interface MultiSelectDropdownProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  loading?: boolean;
  placeholder?: string;
}

export function MultiSelectDropdown({
  label,
  options,
  selected,
  onChange,
  loading,
  placeholder = "All",
}: MultiSelectDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filtered = options.filter((o) =>
    o.toLowerCase().includes(search.toLowerCase()),
  );

  const toggle = (val: string) => {
    onChange(
      selected.includes(val)
        ? selected.filter((s) => s !== val)
        : [...selected, val],
    );
  };

  const displayText =
    selected.length === 0
      ? placeholder
      : selected.length <= 2
        ? selected.join(", ")
        : `${selected.length} selected`;

  return (
    <div ref={ref} className="relative">
      <label className="mb-1 block text-xs text-zinc-400">{label}</label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full min-w-[140px] items-center justify-between rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 hover:border-zinc-500"
      >
        <span className="truncate">{displayText}</span>
        <svg className="ml-1 h-3 w-3 shrink-0" viewBox="0 0 12 12" fill="none">
          <path d="M3 5L6 8L9 5" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 max-h-60 w-full min-w-[200px] overflow-auto rounded border border-zinc-700 bg-zinc-800 shadow-lg">
          {options.length > 6 && (
            <div className="border-b border-zinc-700 p-1">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="w-full rounded bg-zinc-900 px-2 py-1 text-xs text-white outline-none"
              />
            </div>
          )}
          {loading ? (
            <div className="p-2 text-xs text-zinc-500">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="p-2 text-xs text-zinc-500">No options</div>
          ) : (
            <>
              {selected.length > 0 && (
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="w-full border-b border-zinc-700 px-2 py-1 text-left text-xs text-blue-400 hover:bg-zinc-700"
                >
                  Clear all
                </button>
              )}
              {filtered.map((opt) => (
                <label
                  key={opt}
                  className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(opt)}
                    onChange={() => toggle(opt)}
                    className="h-3 w-3 rounded border-zinc-600 bg-zinc-900"
                  />
                  <span className="truncate">{opt}</span>
                </label>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
