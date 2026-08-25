"use client";

interface ImpactBarProps {
  label: string;
  value: number;
  max: number;
  color?: string;
  formatValue?: (v: number) => string;
}

export function ImpactBar({
  label,
  value,
  max,
  color = "#38bdf8",
  formatValue = (v) => `$${v.toLocaleString()}`,
}: ImpactBarProps) {
  const width = max > 0 ? Math.min((value / max) * 100, 100) : 0;

  return (
    <div className="flex items-center gap-3">
      <span className="w-36 shrink-0 truncate text-sm text-slate-400">
        {label}
      </span>
      <div className="flex-1 h-5 rounded-full bg-white/5 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${width}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-24 shrink-0 text-right text-sm font-medium text-slate-300">
        {formatValue(value)}
      </span>
    </div>
  );
}
