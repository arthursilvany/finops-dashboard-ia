"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

interface AdxConfig {
  clusterUri: string;
  database: string;
  connected: boolean;
  source: "runtime" | "env" | "none";
  /** Where the dashboard numbers come from right now. */
  dataSource: "adx" | "customer" | "mock";
  /** Present only when a customer Cost Export is loaded for a POC. */
  customerDataset: CustomerDatasetInfo | null;
}

/** Mirrors the payload of `/api/config/current`. */
export interface CustomerDatasetInfo {
  customer: string;
  format: string;
  rowCount: number;
  periodStart: string | null;
  periodEnd: string | null;
  currencies: string[];
  /** Cloud providers present in the dataset ("Azure", "AWS", ...). */
  providers: string[];
  /** Row count per provider, used to size the Azure-only caveat. */
  rowCountByProvider: Record<string, number>;
  warnings: string[];
  coveredPages: string[];
  partialPages: Array<{ page: string; caveat: string }>;
  sampleOnlyPages: string[];
  /** Pages built on Azure-only concepts; they exclude non-Azure rows. */
  azureOnlyPages: string[];
}

interface ConfigContextValue {
  config: AdxConfig;
  loading: boolean;
  refresh: () => Promise<void>;
}

const emptyConfig: AdxConfig = {
  clusterUri: "",
  database: "",
  connected: false,
  source: "none",
  dataSource: "mock",
  customerDataset: null,
};

const ConfigContext = createContext<ConfigContextValue>({
  config: emptyConfig,
  loading: true,
  refresh: async () => {},
});

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<AdxConfig>(emptyConfig);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/config/current");
      if (res.ok) {
        const data = await res.json();
        setConfig({
          clusterUri: data.clusterUri || "",
          database: data.database || "",
          connected: data.source !== "none" && !data.isMock,
          source: data.source,
          dataSource: data.dataSource ?? (data.isMock ? "mock" : "adx"),
          customerDataset: data.customerDataset ?? null,
        });
      }
    } catch {
      // keep current state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <ConfigContext.Provider value={{ config, loading, refresh }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig() {
  return useContext(ConfigContext);
}
