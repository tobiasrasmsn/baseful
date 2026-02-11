import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { CopyIcon, CheckIcon } from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useDatabase } from "@/context/DatabaseContext";
import { Facehash } from "facehash";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface Database {
  id: number;
  name: string;
  type: string;
  host: string;
  port: number;
  status: string;
  version?: string;
  connection_string?: string;
  has_token?: boolean;
  token_expires_at?: string;
}

interface DatabaseMetrics {
  active_connections: number;
  database_size: string;
  cpu_usage_percent: number;
  memory_usage_mb: number;
  memory_limit_mb: number;
  memory_usage_percent: number;
}

export default function DatabaseDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { refreshDatabases } = useDatabase();
  const [database, setDatabase] = useState<Database | null>(null);
  const [metrics, setMetrics] = useState<DatabaseMetrics | null>(null);
  const [limits, setLimits] = useState<{
    max_cpu: number;
    max_ram_mb: number;
    max_storage_mb: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
  const [connectionString, setConnectionString] = useState<string | null>(null);
  const [connectionWarning, setConnectionWarning] = useState<string | null>(
    null,
  );
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [metricsLoading, setMetricsLoading] = useState(true);

  const handleAction = async (action: string) => {
    if (
      action === "delete" &&
      !confirm(
        "Are you sure you want to delete this database? This will remove the container and all data.",
      )
    ) {
      return;
    }

    setActionLoading(action);
    try {
      const res = await fetch(`/api/databases/${id}/${action}`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`Failed to ${action} database`);

      if (action === "delete") {
        await refreshDatabases();
        navigate("/");
        return;
      }

      // Refresh data
      const updatedRes = await fetch(`/api/databases/${id}`);
      const updatedData = await updatedRes.json();
      setDatabase(updatedData);
      await refreshDatabases();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setActionLoading(null);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fetchConnectionString = async () => {
    if (!id) return;
    setConnectionLoading(true);
    try {
      const res = await fetch(`/api/databases/${id}/connection-string`);
      if (!res.ok) throw new Error("Failed to get connection string");
      const data = await res.json();
      setConnectionString(data.connection_string);
      setConnectionWarning(data.warning);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setConnectionLoading(false);
    }
  };

  const handleOpenConnectionDialog = async () => {
    setConnectionDialogOpen(true);
    if (!connectionString) {
      await fetchConnectionString();
    }
  };

  const fetchMetrics = async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/databases/${id}/metrics`);
      if (res.ok) {
        const data = await res.json();
        setMetrics(data);
      }
    } catch (err: unknown) {
      console.error("Failed to fetch metrics:", err);
    } finally {
      setMetricsLoading(false);
    }
  };

  const fetchDatabase = async () => {
    setLoading(true);
    setError(null);
    setMetricsLoading(true);
    try {
      const res = await fetch(`/api/databases/${id}`);
      if (!res.ok) {
        throw new Error("Database not found");
      }
      const data = await res.json();
      setDatabase(data);
      await fetchMetrics();
      await fetchLimits();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const fetchLimits = async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/databases/${id}/limits`);
      if (res.ok) {
        const data = await res.json();
        setLimits({
          max_cpu: data.max_cpu || 1,
          max_ram_mb: data.max_ram_mb || 512,
          max_storage_mb: data.max_storage_mb || 1024,
        });
      }
    } catch (err: unknown) {
      console.error("Failed to fetch resource limits:", err);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-green-600/10 text-green-300";
      case "stopped":
        return "bg-red-600/10 text-red-300";
      default:
        return "bg-gray-600/10 text-gray-300";
    }
  };

  useEffect(() => {
    if (id) {
      fetchDatabase();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-neutral-400">Loading database...</div>
      </div>
    );
  }

  if (error || !database) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="text-red-400">{error || "Database not found"}</div>
        <Link to="/" className="text-blue-400 hover:text-blue-300">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 h-full">
      <div className="flex flex-col items-center justify-between">
        <div className="flex flex-row border-b border-border p-4 items-center gap-4 w-full">
          <div className="flex flex-row items-center gap-3 flex-1">
            <Facehash
              name={database.name}
              className="rounded-sm"
              colorClasses={[
                "bg-blue-500",
                "bg-orange-500",
                "bg-purple-500",
                "bg-lime-500",
                "bg-indigo-500",
                "bg-pink-500",
                "bg-teal-500",
                "bg-yellow-500",
                "bg-sky-500",
                "bg-fuchsia-500",
                "bg-rose-500",
                "bg-green-500",
              ]}
              size={32}
            />
            <div className="flex flex-row items-center gap-2">
              <h1 className="text-2xl font-medium text-neutral-100">
                {database.name}
              </h1>
              <div
                className={`${getStatusColor(database.status)} text-xs uppercase h-fit w-fit px-2 py-1 rounded-sm`}
              >
                {database.status}
              </div>
            </div>
          </div>
          <div className="flex flex-row gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="secondary"
                  size="sm"
                  className="cursor-pointer"
                >
                  Actions
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-fit p-2 flex flex-col gap-2">
                {database.status === "stopped" ? (
                  <Button
                    onClick={() => handleAction("start")}
                    variant={"secondary"}
                    className="cursor-pointer"
                    disabled={actionLoading !== null}
                  >
                    {actionLoading === "start" ? "Starting..." : "Start"}
                  </Button>
                ) : (
                  <Button
                    onClick={() => handleAction("stop")}
                    variant={"secondary"}
                    className="cursor-pointer"
                    disabled={actionLoading !== null}
                  >
                    {actionLoading === "stop" ? "Stopping..." : "Stop"}
                  </Button>
                )}
                <Button
                  onClick={() => handleAction("restart")}
                  variant={"secondary"}
                  className="cursor-pointer"
                  disabled={actionLoading !== null}
                >
                  {actionLoading === "restart" ? "Reloading..." : "Reload"}
                </Button>
                <Button
                  onClick={() => handleAction("delete")}
                  className="cursor-pointer"
                  variant={"destructive"}
                  disabled={actionLoading !== null}
                >
                  {actionLoading === "delete" ? "Deleting..." : "Delete"}
                </Button>
              </PopoverContent>
            </Popover>
            {/* Connection String Button */}
            <Dialog
              open={connectionDialogOpen}
              onOpenChange={setConnectionDialogOpen}
            >
              <DialogTrigger asChild>
                <Button
                  size={"sm"}
                  variant={"default"}
                  className="cursor-pointer"
                  onClick={handleOpenConnectionDialog}
                >
                  Connect
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl bg-card">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    Connection String
                  </DialogTitle>
                </DialogHeader>
                <div className="mt-4">
                  {connectionLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="text-neutral-400">
                        Loading connection string...
                      </div>
                    </div>
                  ) : connectionString ? (
                    <div className="bg-neutral-900 rounded-md p-4 border border-border">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-mono text-neutral-500 uppercase">
                          Connection String
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          readOnly
                          className="flex-1 text-sm font-mono break-all"
                          value={connectionString}
                        />

                        <button
                          onClick={() => copyToClipboard(connectionString)}
                          className="p-2 hover:bg-neutral-800 rounded-md transition-colors text-neutral-400 hover:text-neutral-200 flex-shrink-0"
                          title="Copy to clipboard"
                        >
                          {copied ? (
                            <CheckIcon size={20} className="text-green-500" />
                          ) : (
                            <CopyIcon size={20} />
                          )}
                        </button>
                      </div>
                      <div className="text-amber-400 text-sm flex items-start gap-2 bg-amber-500/10 p-3 rounded-md border border-amber-500/20">
                        <span>
                          {connectionWarning ||
                            "Copy this connection string now. You will not be able to see it again. Store it securely."}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-neutral-400">
                      No connection string available
                    </div>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="p-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 w-full">
          {/* CPU Card */}
          <div className="bg-card border border-border rounded-lg">
            <div className="flex flex-row items-center gap-3 px-2 py-1 w-full border-b border-border">
              <span className="text-sm font-medium text-neutral-300">CPU</span>
            </div>
            {metricsLoading ? (
              <div className="h-8 w-16 bg-neutral-800 animate-pulse rounded"></div>
            ) : (
              <div className="p-4">
                <p className="text-2xl font-medium text-neutral-100 font-mono">
                  {metrics?.cpu_usage_percent !== undefined &&
                  metrics?.cpu_usage_percent < 0.01
                    ? metrics?.cpu_usage_percent.toFixed(4)
                    : (metrics?.cpu_usage_percent?.toFixed(1) ?? "0")}
                  %
                </p>
                <p className="text-sm text-neutral-500 ">
                  of {limits?.max_cpu ?? 1} CPU
                  {limits?.max_cpu !== 1 ? "s" : ""}
                </p>
              </div>
            )}
          </div>

          {/* Connections Card */}
          <div className="bg-card border border-border rounded-lg">
            <div className="flex flex-row items-center gap-3 px-2 py-1 border-b border-border">
              <span className="text-sm font-medium text-neutral-300">
                Connections
              </span>
            </div>
            {metricsLoading ? (
              <div className="h-8 w-16 bg-neutral-800 animate-pulse rounded"></div>
            ) : (
              <div className="p-4">
                <p className={`text-2xl font-medium font-mono`}>
                  {metrics?.active_connections ?? 0}
                </p>
                <p className="text-sm text-neutral-500">Active queries</p>
              </div>
            )}
          </div>

          {/* Memory Card */}
          <div className="bg-card border border-border rounded-lg">
            <div className="flex flex-row items-center gap-3 px-2 py-1 border-b border-border">
              <span className="text-sm font-medium text-neutral-300">
                Memory
              </span>
            </div>
            {metricsLoading ? (
              <div className="h-8 w-24 bg-neutral-800 animate-pulse rounded"></div>
            ) : (
              <div className="p-4">
                <p className={`text-2xl font-medium font-mono`}>
                  {metrics?.memory_usage_mb?.toFixed(1) ?? "0"} MB
                </p>
                <p className="text-sm text-neutral-500">
                  {metrics?.memory_usage_percent?.toFixed(1) ?? 0}% of{" "}
                  {(limits?.max_ram_mb ?? 512).toLocaleString()} MB
                </p>
              </div>
            )}
          </div>

          {/* Database Size Card */}
          <div className="bg-card border border-border rounded-lg">
            <div className="flex flex-row items-center gap-3 px-2 py-1 border-b border-border">
              <span className="text-sm font-medium text-neutral-300">Size</span>
            </div>
            {metricsLoading ? (
              <div className="h-8 w-20 bg-neutral-800 animate-pulse rounded"></div>
            ) : (
              <div className="p-4">
                <p className="text-2xl font-medium font-mono">
                  {metrics?.database_size?.replace("SET\n", "") || "0 MB"}
                </p>
                <p className="text-sm text-neutral-500">Database size</p>
              </div>
            )}
          </div>
        </div>

        {/* Database Info Table */}
      </div>
    </div>
  );
}
