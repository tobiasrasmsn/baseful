import { useState, useMemo } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CopyIcon, CheckIcon, ArrowSquareOut } from "@phosphor-icons/react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Area,
  ComposedChart,
} from "recharts";
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
import { Skeleton } from "@/components/ui/skeleton";

interface Database {
  id: number;
  name: string;
  type: string;
  host: string;
  port: number;
  status: string;
  version: string;
  created_at: string;
  container_id: string;
  token?: string;
  token_expires_at?: string;
}

interface DatabaseMetrics {
  active_connections: number;
  database_size: string;
  cpu_usage_percent: number;
  memory_usage_mb: number;
  memory_limit_mb: number;
  memory_usage_percent: number;
  cache_hit_ratio?: number;
  uptime_seconds?: number;
  max_connections?: number;
  total_transactions?: number;
  longest_query_seconds?: number;
  io_read_bps?: number;
  io_write_bps?: number;
}

interface MetricHistorySample {
  timestamp: string;
  cpu_usage_percent: number;
  memory_usage_mb: number;
  memory_usage_percent: number;
  active_connections: number;
  io_read_bps?: number;
  io_write_bps?: number;
}

export default function DatabaseDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { refreshDatabases } = useDatabase();
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    },
    refetchInterval: 30000,
    staleTime: 1000 * 60 * 5,
  });

  const metricsEnabled = settings?.metrics_enabled ?? true;
  const metricsSampleRate = settings?.metrics_sample_rate ?? 1;

  const {
    data: database,
    isLoading: databaseLoading,
    error: databaseError,
    refetch: refetchDatabase,
  } = useQuery<Database>({
    queryKey: ["database", id],
    queryFn: async () => {
      const res = await fetch(`/api/databases/${id}`);
      if (!res.ok) throw new Error("Database not found");
      return res.json();
    },
    enabled: !!id,
    refetchInterval: 5000,
    staleTime: 1000 * 30,
  });

  const { data: metrics, isLoading: metricsLoading } =
    useQuery<DatabaseMetrics>({
      queryKey: ["metrics", id],
      queryFn: async () => {
        const res = await fetch(`/api/databases/${id}/metrics`);
        if (!res.ok) throw new Error("Failed to fetch metrics");
        return res.json();
      },
      enabled: !!id && database?.status === "active",
      refetchInterval: 5000,
      staleTime: 1000 * 5,
    });

  const { data: history = [] } = useQuery<MetricHistorySample[]>({
    queryKey: ["history", id],
    queryFn: async () => {
      const res = await fetch(`/api/databases/${id}/metrics/history`);
      if (!res.ok) throw new Error("Failed to fetch history");
      return res.json();
    },
    enabled: !!id && database?.status === "active" && metricsEnabled,
    refetchInterval: 10000,
    staleTime: 1000 * 10,
  });

  const { data: limits } = useQuery<{
    max_cpu: number;
    max_ram_mb: number;
    max_storage_mb: number;
  }>({
    queryKey: ["limits", id],
    queryFn: async () => {
      const res = await fetch(`/api/databases/${id}/limits`);
      if (!res.ok) throw new Error("Failed to fetch limits");
      return res.json();
    },
    enabled: !!id,
  });

  const aggregatedHistory = useMemo(() => {
    if (!history || history.length === 0) return [];

    const result: MetricHistorySample[] = [];
    const chunkSize = Math.max(1, Math.floor(60 / metricsSampleRate));

    for (let i = 0; i < history.length; i += chunkSize) {
      const chunk = history.slice(i, i + chunkSize);
      const count = chunk.length;

      const aggregated = chunk.reduce(
        (acc, curr) => ({
          cpu_usage_percent: acc.cpu_usage_percent + curr.cpu_usage_percent,
          memory_usage_percent:
            acc.memory_usage_percent + curr.memory_usage_percent,
          memory_usage_mb: acc.memory_usage_mb + curr.memory_usage_mb,
          active_connections: Math.max(
            acc.active_connections,
            curr.active_connections,
          ),
          io_read_bps: acc.io_read_bps + (curr.io_read_bps || 0),
          io_write_bps: acc.io_write_bps + (curr.io_write_bps || 0),
        }),
        {
          cpu_usage_percent: 0,
          memory_usage_percent: 0,
          memory_usage_mb: 0,
          active_connections: 0,
          io_read_bps: 0,
          io_write_bps: 0,
        },
      );

      result.push({
        timestamp: chunk[0].timestamp,
        cpu_usage_percent:
          Math.round((aggregated.cpu_usage_percent / count) * 10) / 10,
        memory_usage_percent:
          Math.round((aggregated.memory_usage_percent / count) * 10) / 10,
        memory_usage_mb:
          Math.round((aggregated.memory_usage_mb / count) * 10) / 10,
        active_connections: aggregated.active_connections,
        io_read_bps: Math.round((aggregated.io_read_bps / count) * 10) / 10,
        io_write_bps: Math.round((aggregated.io_write_bps / count) * 10) / 10,
      });
    }

    return result;
  }, [history, metricsSampleRate]);

  const loading = databaseLoading;
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const error = databaseError ? (databaseError as Error).message : null;
  const [copied, setCopied] = useState(false);
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
  const [connectionString, setConnectionString] = useState("");
  const [connectionWarning, setConnectionWarning] = useState("");

  const [connectionLoading, setConnectionLoading] = useState(false);
  const [useSSL, setUseSSL] = useState(true);
  const [useDomain, setUseDomain] = useState(false);

  const currentHostname = window.location.hostname;
  const isIP = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(currentHostname);
  const isLocal =
    currentHostname === "localhost" || currentHostname === "127.0.0.1";
  const canUseDomain = !isIP && !isLocal;

  const displayConnectionString = useMemo(() => {
    if (!connectionString) return "";

    let finalHost = "";
    if (useDomain) {
      finalHost = currentHostname;
    } else if (isIP && !isLocal) {
      finalHost = currentHostname;
    }

    if (finalHost) {
      // Replace the host in postgresql://token:JWT@HOST:PORT/db_ID
      return connectionString.replace(/@([^:/]+)/, `@${finalHost}`);
    }

    return connectionString;
  }, [connectionString, useDomain, currentHostname, isIP, isLocal]);

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
      if (!res.ok) {
        throw new Error(`Failed to ${action} database`);
      }

      if (action === "delete") {
        refreshDatabases();
        navigate("/");
        return;
      }

      // Refresh database status
      refetchDatabase();
      refreshDatabases();
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
    setConnectionLoading(true);
    try {
      const res = await fetch(
        `/api/databases/${id}/connection-string?ssl=${useSSL}`,
      );
      if (res.ok) {
        const data = await res.json();
        setConnectionString(data.connection_string);
        setConnectionWarning(data.warning || "");
      }
    } catch (err: unknown) {
      console.error("Failed to fetch connection string:", err);
    } finally {
      setConnectionLoading(false);
    }
  };

  const handleOpenConnectionDialog = async () => {
    setConnectionDialogOpen(true);
    await fetchConnectionString();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-green-600/10 text-green-300";
      case "starting":
        return "bg-yellow-600/10 text-yellow-300";
      case "stopped":
        return "bg-red-600/10 text-red-300";
      default:
        return "bg-gray-600/10 text-gray-300";
    }
  };

  const formatUptime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    if (seconds < 86400)
      return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B/s";
    const k = 1024;
    const sizes = ["B/s", "KB/s", "MB/s", "GB/s"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  if (!metricsEnabled) {
    return (
      <div className="p-12">
        <h1 className="text-4xl font-bold text-neutral-100">Hello</h1>
        <p className="text-neutral-500 mt-4">
          Monitoring is currently disabled in settings.
        </p>
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
              {loading ? (
                <Skeleton className="h-8 w-48" />
              ) : (
                <>
                  <h1 className="text-2xl font-medium text-neutral-100">
                    {database?.name}
                  </h1>
                  <div
                    className={`${getStatusColor(database?.status || "")} text-xs uppercase h-fit w-fit px-2 py-1 rounded-sm`}
                  >
                    {database?.status}
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-row gap-2">
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 border-border bg-neutral-900 text-neutral-300 hover:text-neutral-100"
                  >
                    Actions
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-fit p-2 flex flex-col gap-2">
                  {database?.status === "stopped" ? (
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
            )}
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
                  {canUseDomain && (
                    <>
                      <div className="flex items-center justify-between mb-4 p-3 bg-neutral-800/50 rounded-lg border border-border">
                        <div className="flex items-center gap-3">
                          <div className="flex flex-col">
                            <span className="text-sm font-medium text-neutral-200">
                              Use Domain Name
                            </span>
                            <span className="text-xs text-neutral-500">
                              Connect via {currentHostname} instead of IP
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={() => setUseDomain(!useDomain)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            useDomain ? "bg-blue-600" : "bg-neutral-600"
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              useDomain ? "translate-x-6" : "translate-x-1"
                            }`}
                          />
                        </button>
                      </div>
                    </>
                  )}

                  <div className="flex items-center justify-between mb-4 p-3 bg-neutral-800/50 rounded-lg border border-border">
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-neutral-200">
                          SSL/TLS Encryption
                        </span>
                        <span className="text-xs text-neutral-500">
                          {useDomain
                            ? "Encrypted connection via domain certificate"
                            : "Use encrypted connection to the database"}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => setUseSSL(!useSSL)}
                      disabled={useDomain}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        useSSL || useDomain ? "bg-green-600" : "bg-neutral-600"
                      } ${useDomain ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          useSSL || useDomain
                            ? "translate-x-6"
                            : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>

                  {connectionLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="text-neutral-400">
                        Loading connection string...
                      </div>
                    </div>
                  ) : displayConnectionString ? (
                    <div className="bg-neutral-900 rounded-md p-4 border border-border">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-mono text-neutral-500 uppercase">
                          Connection String {useSSL && "(SSL)"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          readOnly
                          className="flex-1 text-sm font-mono break-all"
                          value={displayConnectionString}
                        />

                        <button
                          onClick={() =>
                            copyToClipboard(displayConnectionString)
                          }
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

        <div className="p-12 pb-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 w-full">
          <div className="bg-card border border-border rounded-lg">
            <div className="flex flex-row items-center gap-3 px-2 py-1 w-full border-b border-border">
              <span className="text-sm font-medium text-neutral-300">CPU</span>
            </div>
            {metricsLoading ? (
              <div className="p-4">
                <div className="h-8 w-16 bg-neutral-800 animate-pulse rounded"></div>
              </div>
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

          <div className="bg-card border border-border rounded-lg">
            <div className="flex flex-row items-center gap-3 px-2 py-1 border-b border-border">
              <span className="text-sm font-medium text-neutral-300">
                Connections
              </span>
            </div>
            <div className="p-4 flex flex-row items-end justify-between">
              <div>
                {metricsLoading ? (
                  <Skeleton className="h-8 w-16 mb-1" />
                ) : (
                  <p className={`text-2xl font-medium font-mono`}>
                    {metrics?.active_connections ?? 0}
                  </p>
                )}
                <p className="text-sm text-neutral-500">Active queries</p>
              </div>
              {!metricsLoading && (
                <Link to={`/db/${id}/connections`}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs gap-1.5 text-neutral-400 hover:text-neutral-100"
                  >
                    Details
                    <ArrowSquareOut size={14} />
                  </Button>
                </Link>
              )}
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg">
            <div className="flex flex-row items-center gap-3 px-2 py-1 border-b border-border">
              <span className="text-sm font-medium text-neutral-300">
                Memory
              </span>
            </div>
            <div className="p-4">
              {metricsLoading ? (
                <>
                  <Skeleton className="h-8 w-24 mb-1" />
                  <Skeleton className="h-4 w-32" />
                </>
              ) : (
                <>
                  <p className={`text-2xl font-medium font-mono`}>
                    {metrics?.memory_usage_mb?.toFixed(1) ?? "0"} MB
                  </p>
                  <p className="text-sm text-neutral-500">
                    {metrics?.memory_usage_percent?.toFixed(1) ?? 0}% of{" "}
                    {(limits?.max_ram_mb ?? 512).toLocaleString()} MB
                  </p>
                </>
              )}
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg">
            <div className="flex flex-row items-center gap-3 px-2 py-1 border-b border-border">
              <span className="text-sm font-medium text-neutral-300">Size</span>
            </div>
            <div className="p-4">
              {metricsLoading ? (
                <Skeleton className="h-8 w-24 mb-1" />
              ) : (
                <p className="text-2xl font-medium font-mono">
                  {metrics?.database_size?.replace("SET\n", "") || "0 MB"}
                </p>
              )}
              <p className="text-sm text-neutral-500">Database size</p>
            </div>
          </div>
        </div>

        <div className="px-12 pb-4 grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
          <div className="bg-card border border-border rounded-lg">
            <div className="flex flex-row items-center gap-3 px-2 py-1 border-b border-border">
              <span className="text-sm font-medium text-neutral-300">
                Cache Hit Ratio
              </span>
            </div>
            <div className="p-4">
              {metricsLoading ? (
                <Skeleton className="h-8 w-20 mb-1" />
              ) : (
                <p
                  className={`text-2xl font-medium font-mono ${metrics?.cache_hit_ratio && metrics.cache_hit_ratio < 95 ? "text-amber-400" : "text-neutral-100"}`}
                >
                  {metrics?.cache_hit_ratio?.toFixed(2) ?? "0.00"}%
                </p>
              )}
              <p className="text-sm text-neutral-500">Data served from RAM</p>
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg">
            <div className="flex flex-row items-center gap-3 px-2 py-1 border-b border-border">
              <span className="text-sm font-medium text-neutral-300">
                Uptime
              </span>
            </div>
            <div className="p-4">
              {metricsLoading ? (
                <Skeleton className="h-8 w-28 mb-1" />
              ) : (
                <p className="text-2xl font-medium text-neutral-100 font-mono">
                  {metrics?.uptime_seconds
                    ? formatUptime(metrics.uptime_seconds)
                    : "0s"}
                </p>
              )}
              <p className="text-sm text-neutral-500">Since last restart</p>
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg">
            <div className="flex flex-row items-center gap-3 px-2 py-1 border-b border-border">
              <span className="text-sm font-medium text-neutral-300">
                Longest Query
              </span>
            </div>
            <div className="p-4">
              {metricsLoading ? (
                <Skeleton className="h-8 w-16 mb-1" />
              ) : (
                <p
                  className={`text-2xl font-medium font-mono ${metrics?.longest_query_seconds && metrics.longest_query_seconds > 60 ? "text-red-400" : "text-neutral-100"}`}
                >
                  {metrics?.longest_query_seconds?.toFixed(1) ?? "0.0"}s
                </p>
              )}
              <p className="text-sm text-neutral-500">
                Oldest active transaction
              </p>
            </div>
          </div>
        </div>

        <div className="px-12 grid grid-cols-1 lg:grid-cols-2 gap-6 w-full">
          {/* CPU & Memory Chart */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="p-4 flex flex-row justify-between items-center">
              <h3 className="text-2xl font-medium text-neutral-300 mb-6">
                Resource Usage (1H)
              </h3>
              {!metricsLoading && (
                <div className="flex flex-row items-center gap-1">
                  <div className="bg-blue-500/10 text-xs font-mono text-blue-300 px-2 py-1 rounded-sm">
                    <h2>CPU</h2>
                  </div>
                  <div className="bg-purple-500/10 text-xs font-mono text-purple-300 px-2 py-1 rounded-sm">
                    <h2>RAM</h2>
                  </div>
                  <div className="bg-orange-500/10 text-xs font-mono text-orange-300 px-2 py-1 rounded-sm">
                    <h2>DR</h2>
                  </div>
                  <div className="bg-emerald-500/10 text-xs font-mono text-emerald-300 px-2 py-1 rounded-sm">
                    <h2>DW</h2>
                  </div>
                </div>
              )}
            </div>
            <div className="h-[250px] w-full p-4 scale-105">
              {metricsLoading ? (
                <Skeleton className="h-full w-full rounded-md" />
              ) : (
                <div className="h-full w-full scale-105">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={aggregatedHistory}>
                      <defs>
                        <linearGradient
                          id="colorCpu"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#3b82f6"
                            stopOpacity={0.3}
                          />
                          <stop
                            offset="95%"
                            stopColor="#3b82f6"
                            stopOpacity={0}
                          />
                        </linearGradient>
                        <linearGradient
                          id="colorMem"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#a855f7"
                            stopOpacity={0.3}
                          />
                          <stop
                            offset="95%"
                            stopColor="#a855f7"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>

                      <XAxis dataKey="timestamp" hide />
                      <YAxis yAxisId="left" hide />
                      <YAxis yAxisId="right" orientation="right" hide />

                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#171717",
                          border: "1px solid #333",
                          fontSize: "12px",
                          borderRadius: "8px",
                        }}
                        labelFormatter={(timestamp) => {
                          return new Date(timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          });
                        }}
                        formatter={(
                          value: number | undefined,
                          name: string | undefined,
                        ) => {
                          const label = name || "Metric";
                          if (value === undefined) return ["-", label];
                          if (
                            label.includes("Read") ||
                            label.includes("Write")
                          ) {
                            return [formatBytes(value), label];
                          }
                          return [`${value}%`, label];
                        }}
                      />
                      <Area
                        yAxisId="left"
                        type="monotone"
                        dataKey="cpu_usage_percent"
                        name="CPU %"
                        stroke="#3b82f6"
                        fillOpacity={1}
                        fill="url(#colorCpu)"
                        isAnimationActive={false}
                      />
                      <Area
                        yAxisId="left"
                        type="monotone"
                        dataKey="memory_usage_percent"
                        name="Memory %"
                        stroke="#a855f7"
                        fillOpacity={1}
                        fill="url(#colorMem)"
                        isAnimationActive={false}
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="io_read_bps"
                        name="Disk Read"
                        stroke="#fdba74"
                        dot={false}
                        isAnimationActive={false}
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="io_write_bps"
                        name="Disk Write"
                        stroke="#6ee7b7"
                        dot={false}
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          {/* Connections Chart */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="p-4">
              <h3 className="text-2xl font-medium text-neutral-300 mb-6">
                Peak Connections (1H)
              </h3>
            </div>
            <div className="h-[250px] w-full p-4 scale-105">
              {metricsLoading ? (
                <Skeleton className="h-full w-full rounded-md" />
              ) : (
                <div className="h-full w-full scale-105">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={aggregatedHistory}>
                      <XAxis dataKey="timestamp" hide />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#171717",
                          border: "1px solid #333",
                          fontSize: "12px",
                          borderRadius: "12px",
                        }}
                        labelFormatter={(timestamp) => {
                          return new Date(timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          });
                        }}
                      />
                      <Line
                        type="stepAfter"
                        dataKey="active_connections"
                        name="Connections"
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
