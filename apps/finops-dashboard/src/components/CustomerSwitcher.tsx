"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import { useConfig } from "@/hooks/useConfig";

interface CustomerWorkspaceView {
  slug: string;
  displayName: string;
  isLegacy: boolean;
  hasDataset: boolean;
  rowCount: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  isActive: boolean;
}

interface CustomersResponse {
  data: { active: string | null; customers: CustomerWorkspaceView[] };
}

const fetcher = (url: string) =>
  fetch(url).then((response) => response.json() as Promise<CustomersResponse>);

/**
 * Switches between collected customers without restarting the server.
 *
 * The selection is a cookie, so it belongs to this browser only: two tabs can
 * show two customers during a comparison. Because the cookie is read on the
 * server, switching has to invalidate every client-side cache as well —
 * otherwise the sidebar and the charts keep rendering the previous customer.
 */
export function CustomerSwitcher() {
  const router = useRouter();
  const { data, mutate } = useSWR("/api/customers", fetcher, {
    revalidateOnFocus: false,
  });
  const { mutate: mutateAll } = useSWRConfig();
  const { refresh: refreshConfig } = useConfig();
  const [pending, setPending] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const customers = (data?.data.customers ?? []).filter((c) => c.hasDataset);
  if (customers.length === 0) return null;

  const active =
    customers.find((customer) => customer.isActive) ?? customers[0];

  // A single customer needs no switch: showing a dropdown with one option is
  // just noise during a demo.
  if (customers.length === 1) {
    return (
      <div className="truncate text-[10px] text-slate-500">
        {active.displayName}
      </div>
    );
  }

  async function select(slug: string) {
    setPending(slug);
    try {
      const response = await fetch("/api/customers/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      if (!response.ok) return;
      setOpen(false);

      // The customer is a server-side cookie, so every client cache in this
      // browser still holds the previous customer. Refreshing only this
      // component's data would leave the sidebar badge, the dataset banner and
      // every chart showing the customer we just left — the exact failure a
      // demo cannot afford. Discard the cached responses so a stale figure is
      // never rendered under the new customer's name, reload the config
      // context (plain React state, invisible to SWR), then refresh the
      // server components.
      //
      // The switcher's own key is revalidated instead of discarded: clearing
      // it would empty the customer list and unmount the dropdown mid-switch.
      await Promise.all([
        mutate(),
        mutateAll((key) => key !== "/api/customers", undefined, {
          revalidate: true,
        }),
        refreshConfig(),
      ]);
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="relative mt-1">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-1 rounded border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-slate-300 hover:border-white/20"
      >
        <span className="truncate">{active.displayName}</span>
        <span className="text-slate-500">{open ? "▲" : "▼"}</span>
      </button>

      {open ? (
        <ul className="absolute bottom-full left-0 z-50 mb-1 max-h-64 w-full overflow-y-auto rounded border border-white/10 bg-navy-900 py-1 shadow-lg">
          {customers.map((customer) => (
            <li key={customer.slug}>
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => select(customer.slug)}
                className={`block w-full px-2 py-1 text-left text-[10px] hover:bg-white/10 ${
                  customer.isActive ? "text-sky-400" : "text-slate-300"
                }`}
              >
                <span className="block truncate">{customer.displayName}</span>
                <span className="block truncate text-[9px] text-slate-500">
                  {customer.isLegacy ? "root folder" : customer.slug}
                  {customer.periodStart
                    ? ` · ${customer.periodStart} → ${customer.periodEnd}`
                    : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
