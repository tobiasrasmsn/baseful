import {
  CaretDownIcon,
  ClockCounterClockwiseIcon,
  CubeIcon,
  GearSixIcon,
  Globe,
  GraphIcon,
  HouseIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  TableIcon,
  TerminalIcon,
  LockIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
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
import { DitherAvatar } from "../ui/hash-avatar";
import { authFetch } from "@/lib/api";


export default function Sidebar() {
  const { selectedDatabase, setSelectedDatabase, databases, refreshDatabases } =
    useDatabase();
  const { projects, refreshProjects } = useProject();
  const { user, token, logout, } = useAuth();
  const location = useLocation();
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<{
    available: boolean;
    currentHash: string;
    remoteHash: string;
    checkingStatus: boolean;
    updatingStatus: boolean;
  } | null>(null);

  useEffect(() => {
    const checkUpdates = async () => {
      if (!token) return;
      try {
        const res = await authFetch("/api/system/update-status", token, {}, logout);
        if (!res.ok) throw new Error("Status failed");
        const data = await res.json();
        setUpdateStatus(data);
      } catch (e) {
        console.error("Failed to check for updates");
      }
    };

    checkUpdates();
    const interval = setInterval(checkUpdates, 10 * 60 * 1000);

    return () => clearInterval(interval);
  }, [token]);

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

  const handleUpdate = async () => {
    if (
      !confirm(
        "Are you sure you want to update? The system will restart and the dashboard will be unavailable for a few seconds.",
      )
    )
      return;

    try {
      const res = await authFetch("/api/system/update", token, { method: "POST" }, logout);
      if (!res.ok) throw new Error("Update failed");
      // No alert needed, the UI will show the updating state
    } catch (e) {
      alert("Failed to start update. Check backend logs.");
    }
  };



  return (
    <div className="w-72 p-2 flex flex-col h-full">
      <div className="mb-6 flex flex-row items-center justify-between">
        {/* Combined Project/Database Selector */}
        <Popover open={selectorOpen} onOpenChange={setSelectorOpen}>
          <PopoverTrigger asChild>
            <div className="flex flex-row items-center gap-2 cursor-pointer pr-2 pl-1 py-1 rounded-md hover:bg-card transition-colors">
              <DitherAvatar value={selectedDatabase?.name || "database"} size={22} />
              <div className="flex flex-col">
                <h2 className="text-sm font-medium text-nowrap">
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
                <div className="text-sm text-neutral-500 px-2 pb-4">
                  No databases yet. Create one to get started.
                </div>
              ) : (
                Object.entries(databasesByProject).map(([projectId, dbs]) => (
                  <div key={projectId} className="mb-2">
                    {dbs.length > 0 && (
                      <>
                        <div className="flex flex-row items-center mb-1">
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
                                <DitherAvatar value={db?.name || "database"} size={22} />

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
              <li
                className={`py-1.5 px-2.5 rounded-md ${location.pathname ===
                  (selectedDatabase
                    ? `/db/${selectedDatabase.id}/web-server`
                    : "/")
                  ? "bg-muted/50"
                  : ""
                  }`}
              >
                <Link
                  to={
                    selectedDatabase
                      ? `/db/${selectedDatabase.id}/web-server`
                      : "/"
                  }
                  className="text-neutral-100 text-sm flex flex-row items-center gap-2"
                >
                  <Globe size={18} weight="bold" className="text-neutral-400" />
                  <span>Web Server</span>
                </Link>
              </li>
              <li
                className={`py-1.5 px-2.5 rounded-md ${location.pathname ===
                  (selectedDatabase
                    ? `/db/${selectedDatabase.id}/security`
                    : "/")
                  ? "bg-muted/50"
                  : ""
                  }`}
              >
                <Link
                  to={
                    selectedDatabase
                      ? `/db/${selectedDatabase.id}/security`
                      : "/"
                  }
                  className="text-neutral-100 text-sm flex flex-row items-center gap-2"
                >
                  <LockIcon
                    size={18}
                    weight="bold"
                    className="text-neutral-400"
                  />
                  <span>Security</span>
                </Link>
              </li>
            </ul>
          </div>
        )}

        {user?.isAdmin && (
          <div>
            <h2 className="text-xs font-medium text-neutral-400 mb-3 px-2.5">
              ADMIN
            </h2>
            <ul className="flex flex-col gap-1">
              <li
                className={`py-1.5 px-2.5 rounded-md ${location.pathname === "/users" ? "bg-muted/50" : ""
                  }`}
              >
                <Link
                  to="/users"
                  className="text-neutral-100 text-sm flex flex-row items-center gap-2"
                >
                  <UsersIcon
                    size={18}
                    weight="bold"
                    className="text-neutral-400"
                  />
                  <span>Users & Whitelist</span>
                </Link>
              </li>
            </ul>
          </div>
        )}
      </nav>

      {/* Update Status Banner */}
      <div className="mt-auto pt-4 flex flex-col gap-4">
        {/* User Profile Section */}
        {user && (
          <div className="px-2 py-3 mt-4 flex flex-col gap-2">
            <Link
              to="/settings/profile"
              className="flex items-center gap-3 hover:bg-muted/30 p-1 -m-1 rounded-md transition-colors"
            >
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  className="size-8 rounded-sm object-cover bg-muted"
                  alt=""
                />
              ) : (
                <Facehash
                  name={user.email}
                  size={32}
                  colorClasses={["bg-orange-600", "bg-blue-600", "bg-lime-600", "bg-purple-600"]}
                  className="rounded-sm"
                />
              )}
              <div className="flex flex-col min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {user.firstName} {user.lastName}
                </p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {user.email}
                </p>
              </div>
            </Link>


          </div>
        )}

        {updateStatus?.available && (
          <div className="z-100 fixed bottom-5 right-5 bg-neutral-900 border border-border rounded-lg p-3 group animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-base font-medium">
                New Version Available!
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 mb-3 leading-relaxed">
              New features and improvements are ready. Update to the latest
              version.
            </p>
            <button
              onClick={handleUpdate}
              className="w-full h-8 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 transition-all rounded-md text-xs font-medium text-white shadow-lg active:scale-95"
            >
              Update Now
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
