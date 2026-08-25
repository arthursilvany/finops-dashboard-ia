"use client";

import { useState, useCallback } from "react";
import type {
  AgenticRecommendation,
  PreConditionCheck,
  RemediationAction,
} from "@/lib/types";
import { ConfirmationModal } from "./ConfirmationModal";
import { executeRemediation } from "@/lib/execution-service";
import { runPreConditionChecks } from "@/lib/pre-condition-validator";
import { useUser } from "@/hooks/useUser";

function fmtBRL(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(n);
}

const IMPACT_COLORS: Record<string, string> = {
  high: "bg-red-500/20 text-red-400 border-red-500/30",
  medium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  low: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
};

const RISK_COLORS: Record<string, string> = {
  high: "bg-red-500/20 text-red-400",
  medium: "bg-amber-500/20 text-amber-400",
  low: "bg-emerald-500/20 text-emerald-400",
};

const STAGE_CONFIG: Record<string, { label: string; color: string }> = {
  detect: { label: "Detected", color: "bg-slate-500/20 text-slate-400" },
  analyze: { label: "Analyzing", color: "bg-blue-500/20 text-blue-400" },
  decide: { label: "Decision", color: "bg-amber-500/20 text-amber-400" },
  ready: { label: "Ready", color: "bg-emerald-500/20 text-emerald-400" },
  "pending-approval": {
    label: "Pending Approval",
    color: "bg-purple-500/20 text-purple-400",
  },
};

const RESOURCE_ICONS: Record<string, string> = {
  "Microsoft.Compute/virtualMachines": "🖥️",
  "Microsoft.Sql/servers/databases": "🗄️",
  "Microsoft.Storage/storageAccounts": "📦",
  "Microsoft.Compute/disks": "💿",
  "Microsoft.Network/publicIPAddresses": "🌐",
  "Microsoft.Web/sites": "🌍",
  "Microsoft.ContainerService/managedClusters": "☸️",
};

const ACTION_LABELS: Record<string, string> = {
  STOP_VM: "Stop VM",
  RIGHTSIZE_VM: "Resize",
  BUY_RESERVATION: "Buy RI",
  CHANGE_SKU: "Change SKU",
  DELETE_ORPHAN: "Delete Orphan",
  AUTO_TAG: "Auto-Tag",
  OPTIMIZE: "Optimize",
};

export function AgenticRecommendationCard({
  rec,
}: {
  rec: AgenticRecommendation;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [preChecks, setPreChecks] = useState<PreConditionCheck[] | null>(null);
  const [preChecksLoading, setPreChecksLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<{
    status: string;
    message: string;
  } | null>(null);

  const { isAdmin, isLoading: userLoading } = useUser();
  // Remediation mutates Azure resources: Admin only. While the identity is
  // still loading, keep the button disabled rather than flashing it enabled.
  const canExecute = isAdmin && !userLoading;

  const impactStyle = IMPACT_COLORS[rec.impact] ?? IMPACT_COLORS.medium;
  const riskStyle = RISK_COLORS[rec.riskLevel] ?? RISK_COLORS.medium;
  const stage = STAGE_CONFIG[rec.agenticStage] ?? STAGE_CONFIG.detect;
  const resIcon = RESOURCE_ICONS[rec.resourceType] ?? "📄";
  const actionLabel = ACTION_LABELS[rec.actionType] ?? rec.actionType;

  const isReady =
    (rec.agenticStage === "ready" || rec.agenticStage === "pending-approval") &&
    canExecute;

  const handleOpenModal = useCallback(async () => {
    setModalOpen(true);
    setPreChecks(null);
    setPreChecksLoading(true);
    setResult(null);
    try {
      const res = await runPreConditionChecks(rec.resourceId);
      setPreChecks(res.checks);
    } catch {
      setPreChecks([]);
    } finally {
      setPreChecksLoading(false);
    }
  }, [rec.resourceId]);

  const handleConfirm = useCallback(async () => {
    setExecuting(true);
    try {
      const execResult = await executeRemediation({
        recommendationId: rec.id,
        action: rec.actionType
          .toLowerCase()
          .replace(/ /g, "_") as RemediationAction,
        resourceId: rec.resourceId,
        resourceName: rec.resourceName,
      });
      setResult({ status: execResult.status, message: execResult.message });
    } catch {
      setResult({ status: "failed", message: "Failed to execute action." });
    } finally {
      setExecuting(false);
    }
  }, [rec]);

  const handleCancel = useCallback(() => {
    setModalOpen(false);
    setResult(null);
  }, []);

  return (
    <div className="rounded-xl border border-white/10 bg-navy-800/60 backdrop-blur-sm overflow-hidden">
      <div className="px-5 pt-4 pb-3 border-b border-white/5">
        <div className="flex items-center gap-2 text-xs text-slate-400 mb-1.5">
          <span>{resIcon}</span>
          <span className="font-medium text-slate-300">
            {rec.resourceType.split("/").pop()}
          </span>
          <span className="text-white/20">·</span>
          <span>{rec.resourceGroup}</span>
          {rec.subscriptionName && (
            <>
              <span className="text-white/20">·</span>
              <span>{rec.subscriptionName}</span>
            </>
          )}
        </div>
        <h3 className="text-sm font-bold text-white leading-snug">
          {rec.resourceName}
        </h3>
        <p className="text-sm text-slate-300 mt-1 leading-relaxed">
          {rec.title}
        </p>
      </div>

      <div className="px-5 py-2.5 flex flex-wrap items-center gap-1.5">
        <span
          className={`rounded px-2 py-0.5 text-[10px] font-bold tracking-wide border ${impactStyle}`}
        >
          {rec.impact.toUpperCase()} IMPACT
        </span>
        <span
          className={`rounded px-2 py-0.5 text-[10px] font-bold tracking-wide ${riskStyle}`}
        >
          RISK {rec.riskLevel.toUpperCase()}
        </span>
        <span
          className={`rounded px-2 py-0.5 text-[10px] font-bold tracking-wide ${stage.color}`}
        >
          {stage.label}
        </span>
        <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">
          {rec.recommendationCategory}
        </span>
        <span className="rounded bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-400 font-medium">
          {actionLabel}
        </span>
      </div>

      <div className="px-5 pb-3 space-y-2">
        {rec.description && (
          <p className="text-xs text-slate-400 leading-relaxed">
            {rec.description}
          </p>
        )}
        {rec.solution && rec.solution !== rec.description && (
          <div className="rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">
              Recommended Solution
            </p>
            <p className="text-xs text-slate-300 leading-relaxed">
              {rec.solution}
            </p>
          </div>
        )}
      </div>

      <div className="border-t border-white/10 px-5 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-6 text-xs">
          <div>
            <span className="text-slate-400">Potential savings </span>
            <span className="font-bold text-emerald-400">
              {fmtBRL(rec.potentialSavings)}
            </span>
            <span className="text-slate-500">/year</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Confidence</span>
            <div className="w-16 h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full rounded-full bg-sky-400 transition-all"
                style={{ width: `${Math.round(rec.confidenceScore * 100)}%` }}
              />
            </div>
            <span className="text-slate-300 font-medium">
              {Math.round(rec.confidenceScore * 100)}%
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {result ? (
            <span
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                result.status === "success"
                  ? "bg-emerald-500/20 text-emerald-400"
                  : "bg-red-500/20 text-red-400"
              }`}
            >
              {result.status === "success" ? "✓ Executed" : "✗ Failed"}
            </span>
          ) : (
            <button
              disabled={!isReady}
              onClick={handleOpenModal}
              title={
                isReady
                  ? `Execute: ${actionLabel}`
                  : !canExecute
                    ? "Executing remediation requires the FinOps.Admin role"
                    : "Recommendation is not ready for action yet"
              }
              className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors ${
                isReady
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 cursor-pointer"
                  : "border-white/10 bg-white/5 text-slate-500 cursor-not-allowed opacity-60"
              }`}
            >
              {rec.requiresApproval ? "Request Approval" : "Apply Action"}
            </button>
          )}
        </div>
      </div>

      <ConfirmationModal
        open={modalOpen}
        title={`Confirm: ${actionLabel}`}
        resourceName={rec.resourceName}
        actionLabel={
          rec.requiresApproval ? "Request Approval" : "Confirm Execution"
        }
        preChecks={preChecks}
        preChecksLoading={preChecksLoading}
        executing={executing}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </div>
  );
}
