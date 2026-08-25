"use client";

import type { ServiceTrendItem } from "@/lib/types";

function fmtCost(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

interface ServiceTrendListProps {
  data: ServiceTrendItem[];
}

export function ServiceTrendList({ data }: ServiceTrendListProps) {
  return (
    <div className="space-y-3">
      {data.map((item) => (
        <div key={item.service} className="flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-slate-300">{item.service}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-white">
              {fmtCost(item.cost)}
            </span>
            <span
              className={`w-16 text-right text-xs font-medium ${
                item.momPercent > 0
                  ? "text-red-400"
                  : item.momPercent < 0
                    ? "text-emerald-400"
                    : "text-slate-400"
              }`}
            >
              {item.momPercent > 0 ? "+" : ""}
              {item.momPercent.toFixed(1)}%
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
