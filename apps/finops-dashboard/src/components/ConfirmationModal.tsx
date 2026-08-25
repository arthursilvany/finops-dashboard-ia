"use client";

import { useCallback, useEffect, useRef } from "react";
import type { PreConditionCheck } from "@/lib/types";

interface ConfirmationModalProps {
  open: boolean;
  title: string;
  resourceName: string;
  actionLabel: string;
  preChecks: PreConditionCheck[] | null;
  preChecksLoading: boolean;
  executing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const STATUS_ICON: Record<string, string> = {
  pass: "✅",
  warn: "⚠️",
  block: "🚫",
};

const STATUS_STYLE: Record<string, string> = {
  pass: "text-emerald-400",
  warn: "text-amber-400",
  block: "text-red-400",
};

export function ConfirmationModal({
  open,
  title,
  resourceName,
  actionLabel,
  preChecks,
  preChecksLoading,
  executing,
  onConfirm,
  onCancel,
}: ConfirmationModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === dialogRef.current) onCancel();
    },
    [onCancel],
  );

  const hasBlock = preChecks?.some((c) => c.status === "block") ?? false;
  const canConfirm = !preChecksLoading && !hasBlock && !executing;

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 m-auto w-full max-w-lg rounded-2xl border border-white/10 bg-navy-900/95 backdrop-blur-xl p-0 text-white shadow-2xl"
    >
      <div className="p-6 space-y-5">
        {/* Header */}
        <div>
          <h2 className="text-lg font-bold text-white">{title}</h2>
          <p className="text-sm text-slate-400 mt-1">
            Resource:{" "}
            <span className="font-medium text-slate-300">{resourceName}</span>
          </p>
        </div>

        {/* Pre-condition checks */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Pre-Execution Checks
          </h3>

          {preChecksLoading ? (
            <div className="flex items-center gap-2 py-4 justify-center">
              <span className="animate-spin text-sky-400">⟳</span>
              <span className="text-xs text-slate-400">
                Checking preconditions...
              </span>
            </div>
          ) : preChecks ? (
            <div className="space-y-1.5">
              {preChecks.map((check) => (
                <div
                  key={check.check}
                  className="flex items-start gap-2 rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2"
                >
                  <span className="text-sm shrink-0">
                    {STATUS_ICON[check.status]}
                  </span>
                  <div className="min-w-0">
                    <p
                      className={`text-xs font-medium ${STATUS_STYLE[check.status]}`}
                    >
                      {check.check.replace(/_/g, " ")}
                    </p>
                    <p className="text-xs text-slate-400">{check.message}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {hasBlock && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
              <p className="text-xs text-red-300">
                One or more checks blocked execution. Resolve them before
                continuing.
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-white/5">
          <button
            onClick={onCancel}
            disabled={executing}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!canConfirm}
            className="rounded-lg px-4 py-2 text-sm font-bold transition-colors
              bg-emerald-600 hover:bg-emerald-500 text-white
              disabled:bg-white/5 disabled:text-slate-500 disabled:cursor-not-allowed"
          >
            {executing ? (
              <span className="flex items-center gap-2">
                <span className="animate-spin">⟳</span> Executing...
              </span>
            ) : (
              actionLabel
            )}
          </button>
        </div>
      </div>
    </dialog>
  );
}
