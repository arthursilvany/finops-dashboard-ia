"use client";

import { useState } from "react";
import { useConfig } from "@/hooks/useConfig";
import { useUser } from "@/hooks/useUser";

type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

export default function SettingsPage() {
  const { config, refresh } = useConfig();
  const { isAdmin, isLoading: userLoading } = useUser();
  // Settings write to the backend configuration, so Readers get a read-only view.
  const canEdit = isAdmin || userLoading;

  const [clusterUri, setClusterUri] = useState(config.clusterUri || "");
  const [databases, setDatabases] = useState<string[]>([]);
  const [selectedDb, setSelectedDb] = useState(config.database || "");
  const [connStatus, setConnStatus] = useState<ConnectionStatus>(
    config.connected ? "connected" : "idle",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Sync state when config loads
  useState(() => {
    if (config.clusterUri) setClusterUri(config.clusterUri);
    if (config.database) setSelectedDb(config.database);
  });

  async function handleConnect() {
    setError("");
    setSuccessMsg("");
    setDatabases([]);
    setConnStatus("connecting");

    try {
      const res = await fetch("/api/config/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clusterUri }),
      });

      const data = await res.json();

      if (!res.ok || !data.connected) {
        setConnStatus("error");
        setError(data.error || "Failed to connect");
        return;
      }

      setDatabases(data.databases);
      setConnStatus("connected");

      if (data.databases.length === 1) {
        setSelectedDb(data.databases[0]);
      } else if (data.databases.includes("Hub")) {
        setSelectedDb("Hub");
      }
    } catch (err) {
      setConnStatus("error");
      setError(err instanceof Error ? err.message : "Connection failed");
    }
  }

  async function handleSave() {
    if (!selectedDb) {
      setError("Select a database first");
      return;
    }

    setError("");
    setSuccessMsg("");
    setSaving(true);

    try {
      const res = await fetch("/api/config/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clusterUri, database: selectedDb }),
      });

      const data = await res.json();

      if (!res.ok || !data.saved) {
        setError(data.error || "Failed to save");
        return;
      }

      setSuccessMsg(
        data.connected
          ? `Connected to ${selectedDb} on ${clusterUri}`
          : `Configuration saved but connectivity test failed: ${data.error}`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="mt-1 text-sm text-slate-400">
          Configure the Azure Data Explorer connection for your FinOps Hub
        </p>
      </div>

      {/* Current connection status */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-5">
        <h2 className="text-sm font-medium text-slate-300">
          Current Connection
        </h2>
        <div className="mt-3 flex items-center gap-3">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              config.connected ? "bg-emerald-400" : "bg-slate-500"
            }`}
          />
          {config.connected ? (
            <span className="text-sm text-slate-300">
              <span className="font-mono text-emerald-400">
                {config.database}
              </span>{" "}
              on{" "}
              <span className="font-mono text-slate-400">
                {config.clusterUri}
              </span>
              <span className="ml-2 text-xs text-slate-500">
                ({config.source === "env" ? "from .env" : "runtime"})
              </span>
            </span>
          ) : (
            <span className="text-sm text-slate-500">
              Not connected — using mock data
            </span>
          )}
        </div>
      </div>

      {/* Connection form */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-5">
        <h2 className="text-sm font-medium text-slate-300">
          ADX Cluster Connection
        </h2>

        {!canEdit ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Read-only view. Changing the analytics connection requires the
            FinOps.Admin role.
          </p>
        ) : null}

        {/* Cluster URI input */}
        <div className="space-y-2">
          <label
            htmlFor="cluster-uri"
            className="block text-xs font-medium text-slate-400"
          >
            Cluster URI
          </label>
          <div className="flex gap-3">
            <input
              id="cluster-uri"
              type="url"
              value={clusterUri}
              onChange={(e) => {
                setClusterUri(e.target.value);
                setConnStatus("idle");
                setDatabases([]);
                setError("");
                setSuccessMsg("");
              }}
              placeholder="https://your-cluster.region.kusto.windows.net"
              className="flex-1 rounded-lg border border-white/10 bg-navy-900 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
            <button
              onClick={handleConnect}
              disabled={!clusterUri || connStatus === "connecting" || !canEdit}
              className="rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {connStatus === "connecting" ? (
                <span className="flex items-center gap-2">
                  <svg
                    className="h-4 w-4 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Connecting…
                </span>
              ) : (
                "Connect"
              )}
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Format: https://&lt;name&gt;.&lt;region&gt;.kusto.windows.net
          </p>
        </div>

        {/* Database selector */}
        {databases.length > 0 && (
          <div className="space-y-2">
            <label
              htmlFor="database"
              className="block text-xs font-medium text-slate-400"
            >
              Database ({databases.length} found)
            </label>
            <select
              id="database"
              value={selectedDb}
              onChange={(e) => setSelectedDb(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-navy-900 px-4 py-2.5 text-sm text-white focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              <option value="">Select a database…</option>
              {databases.map((db) => (
                <option key={db} value={db}>
                  {db}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Success message */}
        {successMsg && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
            {successMsg}
          </div>
        )}

        {/* Save button */}
        {databases.length > 0 && (
          <button
            onClick={handleSave}
            disabled={!selectedDb || saving || !canEdit}
            className="w-full rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : `Save & Connect → ${selectedDb}`}
          </button>
        )}
      </div>

      {/* Info card */}
      <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-5 text-sm text-slate-400">
        <p className="font-medium text-sky-400">How it works</p>
        <ul className="mt-2 list-inside list-disc space-y-1 text-xs">
          <li>
            Click <strong>Connect</strong> to test the cluster and list
            available databases
          </li>
          <li>
            Select a database and click <strong>Save</strong> to switch
          </li>
          <li>
            Authentication uses <code>DefaultAzureCredential</code> — make sure
            you ran <code>az login</code>
          </li>
          <li>
            The config persists for this server session. Set{" "}
            <code>ADX_CLUSTER_URI</code> in <code>.env.local</code> to make it
            permanent
          </li>
        </ul>
      </div>
    </div>
  );
}
