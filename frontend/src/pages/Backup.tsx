import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArchiveIcon,
  ClockCounterClockwiseIcon,
  CloudArrowUpIcon,
  DownloadIcon,
  FloppyDiskIcon,
  GearIcon,
  UploadIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Facehash } from "facehash";
import { useDatabase } from "@/context/DatabaseContext";

interface BackupSettings {
  database_id: number;
  enabled: boolean;
  provider: string;
  endpoint: string;
  region: string;
  bucket: string;
  access_key: string;
  secret_key: string;
  path_prefix: string;
}

interface Backup {
  id: number;
  database_id: number;
  filename: string;
  size_bytes: number;
  status: string;
  s3_url: string;
  error: string;
  created_at: string;
}

export default function Backup() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { selectedDatabase } = useDatabase();

  const [settingsForm, setSettingsForm] = useState<BackupSettings>({
    database_id: parseInt(id || "0"),
    enabled: false,
    provider: "s3",
    endpoint: "",
    region: "us-east-1",
    bucket: "",
    access_key: "",
    secret_key: "",
    path_prefix: "/baseful/backups",
  });

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ["backupSettings", id],
    queryFn: async () => {
      const res = await fetch(`/api/databases/${id}/backups/settings`);
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json() as Promise<BackupSettings>;
    },
    enabled: !!id,
  });

  useEffect(() => {
    if (settings) {
      setSettingsForm(settings);
    }
  }, [settings]);

  const { data: backups, isLoading: backupsLoading } = useQuery({
    queryKey: ["backups", id],
    queryFn: async () => {
      const res = await fetch(`/api/databases/${id}/backups`);
      if (!res.ok) throw new Error("Failed to fetch backups");
      return res.json() as Promise<Backup[]>;
    },
    enabled: !!id,
    refetchInterval: 5000,
  });

  const saveSettingsMutation = useMutation({
    mutationFn: async (newSettings: BackupSettings) => {
      const res = await fetch(`/api/databases/${id}/backups/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSettings),
      });
      if (!res.ok) throw new Error("Failed to save settings");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backupSettings", id] });
      alert("Settings saved successfully");
    },
    onError: (err) => {
      alert("Failed to save settings: " + err.message);
    },
  });

  const manualBackupMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/databases/${id}/backups/manual`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to trigger backup");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backups", id] });
      alert("Backup started");
    },
    onError: (err) => {
      alert("Failed to start backup: " + err.message);
    },
  });

  const [backupToRollback, setBackupToRollback] = useState<number | null>(null);

  const rollbackMutation = useMutation({
    mutationFn: async (backupId: number) => {
      const res = await fetch(
        `/api/databases/${id}/backups/${backupId}/restore`,
        {
          method: "POST",
        },
      );
      if (!res.ok) throw new Error("Failed to trigger restore");
      return res.json();
    },
    onSuccess: () => {
      setBackupToRollback(null);
      alert(
        "Restore started. Database will be unavailable during restoration.",
      );
    },
    onError: (err) => {
      setBackupToRollback(null);
      alert("Failed to start restore: " + err.message);
    },
  });

  // External restore state
  const [externalRestoreMode, setExternalRestoreMode] = useState<
    "file" | "connection"
  >("file");
  const [connectionString, setConnectionString] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const restoreFromFileMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/databases/${id}/restore/file`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Failed to restore from file");
      return res.json();
    },
    onSuccess: () => {
      alert(
        "Restore started. Database will be unavailable during restoration.",
      );
    },
    onError: (err) => {
      alert("Failed to start restore: " + err.message);
    },
  });

  const restoreFromConnectionMutation = useMutation({
    mutationFn: async (connStr: string) => {
      const res = await fetch(`/api/databases/${id}/restore/connection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connection_string: connStr }),
      });
      if (!res.ok) throw new Error("Failed to restore from connection");
      return res.json();
    },
    onSuccess: () => {
      setConnectionString("");
      alert(
        "Restore started. Database will be unavailable during restoration.",
      );
    },
    onError: (err) => {
      alert("Failed to start restore: " + err.message);
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      restoreFromFileMutation.mutate(file);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "text-green-500 bg-green-500/10";
      case "pending":
        return "text-yellow-500 bg-yellow-500/10";
      case "failed":
        return "text-red-500 bg-red-500/10";
      default:
        return "text-neutral-500 bg-neutral-500/10";
    }
  };

  const BackupRow = ({
    backup,
    onRollback,
    isRollingBack,
  }: {
    backup: Backup;
    onRollback: () => void;
    isRollingBack: boolean;
  }) => (
    <TableRow className="border-border hover:bg-muted/50">
      <TableCell>
        <span
          className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(
            backup.status,
          )}`}
        >
          {backup.status}
        </span>
        {backup.error && (
          <div
            className="text-[10px] text-red-400 mt-1 max-w-[200px] truncate"
            title={backup.error}
          >
            {backup.error}
          </div>
        )}
      </TableCell>
      <TableCell className="font-mono text-xs">{backup.filename}</TableCell>
      <TableCell>{formatBytes(backup.size_bytes)}</TableCell>
      <TableCell className="text-neutral-400">
        {new Date(backup.created_at).toLocaleString()}
      </TableCell>
      <TableCell className="text-right flex items-center justify-end gap-2">
        {backup.s3_url && (
          <a
            href={backup.s3_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center p-2 rounded hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors"
            title="Download"
          >
            <DownloadIcon size={18} />
          </a>
        )}
        {backup.status === "completed" && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onRollback}
            disabled={isRollingBack}
            title="Rollback to this this version"
            className="hover:bg-red-500/10 hover:text-red-500 text-neutral-400"
          >
            <ClockCounterClockwiseIcon size={18} />
          </Button>
        )}
      </TableCell>
    </TableRow>
  );

  if (settingsLoading) {
    return <div className="p-8 text-neutral-400">Loading settings...</div>;
  }

  return (
    <div className="flex flex-col gap-6 h-full">
      <div className="flex flex-row border-b border-border p-4 items-center gap-4 w-full">
        <div className="flex flex-row items-center gap-3 flex-1">
          <Facehash
            name={selectedDatabase?.name || "database"}
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
              Backups & Restoration
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!settingsForm.enabled && (
            <div className="text-amber-500 text-xs bg-amber-500/10 px-2 py-1 rounded border border-amber-500/20 flex items-center gap-1">
              <WarningIcon />
              Backups Disabled
            </div>
          )}
        </div>
      </div>
      <Tabs defaultValue="overview" className="flex-1 flex flex-col p-12">
        <TabsList className="w-fit bg-neutral-900 border border-border">
          <TabsTrigger value="overview" className="gap-2">
            <ArchiveIcon /> Overview
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <GearIcon /> Settings
          </TabsTrigger>
          <TabsTrigger value="external" className="gap-2">
            <UploadIcon /> External Restore
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="overview"
          className="flex-1 flex flex-col gap-4 mt-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-neutral-200">
              Recent Backups
            </h2>
            <Button
              onClick={() => manualBackupMutation.mutate()}
              disabled={
                manualBackupMutation.isPending ||
                (settingsForm.provider === "s3" && !settingsForm.bucket)
              }
              className="gap-2"
            >
              {manualBackupMutation.isPending ? (
                "Starting..."
              ) : (
                <>
                  <CloudArrowUpIcon size={18} />
                  Trigger Manual Backup
                </>
              )}
            </Button>
          </div>

          <div className="border border-border rounded-md bg-card flex-1 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border">
                  <TableHead>Status</TableHead>
                  <TableHead>Filename</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Created At</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {backupsLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8">
                      Loading backups...
                    </TableCell>
                  </TableRow>
                ) : backups?.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center py-8 text-neutral-500"
                    >
                      No backups found. Configure settings and trigger a backup.
                    </TableCell>
                  </TableRow>
                ) : (
                  backups?.map((backup) => (
                    <BackupRow
                      key={backup.id}
                      backup={backup}
                      onRollback={() => setBackupToRollback(backup.id)}
                      isRollingBack={
                        rollbackMutation.isPending &&
                        rollbackMutation.variables === backup.id
                      }
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          <div className="max-w-2xl flex flex-col gap-6">
            <div className="border border-border rounded-lg bg-card p-6 flex flex-col gap-6">
              <div className="flex items-center justify-between pb-4 border-b border-border">
                <div className="flex flex-col gap-1">
                  <h3 className="text-lg font-medium text-neutral-100">
                    Backup Configuration
                  </h3>
                  <p className="text-sm text-neutral-500">
                    Configure storage provider and backup settings.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-neutral-300">
                    {settingsForm.enabled ? "Enabled" : "Disabled"}
                  </span>
                  <Switch
                    checked={settingsForm.enabled}
                    onCheckedChange={(c: boolean) =>
                      setSettingsForm({ ...settingsForm, enabled: c })
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-neutral-400">
                    Provider
                  </label>
                  <select
                    className="w-full bg-neutral-900 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    value={settingsForm.provider}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        provider: e.target.value,
                      })
                    }
                  >
                    <option value="s3">S3 Compatible Storage</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-neutral-400">
                    Region
                  </label>
                  <Input
                    value={settingsForm.region}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        region: e.target.value,
                      })
                    }
                    placeholder="us-east-1"
                  />
                </div>

                <div className="space-y-2 col-span-2">
                  <label className="text-xs font-medium text-neutral-400">
                    Endpoint URL
                  </label>
                  <Input
                    value={settingsForm.endpoint}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        endpoint: e.target.value,
                      })
                    }
                    placeholder="https://s3.amazonaws.com"
                  />
                  <p className="text-[10px] text-neutral-500">
                    Leave empty for AWS S3. Required for MinIO, R2, etc.
                  </p>
                </div>

                <div className="space-y-2 col-span-2">
                  <label className="text-xs font-medium text-neutral-400">
                    Bucket Name
                  </label>
                  <Input
                    value={settingsForm.bucket}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        bucket: e.target.value,
                      })
                    }
                    placeholder="my-database-backups"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-neutral-400">
                    Access Key ID
                  </label>
                  <Input
                    type="password"
                    value={settingsForm.access_key}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        access_key: e.target.value,
                      })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-neutral-400">
                    Secret Access Key
                  </label>
                  <Input
                    type="password"
                    value={settingsForm.secret_key}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        secret_key: e.target.value,
                      })
                    }
                  />
                </div>

                <div className="space-y-2 col-span-2">
                  <label className="text-xs font-medium text-neutral-400">
                    Path Prefix
                  </label>
                  <Input
                    value={settingsForm.path_prefix}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        path_prefix: e.target.value,
                      })
                    }
                    placeholder="/baseful/backups"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-border flex justify-end">
                <Button
                  onClick={() => saveSettingsMutation.mutate(settingsForm)}
                  disabled={saveSettingsMutation.isPending}
                  className="gap-2"
                >
                  {saveSettingsMutation.isPending ? (
                    "Saving..."
                  ) : (
                    <>
                      <FloppyDiskIcon /> Save Settings
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="external" className="mt-4">
          <div className="max-w-2xl flex flex-col gap-6">
            <div className="border border-border rounded-lg bg-card p-6 flex flex-col gap-6">
              <div className="flex flex-col gap-1 pb-4 border-b border-border">
                <h3 className="text-lg font-medium text-neutral-100">
                  Restore from External Source
                </h3>
                <p className="text-sm text-neutral-500">
                  Restore your database from a local file or external PostgreSQL
                  connection.
                </p>
              </div>

              <div className="flex flex-col gap-4">
                <div className="flex gap-2">
                  <button
                    onClick={() => setExternalRestoreMode("file")}
                    className={`flex-1 py-3 px-4 rounded-md border text-sm font-medium transition-colors ${
                      externalRestoreMode === "file"
                        ? "border-blue-500 bg-blue-500/10 text-blue-400"
                        : "border-border bg-neutral-900 text-neutral-400 hover:text-neutral-200"
                    }`}
                  >
                    <UploadIcon className="inline-block mr-2" size={16} />
                    Upload File
                  </button>
                  <button
                    onClick={() => setExternalRestoreMode("connection")}
                    className={`flex-1 py-3 px-4 rounded-md border text-sm font-medium transition-colors ${
                      externalRestoreMode === "connection"
                        ? "border-blue-500 bg-blue-500/10 text-blue-400"
                        : "border-border bg-neutral-900 text-neutral-400 hover:text-neutral-200"
                    }`}
                  >
                    <ClockCounterClockwiseIcon
                      className="inline-block mr-2"
                      size={16}
                    />
                    External Connection
                  </button>
                </div>

                {externalRestoreMode === "file" && (
                  <div className="border border-dashed border-border rounded-lg p-8 text-center">
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileSelect}
                      accept=".sql,.dump"
                      className="hidden"
                    />
                    <UploadIcon
                      size={48}
                      className="mx-auto text-neutral-500 mb-4"
                    />
                    <p className="text-neutral-300 mb-2">
                      Click to select a backup file
                    </p>
                    <p className="text-sm text-neutral-500 mb-4">
                      Supports .sql and .dump files
                    </p>
                    <Button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={restoreFromFileMutation.isPending}
                      className="gap-2"
                    >
                      {restoreFromFileMutation.isPending ? (
                        "Starting restore..."
                      ) : (
                        <>
                          <UploadIcon size={18} />
                          Select File
                        </>
                      )}
                    </Button>
                  </div>
                )}

                {externalRestoreMode === "connection" && (
                  <div className="flex flex-col gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-neutral-400">
                        PostgreSQL Connection String
                      </label>
                      <Input
                        value={connectionString}
                        onChange={(e) => setConnectionString(e.target.value)}
                        placeholder="postgresql://user:password@host:5432/database"
                      />
                      <p className="text-[10px] text-neutral-500">
                        Enter a connection string to an external PostgreSQL
                        database. The data will be dumped and restored into this
                        database.
                      </p>
                    </div>
                    <Button
                      onClick={() =>
                        restoreFromConnectionMutation.mutate(connectionString)
                      }
                      disabled={
                        restoreFromConnectionMutation.isPending ||
                        !connectionString
                      }
                      className="gap-2 self-end"
                    >
                      {restoreFromConnectionMutation.isPending ? (
                        "Starting restore..."
                      ) : (
                        <>
                          <ClockCounterClockwiseIcon size={18} />
                          Restore from External DB
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-border">
                <div className="flex items-center gap-2 text-amber-500 text-sm">
                  <WarningIcon size={18} />
                  <span>
                    Warning: This will replace all current data in the database.
                  </span>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog
        open={backupToRollback !== null}
        onOpenChange={(open) => !open && setBackupToRollback(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Rollback</DialogTitle>
            <DialogDescription>
              Are you sure you want to rollback to this backup?
              <br />
              <br />
              <span className="text-red-500 font-bold">
                WARNING: This action is destructive.
              </span>
              <br />
              All current data in this database will be completely replaced by
              the backup data. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBackupToRollback(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (backupToRollback) rollbackMutation.mutate(backupToRollback);
              }}
              disabled={rollbackMutation.isPending}
            >
              {rollbackMutation.isPending
                ? "Restoring..."
                : "I understand, restore backup"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
