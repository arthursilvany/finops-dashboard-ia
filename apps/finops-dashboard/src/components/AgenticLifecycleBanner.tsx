"use client";

import type { AgenticStage } from "@/lib/types";

interface Props {
  byStage: Record<AgenticStage, number>;
}

const STAGES: {
  key: AgenticStage;
  label: string;
  icon: string;
  active: boolean;
}[] = [
  { key: "detect", label: "Detect", icon: "🔍", active: true },
  { key: "analyze", label: "Analyze", icon: "📊", active: true },
  { key: "decide", label: "Decide", icon: "⚖️", active: true },
  { key: "ready", label: "Execute", icon: "⚡", active: false },
  { key: "pending-approval", label: "Validate", icon: "✅", active: false },
];

const FUTURE_STAGE = { label: "Learn", icon: "🧠" };

export function AgenticLifecycleBanner({ byStage }: Props) {
  return (
    <div className="rounded-xl border border-white/10 bg-navy-800/60 backdrop-blur-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">🔄</span>
        <div>
          <h2 className="text-sm font-bold text-white">Agentic FinOps Lifecycle</h2>
          <p className="text-xs text-slate-400">
            Detect → Analyze → Decide → Execute → Validate → Learn
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1">
        {STAGES.map((stage, i) => {
          const count = byStage[stage.key] ?? 0;
          const isActive = stage.active;
          return (
            <div key={stage.key} className="flex items-center flex-1">
              <div
                className={`flex-1 rounded-lg border p-3 text-center transition-all ${
                  isActive
                    ? "border-sky-500/30 bg-sky-500/10"
                    : "border-white/5 bg-white/[0.02] opacity-50"
                }`}
              >
                <span className="text-lg">{stage.icon}</span>
                <p
                  className={`text-[10px] font-semibold uppercase tracking-wide mt-1 ${
                    isActive ? "text-sky-400" : "text-slate-500"
                  }`}
                >
                  {stage.label}
                </p>
                {isActive ? (
                  <p className="text-lg font-bold text-white mt-0.5">{count}</p>
                ) : (
                  <p className="text-xs text-slate-600 mt-1">Phase 2</p>
                )}
              </div>
              {i < STAGES.length && (
                <span className="text-slate-600 mx-1 text-xs shrink-0">→</span>
              )}
            </div>
          );
        })}

        {/* Learning stage — always future */}
        <div className="flex items-center flex-1">
          <div className="flex-1 rounded-lg border border-white/5 bg-white/[0.02] opacity-50 p-3 text-center">
            <span className="text-lg">{FUTURE_STAGE.icon}</span>
            <p className="text-[10px] font-semibold uppercase tracking-wide mt-1 text-slate-500">
              {FUTURE_STAGE.label}
            </p>
            <p className="text-xs text-slate-600 mt-1">Phase 3</p>
          </div>
        </div>
      </div>
    </div>
  );
}
