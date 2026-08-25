"use client";

interface KpiCardProps {
  title: string;
  value: string;
  subtitle?: string;
  changePercent?: number;
  icon?: React.ReactNode;
  accentColor?: string;
}

export function KpiCard({
  title,
  value,
  subtitle,
  changePercent,
  icon,
  accentColor,
}: KpiCardProps) {
  const isPositive = changePercent !== undefined && changePercent > 0;
  const isNegative = changePercent !== undefined && changePercent < 0;

  return (
    <div
      className="rounded-xl border border-white/10 bg-navy-800/60 p-5 backdrop-blur-sm"
      style={
        accentColor ? { borderTop: `2px solid ${accentColor}` } : undefined
      }
    >
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-slate-400">{title}</p>
        {icon && <span className="text-slate-500">{icon}</span>}
      </div>
      <p className="mt-2 text-2xl font-bold text-white">{value}</p>
      <div className="mt-1 flex items-center gap-2">
        {changePercent !== undefined && (
          <span
            className={`text-sm font-medium ${
              isPositive
                ? "text-red-400"
                : isNegative
                  ? "text-emerald-400"
                  : "text-slate-400"
            }`}
          >
            {isPositive ? "▲" : isNegative ? "▼" : "—"}{" "}
            {Math.abs(changePercent).toFixed(1)}%
          </span>
        )}
        {subtitle && <span className="text-xs text-slate-500">{subtitle}</span>}
      </div>
    </div>
  );
}
