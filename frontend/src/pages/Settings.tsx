import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import {
  Cpu,
  Memory,
  HardDrive,
  ArrowCounterClockwise,
  Warning,
  Check,
  Database,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ResourceLimits {
  max_cpu: number;
  max_ram_mb: number;
  max_storage_mb: number;
}

interface Database {
  id: number;
  name: string;
  type: string;
  host: string;
  port: number;
  status: string;
  version?: string;
  container_id?: string;
}

export default function Settings() {
  const { id } = useParams<{ id: string }>();
  const [database, setDatabase] = useState<Database | null>(null);
  const [limits, setLimits] = useState<ResourceLimits>({
    max_cpu: 1,
    max_ram_mb: 512,
    max_storage_mb: 1024,
  });
  const [originalLimits, setOriginalLimits] = useState<ResourceLimits>({
    max_cpu: 1,
    max_ram_mb: 512,
    max_storage_mb: 1024,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [needsRestart, setNeedsRestart] = useState(false);

  useEffect(() => {
    if (id) {
      fetchDatabase();
      fetchResourceLimits();
    }
  }, [id]);

  const fetchDatabase = async () => {
    try {
      const res = await fetch(`/api/databases/${id}`);
      if (!res.ok) throw new Error("Database not found");
      const data = await res.json();
      setDatabase(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchResourceLimits = async () => {
    try {
      const res = await fetch(`/api/databases/${id}/limits`);
      if (res.ok) {
        const data = await res.json();
        const newLimits = {
          max_cpu: data.max_cpu || 1,
          max_ram_mb: data.max_ram_mb || 512,
          max_storage_mb: data.max_storage_mb || 1024,
        };
        setLimits(newLimits);
        setOriginalLimits(newLimits);
      }
    } catch (err) {
      console.error("Failed to fetch resource limits:", err);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/databases/${id}/limits`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(limits),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update resource limits");
      }

      const data = await res.json();
      setOriginalLimits(limits);
      setSuccess("Resource limits updated successfully");
      setNeedsRestart(data.needs_restart || false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setLimits({ ...originalLimits });
    setError(null);
    setSuccess(null);
  };

  const handleInputChange = (field: keyof ResourceLimits, value: string) => {
    const numValue = parseFloat(value) || 0;
    setLimits((prev) => ({
      ...prev,
      [field]: Math.max(0, numValue),
    }));
  };

  const hasChanges =
    limits.max_cpu !== originalLimits.max_cpu ||
    limits.max_ram_mb !== originalLimits.max_ram_mb ||
    limits.max_storage_mb !== originalLimits.max_storage_mb;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-neutral-500 text-sm">Loading settings...</div>
      </div>
    );
  }

  if (error && !database) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="text-red-400 text-sm">
          {error || "Database not found"}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header - Clean, minimal */}

      <div className="flex flex-row items-center justify-between">
        <div className="flex flex-row border-b border-border p-4 items-center gap-4 w-full">
          <div className="flex flex-row items-center gap-3 flex-1">
            <h1 className="text-2xl font-medium text-neutral-100">
              Settings for {database?.name}
            </h1>
          </div>
          <p className="text-xs text-neutral-500 font-mono bg-neutral-800 px-2 py-1 rounded-sm">
            {database?.type} · {database?.version || "vlatest"}
          </p>
        </div>
      </div>
      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl px-8 py-8">
          {/* Alerts */}
          {success && (
            <div className="mb-6 flex items-center gap-3 px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
              <Check size={16} weight="bold" />
              <span>{success}</span>
            </div>
          )}

          {error && (
            <div className="mb-6 flex items-center gap-3 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              <Warning size={16} weight="bold" />
              <span>{error}</span>
            </div>
          )}

          {needsRestart && (
            <div className="mb-6 flex items-center justify-between px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm">
              <div className="flex items-center gap-3">
                <ArrowCounterClockwise size={16} weight="bold" />
                <span>Restart required for changes to take effect</span>
              </div>
              <button
                onClick={async () => {
                  try {
                    await fetch(`/api/databases/${id}/restart`, {
                      method: "POST",
                    });
                    setNeedsRestart(false);
                    setSuccess("Database restarted successfully");
                  } catch (err) {
                    setError("Failed to restart database");
                  }
                }}
                className="text-xs font-medium underline underline-offset-2 hover:text-amber-300"
              >
                Restart now
              </button>
            </div>
          )}

          {/* Section Title */}
          <div className="mb-8">
            <h2 className="text-sm font-medium text-neutral-200 mb-1">
              Resource Limits
            </h2>
            <p className="text-sm text-neutral-500 leading-relaxed">
              Configure the maximum resources allocated to this database.
              Changes apply immediately but may require a restart depending on
              the database type.
            </p>
          </div>

          {/* Settings List - Linear Style */}
          <div className="space-y-1">
            {/* CPU */}
            <div className="group py-6 border-t border-white/[0.06] first:border-0 first:pt-0">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6">
                <div className="flex items-start gap-4 flex-1">
                  <div className="p-2 rounded-md bg-white/[0.04] text-neutral-400 mt-0.5">
                    <Cpu size={18} weight="bold" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-sm font-medium text-neutral-200">
                      CPU Cores
                    </Label>
                    <p className="text-sm text-neutral-500 leading-relaxed max-w-xs">
                      Maximum CPU cores available for query processing and
                      maintenance tasks.
                    </p>
                  </div>
                </div>

                <div className="sm:w-48 space-y-3">
                  <div className="relative">
                    <Input
                      type="number"
                      min="0.1"
                      max="16"
                      step="0.1"
                      value={limits.max_cpu}
                      onChange={(e) =>
                        handleInputChange("max_cpu", e.target.value)
                      }
                      className="bg-[#0f0f10] border-white/[0.08] text-neutral-200 text-sm h-9 focus:border-blue-500/50 focus:ring-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-500 pointer-events-none">
                      cores
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {[0.5, 1, 2, 4].map((val) => (
                      <button
                        key={val}
                        onClick={() =>
                          setLimits((prev) => ({ ...prev, max_cpu: val }))
                        }
                        className="text-[10px] px-2 py-1 rounded bg-white/[0.04] text-neutral-400 hover:bg-white/[0.08] hover:text-neutral-300 transition-colors border border-white/[0.04]"
                      >
                        {val}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* RAM */}
            <div className="group py-6 border-t border-white/[0.06]">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6">
                <div className="flex items-start gap-4 flex-1">
                  <div className="p-2 rounded-md bg-white/[0.04] text-neutral-400 mt-0.5">
                    <Memory size={18} weight="bold" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-sm font-medium text-neutral-200">
                      Memory
                    </Label>
                    <p className="text-sm text-neutral-500 leading-relaxed max-w-xs">
                      Maximum RAM allocated. Insufficient memory may cause
                      queries to fail or use disk swap.
                    </p>
                  </div>
                </div>

                <div className="sm:w-48 space-y-3">
                  <div className="relative">
                    <Input
                      type="number"
                      min="64"
                      max="32768"
                      step="64"
                      value={limits.max_ram_mb}
                      onChange={(e) =>
                        handleInputChange("max_ram_mb", e.target.value)
                      }
                      className="bg-[#0f0f10] border-white/[0.08] text-neutral-200 text-sm h-9 focus:border-blue-500/50 focus:ring-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-500 pointer-events-none">
                      MB
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[256, 512, 1024, 2048, 4096].map((val) => (
                      <button
                        key={val}
                        onClick={() =>
                          setLimits((prev) => ({ ...prev, max_ram_mb: val }))
                        }
                        className="text-[10px] px-2 py-1 rounded bg-white/[0.04] text-neutral-400 hover:bg-white/[0.08] hover:text-neutral-300 transition-colors border border-white/[0.04]"
                      >
                        {val >= 1024 ? `${val / 1024}GB` : `${val}MB`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Storage */}
            <div className="group py-6 border-t border-white/[0.06]">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6">
                <div className="flex items-start gap-4 flex-1">
                  <div className="p-2 rounded-md bg-white/[0.04] text-neutral-400 mt-0.5">
                    <HardDrive size={18} weight="bold" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-sm font-medium text-neutral-200">
                      Storage
                    </Label>
                    <p className="text-sm text-neutral-500 leading-relaxed max-w-xs">
                      Maximum disk space for data files, indices, and
                      transaction logs.
                    </p>
                  </div>
                </div>

                <div className="sm:w-48 space-y-3">
                  <div className="relative">
                    <Input
                      type="number"
                      min="128"
                      max="1048576"
                      step="128"
                      value={limits.max_storage_mb}
                      onChange={(e) =>
                        handleInputChange("max_storage_mb", e.target.value)
                      }
                      className="bg-[#0f0f10] border-white/[0.08] text-neutral-200 text-sm h-9 focus:border-blue-500/50 focus:ring-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-500 pointer-events-none">
                      MB
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[1024, 5120, 10240, 51200].map((val) => (
                      <button
                        key={val}
                        onClick={() =>
                          setLimits((prev) => ({
                            ...prev,
                            max_storage_mb: val,
                          }))
                        }
                        className="text-[10px] px-2 py-1 rounded bg-white/[0.04] text-neutral-400 hover:bg-white/[0.08] hover:text-neutral-300 transition-colors border border-white/[0.04]"
                      >
                        {val >= 1024 ? `${val / 1024}GB` : `${val}MB`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sticky Footer - Actions */}
      {hasChanges && (
        <div className="border-t border-white/[0.06] bg-[#0a0a0a]/80 backdrop-blur px-8 py-4">
          <div className="max-w-2xl flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-neutral-400">
              <div className="w-2 h-2 rounded-full bg-amber-500" />
              <span>Unsaved changes</span>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                onClick={handleReset}
                disabled={saving}
                className="text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.06] h-8 text-sm"
              >
                Discard
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving}
                className="bg-blue-600 hover:bg-blue-500 text-white h-8 text-sm px-4 gap-2"
              >
                {saving ? (
                  <>
                    <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check size={14} weight="bold" />
                    Save changes
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
