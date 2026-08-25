"use client";

import type { MiniKpiGauge } from "@/lib/types";

const statusColors: Record<MiniKpiGauge["status"], string> = {
  good: "#34d399",
  warning: "#fbbf24",
  danger: "#f87171",
};

const statusBg: Record<MiniKpiGauge["status"], string> = {
  good: "rgba(52, 211, 153, 0.15)",
  warning: "rgba(251, 191, 36, 0.15)",
  danger: "rgba(248, 113, 113, 0.15)",
};

export function MiniKpiCard({
  label,
  value,
  target,
  targetLabel,
  status,
}: MiniKpiGauge) {
  const barWidth = Math.min((value / target) * 100, 100);
  const color = statusColors[status];
  const bg = statusBg[status];

  return (
    <div className="rounded-xl border border-white/10 bg-navy-800/60 p-4 backdrop-blur-sm">
      <p className="text-xs font-medium text-slate-400">{label}</p>
      <div className="mt-2 flex items-end justify-between">
        <span className="text-2xl font-bold text-white">{value}%</span>
        <span className="text-xs text-slate-500">{targetLabel}</span>
      </div>
      <div
        className="mt-3 h-2 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: bg }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${barWidth}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
