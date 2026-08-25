"use client";

import { KpiCard } from "@/components/KpiCard";
import type { AgenticSummary } from "@/lib/types";

function fmtBRL(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(n);
}

export function AgenticSummaryCards({ summary }: { summary: AgenticSummary }) {
  return (
    <div className="grid grid-cols-4 gap-4">
      <KpiCard
        title="Recommendations"
        value={String(summary.totalRecommendations)}
        subtitle="Total detected"
        icon={<span>📋</span>}
      />
      <KpiCard
        title="Potential Savings"
        value={fmtBRL(summary.totalPotentialSavings)}
        subtitle="Annual estimate"
        icon={<span>💰</span>}
      />
      <KpiCard
        title="Ready for Action"
        value={String(summary.readyForAction)}
        subtitle="Low risk"
        icon={<span>⚡</span>}
      />
      <KpiCard
        title="Pending Approval"
        value={String(summary.pendingApproval)}
        subtitle="Requires decision"
        icon={<span>🔒</span>}
      />
    </div>
  );
}
