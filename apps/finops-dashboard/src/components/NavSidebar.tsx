"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useConfig } from "@/hooks/useConfig";
import { CustomerSwitcher } from "@/components/CustomerSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";

type NavItem = { href: string; label: string; icon: string };

const sections: { label: string; items: NavItem[] }[] = [
  {
    label: "Analytics",
    items: [
      { href: "/cost-summary", label: "Cost Summary", icon: "💰" },
      { href: "/rate-optimization", label: "Rate Optimization", icon: "📊" },
      { href: "/workload", label: "Workload", icon: "⚙️" },
      { href: "/sku-advisor", label: "SKU Advisor", icon: "🖥️" },
      { href: "/governance", label: "Governance", icon: "🛡️" },
      { href: "/multicloud", label: "Multicloud", icon: "☁️" },
      { href: "/stakeholder-cards", label: "Stakeholder Cards", icon: "🎯" },
    ],
  },
  {
    label: "AI & Alerts",
    items: [
      { href: "/ai-insights", label: "AI Insights", icon: "✨" },
      { href: "/ai-costs", label: "AI Costs", icon: "🧠" },
      { href: "/agentic-finops", label: "Agentic FinOps", icon: "🤖" },
      { href: "/anomalies", label: "Anomalies", icon: "🔍" },
      { href: "/daily-insights", label: "Daily Insights", icon: "📰" },
    ],
  },
  {
    label: "Finance",
    items: [
      { href: "/chargeback", label: "Chargeback", icon: "🧾" },
      { href: "/budgets", label: "Budgets", icon: "📋" },
      { href: "/reservation-detail", label: "Reservations", icon: "📅" },
      { href: "/azure-pricing", label: "Azure Pricing", icon: "💲" },
      { href: "/cost-simulator", label: "Cost Simulator", icon: "📊" },
    ],
  },
];

function NavLink({ href, label, icon }: NavItem) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + "/");
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
        active
          ? "bg-sky-500/10 text-sky-400 font-medium"
          : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
      }`}
    >
      <span className="w-4 text-center">{icon}</span>
      {label}
    </Link>
  );
}

export function NavSidebar() {
  const pathname = usePathname();
  const { config } = useConfig();
  const settingsActive = pathname === "/settings";

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-56 flex-col border-r border-white/10 bg-navy-900/95 backdrop-blur-md">
      <div className="flex h-14 items-center gap-2 border-b border-white/10 px-4">
        <span className="text-lg font-bold text-white">FinOps</span>
        <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-sky-400">
          HUB
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {sections.map((section) => (
          <div key={section.label}>
            <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink key={item.href} {...item} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 p-2 space-y-1">
        <Link
          href="/settings"
          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
            settingsActive
              ? "bg-sky-500/10 text-sky-400 font-medium"
              : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
          }`}
        >
          <span className="w-4 text-center">⚙️</span>
          Settings
        </Link>
        <ThemeToggle />
        <UserMenu />
        <div className="rounded-lg bg-white/5 px-3 py-2 text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                config.connected
                  ? "bg-emerald-400"
                  : config.dataSource === "customer"
                    ? "bg-amber-400"
                    : "bg-slate-500"
              }`}
            />
            {config.connected ? (
              <span className="text-slate-400 truncate">{config.database}</span>
            ) : config.dataSource === "customer" ? (
              <span className="text-amber-300 truncate">
                POC: {config.customerDataset?.customer}
              </span>
            ) : (
              <span>Mock mode</span>
            )}
          </div>
          {!config.connected && config.customerDataset ? (
            <>
              <div className="mt-1 text-[10px] leading-tight text-slate-500">
                Cost Export {config.customerDataset.format.toUpperCase()} ·{" "}
                {config.customerDataset.periodStart} →{" "}
                {config.customerDataset.periodEnd}
              </div>
              <CustomerSwitcher />
            </>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
