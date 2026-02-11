import {
  CaretDownIcon,
  ClockCounterClockwiseIcon,
  CubeIcon,
  GearSixIcon,
  GraphIcon,
  HouseIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  TableIcon,
  TerminalIcon,
  Sparkle,
  ArrowClockwise,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Facehash } from "facehash";
import CreateDatabaseDialog from "@/components/database/CreateDatabaseDialog";
import CreateProjectDialog from "@/components/project/CreateProjectDialog";
import { useDatabase } from "@/context/DatabaseContext";
import { useProject } from "@/context/ProjectContext";

export default function Sidebar() {
  const { selectedDatabase, setSelectedDatabase, databases, refreshDatabases } =
    useDatabase();
  const { projects, refreshProjects } = useProject();
  const location = useLocation();
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<{
    available: boolean;
    currentHash: string;
    remoteHash: string;
    checkingStatus: boolean;
  } | null>(null);

  useEffect(() => {
    const checkUpdates = async () => {
      try {
        const res = await fetch("/api/system/update-status");
        const data = await res.json();
        setUpdateStatus(data);
      } catch (e) {
        console.error("Failed to check for updates");
      }
    };

    checkUpdates();
    // Check every 10 minutes from the frontend too
    const interval = setInterval(checkUpdates, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const pathParts = location.pathname.split("/");
    const dbIdIndex = pathParts.indexOf("db");

    if (dbIdIndex !== -1 && pathParts[dbIdIndex + 1]) {
      const dbId = parseInt(pathParts[dbIdIndex + 1]);
      const db = (databases || []).find((d) => d.id === dbId);
      if (db && (!selectedDatabase || selectedDatabase.id !== db.id)) {
        setSelectedDatabase(db);
      }
    }
  }, [location.pathname, databases, selectedDatabase, setSelectedDatabase]);

  // Group databases by project
  const databasesByProject = (databases || []).reduce(
    (acc, db) => {
      const projectId = db.projectId || 0;
      if (!acc[projectId]) {
        acc[projectId] = [];
      }
      acc[projectId].push(db);
      return acc;
    },
    {} as Record<number, typeof databases>,
  );

  const getProjectName = (projectId: number | undefined) => {
    if (!projectId || projectId === 0) return "No Project";
    const project = projects.find((p) => p.id === projectId);
    return project?.name || "Unknown Project";
  };

  // Get display text for selector trigger
  const getSelectorDisplayText = () => {
    if (!selectedDatabase) return "Select Database";
    let text = selectedDatabase.name;
    if (text.length > 15) {
      text = `${text.slice(0, 12)}...`;
    }

    return text;
  };

  const [isUpdating, setIsUpdating] = useState(false);

  const handleUpdate = async () => {
    if (
      !confirm(
        "Are you sure you want to update? The system will restart and the dashboard will be unavailable for a few seconds.",
      )
    )
      return;

    setIsUpdating(true);
    try {
      const res = await fetch("/api/system/update", { method: "POST" });
      if (!res.ok) throw new Error("Update failed");
      alert(
        "Update initiated! The system is rebuilding in the background. Please refresh this page in about 30 seconds.",
      );
    } catch (e) {
      alert("Failed to start update. Check backend logs.");
      setIsUpdating(false);
    }
  };

  const handleManualCheck = async () => {
    try {
      const res = await fetch("/api/system/update-check", { method: "POST" });
      const data = await res.json();
      setUpdateStatus(data);
    } catch (e) {
      console.error("Manual check failed");
    }
  };

  return (
    <div className="w-72 p-2 flex flex-col h-full">
      <div className="mb-6 flex flex-row items-center justify-between">
        {/* Combined Project/Database Selector */}
        <Popover open={selectorOpen} onOpenChange={setSelectorOpen}>
          <PopoverTrigger asChild>
            <div className="flex flex-row items-center gap-2 cursor-pointer pr-2 pl-1 py-1 rounded-md hover:bg-card transition-colors">
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
                size={22}
              />
              <div className="flex flex-col">
                <h2 className="text-sm font-medium">
                  {getSelectorDisplayText()}
                </h2>
              </div>
              <CaretDownIcon
                weight="bold"
                size={12}
                className="text-neutral-400 ml-auto"
              />
            </div>
          </PopoverTrigger>
          <PopoverContent className="w-64 max-h-96 overflow-y-auto p-2 pb-0 pt-4 ml-2">
            <div className="flex flex-col gap-2">
              {(databases || []).length === 0 ? (
                <div className="text-sm text-neutral-500">
                  No databases yet. Create one to get started.
                </div>
              ) : (
                Object.entries(databasesByProject).map(([projectId, dbs]) => (
                  <div key={projectId} className="mb-2">
                    {dbs.length > 0 && (
                      <>
                        <div className="flex flex-row items-center">
                          <p className="text-xs text-neutral-400 px-2 font-normal">
                            {getProjectName(parseInt(projectId) || undefined)}
                          </p>
                        </div>
                        <ul className="flex flex-col gap-1">
                          {dbs.map((db) => (
                            <li>
                              <Link
                                key={db.id}
                                to={`/db/${db.id}/dashboard`}
                                onClick={() => setSelectorOpen(false)}
                                className={`flex flex-row items-center gap-2 p-2 rounded-md transition-colors ${selectedDatabase?.id === db.id
                                  ? "bg-accent"
                                  : "hover:bg-accent"
                                  }`}
                              >
                                <Facehash
                                  name={db.name}
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
                                  size={20}
                                />
                                <span className="text-sm text-neutral-200">
                                  {db.name}
                                </span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* Branch Selector */}

        {/* Actions */}
        <div className="flex flex-row gap-1 px-1">
          <div className="bg-card size-6 flex items-center justify-center rounded-sm text-neutral-400 hover:text-neutral-300 transition-colors duration-200 cursor-pointer">
            <MagnifyingGlassIcon size={16} />
          </div>
          <Popover open={createMenuOpen} onOpenChange={setCreateMenuOpen}>
            <PopoverTrigger asChild>
              <div className="bg-card size-6 flex items-center justify-center rounded-sm text-neutral-400 hover:text-neutral-300 transition-colors duration-200 cursor-pointer">
                <PlusIcon size={16} />
              </div>
            </PopoverTrigger>
            <PopoverContent className="w-fit p-2" align="end">
              <div className="flex flex-col gap-1">
                <CreateProjectDialog
                  onProjectCreated={() => {
                    refreshProjects();
                    setCreateMenuOpen(false);
                  }}
                >
                  <button className="flex focus:ring-0 flex-row items-center gap-2 p-2 rounded-md hover:bg-accent transition-colors text-left w-full">
                    <span className="text-sm">New Project</span>
                  </button>
                </CreateProjectDialog>
                <CreateDatabaseDialog
                  onDatabaseCreated={() => {
                    refreshDatabases();
                    setCreateMenuOpen(false);
                  }}
                >
                  <button className="flex flex-row items-center gap-2 p-2 rounded-md hover:bg-accent transition-colors text-left w-full">
                    <span className="text-sm">New Database</span>
                  </button>
                </CreateDatabaseDialog>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-8">
        {selectedDatabase && (
          <div>
            <h2 className="text-xs font-medium text-neutral-400 mb-3 px-2.5">
              DATABASE
            </h2>

            <ul className="flex flex-col gap-1">
              <li
                className={`py-1.5 px-2.5 rounded-md ${location.pathname ===
                  (selectedDatabase
                    ? `/db/${selectedDatabase.id}/dashboard`
                    : "/")
                  ? "bg-muted/50"
                  : ""
                  }`}
              >
                <Link
                  to={
                    selectedDatabase
                      ? `/db/${selectedDatabase.id}/dashboard`
                      : "/"
                  }
                  className="text-neutral-100 text-sm flex flex-row items-center gap-2"
                >
                  <HouseIcon
                    size={18}
                    weight="bold"
                    className="text-neutral-400"
                  />
                  <span>Dashboard</span>
                </Link>
              </li>
              <li
                className={`py-1.5 px-2.5 rounded-md ${location.pathname ===
                  (selectedDatabase ? `/db/${selectedDatabase.id}/tables` : "/")
                  ? "bg-muted/50"
                  : ""
                  }`}
              >
                <Link
                  to={
                    selectedDatabase ? `/db/${selectedDatabase.id}/tables` : "/"
                  }
                  className="text-neutral-100 text-sm flex flex-row items-center gap-2"
                >
                  <TableIcon
                    size={18}
                    weight="bold"
                    className="text-neutral-400"
                  />
                  <span>Tables</span>
                </Link>
              </li>
              <li
                className={`py-1.5 px-2.5 rounded-md ${location.pathname ===
                  (selectedDatabase
                    ? `/db/${selectedDatabase.id}/sql-editor`
                    : "/")
                  ? "bg-muted/50"
                  : ""
                  }`}
              >
                <Link
                  to={
                    selectedDatabase
                      ? `/db/${selectedDatabase.id}/sql-editor`
                      : "/"
                  }
                  className="text-neutral-100 text-sm flex flex-row items-center gap-2"
                >
                  <TerminalIcon
                    size={18}
                    weight="bold"
                    className="text-neutral-400"
                  />
                  <span>SQL Editor</span>
                </Link>
              </li>

              <li
                className={`py-1.5 px-2.5 rounded-md ${location.pathname ===
                  (selectedDatabase ? `/db/${selectedDatabase.id}/backup` : "/")
                  ? "bg-muted/50"
                  : ""
                  }`}
              >
                <Link
                  to={
                    selectedDatabase ? `/db/${selectedDatabase.id}/backup` : "/"
                  }
                  className="text-neutral-100 text-sm flex flex-row items-center gap-2"
                >
                  <ClockCounterClockwiseIcon
                    size={18}
                    weight="bold"
                    className="text-neutral-400"
                  />
                  <span>Backup</span>
                </Link>
              </li>

              <li
                className={`py-1.5 px-2.5 rounded-md ${location.pathname ===
                  (selectedDatabase
                    ? `/db/${selectedDatabase.id}/settings`
                    : "/")
                  ? "bg-muted/50"
                  : ""
                  }`}
              >
                <Link
                  to={
                    selectedDatabase
                      ? `/db/${selectedDatabase.id}/settings`
                      : "/"
                  }
                  className="text-neutral-100 text-sm flex flex-row items-center gap-2"
                >
                  <GearSixIcon
                    size={18}
                    weight="bold"
                    className="text-neutral-400"
                  />
                  <span>Settings</span>
                </Link>
              </li>
            </ul>
          </div>
        )}

        {selectedDatabase && (
          <div>
            {/* Actions */}
            <h2 className="text-xs font-medium text-neutral-400 mb-3 px-2.5">
              SERVER
            </h2>
            <ul className="flex flex-col gap-1">
              <li
                className={`py-1.5 px-2.5 rounded-md ${location.pathname ===
                  (selectedDatabase
                    ? `/db/${selectedDatabase.id}/monitoring`
                    : "/")
                  ? "bg-muted/50"
                  : ""
                  }`}
              >
                <Link
                  to={
                    selectedDatabase
                      ? `/db/${selectedDatabase.id}/monitoring`
                      : "/"
                  }
                  className="text-neutral-100 text-sm flex flex-row items-center gap-2"
                >
                  <GraphIcon
                    size={18}
                    weight="bold"
                    className="text-neutral-400"
                  />
                  <span>Monitoring</span>
                </Link>
              </li>
              <li
                className={`py-1.5 px-2.5 rounded-md ${location.pathname ===
                  (selectedDatabase
                    ? `/db/${selectedDatabase.id}/containers`
                    : "/")
                  ? "bg-muted/50"
                  : ""
                  }`}
              >
                <Link
                  to={
                    selectedDatabase
                      ? `/db/${selectedDatabase.id}/containers`
                      : "/"
                  }
                  className="text-neutral-100 text-sm flex flex-row items-center gap-2"
                >
                  <CubeIcon
                    size={18}
                    weight="bold"
                    className="text-neutral-400"
                  />
                  <span>Containers</span>
                </Link>
              </li>
            </ul>
          </div>
        )}
      </nav>

      {/* Update Status Banner */}
      <div className="mt-auto pt-4">
        {updateStatus?.available && (
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 group animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium text-blue-400">
                New Version Available!
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 mb-3 leading-relaxed">
              New features and improvements are ready. Update to the latest
              version.
            </p>
            <button
              onClick={handleUpdate}
              disabled={isUpdating}
              className="w-full h-8 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all rounded-md text-xs font-medium text-white shadow-lg active:scale-95"
            >
              {isUpdating ? "Updating..." : "Update Now"}
            </button>
          </div>
        )}

        <div className="px-2.5 flex items-center justify-between text-[10px] text-neutral-500">
          <div className="flex items-center gap-2">
            <span>v1.0.0</span>
            <button
              onClick={handleManualCheck}
              disabled={updateStatus?.checkingStatus}
              className="hover:text-blue-400 transition-colors disabled:opacity-50"
              title="Check for updates"
            >
              <ArrowClockwise
                size={10}
                className={updateStatus?.checkingStatus ? "animate-spin" : ""}
              />
            </button>
          </div>
          <span className="opacity-50">
            {updateStatus?.currentHash?.slice(0, 7) || "dev"}
          </span>
        </div>
      </div>
    </div>
  );
}
