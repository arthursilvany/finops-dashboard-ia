"use client";

import { SCORE_INDEX_LABELS } from "@/lib/multicloud/types";
import type {
  MulticloudFacts,
  ScoreBreakdown,
  ScoreIndexId,
  ScoreWeights,
} from "@/lib/multicloud/types";

const INDICES: ScoreIndexId[] = ["price", "performance", "sla", "egress"];

/**
 * The score and the reasoning behind it, always together.
 *
 * A bare 87.7 invites the reader to treat it as a measurement. Showing which
 * indices participated, what weight each actually carried after
 * renormalization, and which were omitted for lack of data is what turns it
 * back into an argument the reader can audit and disagree with.
 */
function ScoreRow({
  breakdown,
  rank,
  isBest,
}: {
  breakdown: ScoreBreakdown;
  rank: number;
  isBest: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        isBest
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-white/10 bg-white/[0.02]"
      }`}
    >
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] text-slate-500">#{rank}</span>
          <span className="text-sm font-semibold text-slate-100">
            {breakdown.provider}
          </span>
        </div>
        <span
          className={`text-lg font-bold ${
            isBest ? "text-emerald-400" : "text-slate-300"
          }`}
        >
          {breakdown.score.toFixed(1)}
        </span>
      </div>

      <div className="mt-2 space-y-1">
        {breakdown.components.map((component) => (
          <div
            key={component.indexId}
            className="flex items-center gap-2 text-[11px]"
          >
            <span className="w-32 shrink-0 text-slate-500">
              {SCORE_INDEX_LABELS[component.indexId]}
            </span>
            {component.value === null ? (
              <span className="italic text-slate-600">
                {component.omittedReason}
              </span>
            ) : (
              <>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full bg-sky-500/60"
                    style={{ width: `${component.value}%` }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right text-slate-400">
                  {component.value.toFixed(0)} ×{" "}
                  {(component.weightApplied * 100).toFixed(0)}%
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function MulticloudScorePanel({
  facts,
  weights,
  onWeightChange,
  onReset,
  isDefaultWeights,
}: {
  facts: MulticloudFacts;
  weights: ScoreWeights;
  onWeightChange: (key: keyof ScoreWeights, value: number) => void;
  onReset: () => void;
  isDefaultWeights: boolean;
}) {
  return (
    <div className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-100">
          Cost-benefit ranking
        </h2>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          A weighted view, not a verdict. An index with no data is excluded and
          the remaining weights are rescaled — never given a neutral value,
          which would state &quot;average&quot; where the truth is
          &quot;unknown&quot;.
        </p>
      </div>

      {facts.scores.length === 0 ? (
        <p className="text-xs italic text-slate-600">
          {facts.insufficientForRecommendation ??
            "No provider has enough observed workload to score."}
        </p>
      ) : (
        <div className="space-y-2">
          {facts.scores.map((breakdown, index) => (
            <ScoreRow
              key={breakdown.provider}
              breakdown={breakdown}
              rank={index + 1}
              isBest={index === 0 && facts.scores.length > 1}
            />
          ))}
        </div>
      )}

      <div className="border-t border-white/10 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Weights
          </h3>
          {!isDefaultWeights && (
            <button
              onClick={onReset}
              className="text-[11px] text-sky-400 underline hover:text-sky-300"
            >
              Reset
            </button>
          )}
        </div>
        <p className="mb-3 text-[10px] leading-relaxed text-slate-600">
          An egress-heavy workload and an internal batch job have genuinely
          different answers. These are your priorities, not ours.
        </p>

        <div className="space-y-2">
          {INDICES.map((index) => (
            <div key={index} className="flex items-center gap-3">
              <label className="w-32 shrink-0 text-[11px] text-slate-400">
                {SCORE_INDEX_LABELS[index]}
              </label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={weights[index]}
                onChange={(e) => onWeightChange(index, Number(e.target.value))}
                className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/10 accent-sky-500"
              />
              <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-slate-400">
                {(weights[index] * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
