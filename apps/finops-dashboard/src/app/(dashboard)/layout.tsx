import type { Metadata } from "next";
import "./globals.css";
import { NavSidebar } from "@/components/NavSidebar";
import { CopilotChat } from "@/components/CopilotChat";
import { DataSourceBanner } from "@/components/DataSourceBanner";
import { ConfigProvider } from "@/hooks/useConfig";
import { FilterProvider } from "@/hooks/useFilters";

export const metadata: Metadata = {
  title: "FinOps Dashboard — Azure Cost Intelligence",
  description: "Real-time Azure cost analytics powered by ADX / FinOps Hub",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ConfigProvider>
      <FilterProvider>
        <NavSidebar />
        <main className="ml-56 min-h-screen p-6">
          <DataSourceBanner />
          {children}
        </main>
        <CopilotChat />
      </FilterProvider>
    </ConfigProvider>
  );
}
