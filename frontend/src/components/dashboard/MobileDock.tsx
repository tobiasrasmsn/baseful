import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  HouseIcon,
  TableIcon,
  TerminalIcon,
  ClockCounterClockwiseIcon,
  GearSixIcon,
  GraphIcon,
  CubeIcon,
  ListIcon,
  XIcon,
  CaretDownIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  Globe,
} from "@phosphor-icons/react";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { useDatabase } from "@/context/DatabaseContext";
import { useProject } from "@/context/ProjectContext";
import { Facehash } from "facehash";
import CreateDatabaseDialog from "../database/CreateDatabaseDialog";
import CreateProjectDialog from "../project/CreateProjectDialog";

export default function MobileDock() {
  const { selectedDatabase, databases, refreshDatabases } = useDatabase();
  const { projects, refreshProjects } = useProject();
  const location = useLocation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [isDockVisible, setIsDockVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const scrollContainerRef = useRef<HTMLElement | null>(null);

  // Handle scroll to hide/show dock
  useEffect(() => {
    // Find the scrollable container (the div with overflow-y-auto)
    const findScrollContainer = () => {
      const mainContent = document.querySelector(".overflow-y-auto");
      return mainContent as HTMLElement | null;
    };

    scrollContainerRef.current = findScrollContainer();
    const container = scrollContainerRef.current;

    if (!container) return;

    const handleScroll = () => {
      const currentScrollY = container.scrollTop;
      const scrollDifference = currentScrollY - lastScrollY;

      // Only hide if scrolled down more than 10px
      if (scrollDifference > 10 && currentScrollY > 100) {
        setIsDockVisible(false);
        setIsExpanded(false); // Close menu when hiding
      }
      // Show when scrolling up or at the top
      else if (scrollDifference < -10 || currentScrollY < 100) {
        setIsDockVisible(true);
      }

      setLastScrollY(currentScrollY);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [lastScrollY]);

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

  const getSelectorDisplayText = () => {
    if (!selectedDatabase) return "Select Database";
    let text = selectedDatabase.name;
    if (text.length > 20) {
      text = `${text.slice(0, 17)}...`;
    }
    return text;
  };

  const navItems = selectedDatabase
    ? [
        {
          section: "DATABASE",
          items: [
            {
              name: "Dashboard",
              icon: HouseIcon,
              path: `/db/${selectedDatabase.id}/dashboard`,
            },
            {
              name: "Tables",
              icon: TableIcon,
              path: `/db/${selectedDatabase.id}/tables`,
            },
            {
              name: "SQL Editor",
              icon: TerminalIcon,
              path: `/db/${selectedDatabase.id}/sql-editor`,
            },
            {
              name: "Backup",
              icon: ClockCounterClockwiseIcon,
              path: `/db/${selectedDatabase.id}/backup`,
            },
            {
              name: "Settings",
              icon: GearSixIcon,
              path: `/db/${selectedDatabase.id}/settings`,
            },
          ],
        },
        {
          section: "SERVER",
          items: [
            {
              name: "Monitoring",
              icon: GraphIcon,
              path: `/db/${selectedDatabase.id}/monitoring`,
            },
            {
              name: "Containers",
              icon: CubeIcon,
              path: `/db/${selectedDatabase.id}/containers`,
            },
            {
              name: "Web Server",
              icon: Globe,
              path: `/db/${selectedDatabase.id}/web-server`,
            },
          ],
        },
      ]
    : [];

  const isActivePath = (path: string) => location.pathname === path;

  return (
    <>
      {/* Backdrop */}
      {isExpanded && (
        <div
          className="fixed inset-0 bg-black/50 z-40 animate-in fade-in duration-200 md:hidden"
          onClick={() => setIsExpanded(false)}
        />
      )}

      {/* Expanded Menu */}
      {isExpanded && (
        <div className="fixed bottom-16 left-2 right-2 z-50 bg-card border border-border rounded-xl shadow-2xl animate-in slide-in-from-bottom-4 duration-300 md:hidden max-h-[70vh] overflow-hidden flex flex-col">
          {/* Quick Actions */}
          <div className="flex flex-row gap-2 p-3 border-b border-border">
            <div className="flex-1 bg-muted/50 size-10 text-sm flex items-center gap-2 justify-center rounded-lg text-neutral-400 hover:text-neutral-300 transition-colors duration-200 cursor-pointer active:scale-95">
              <MagnifyingGlassIcon size={16} /> Search
            </div>
            <Popover open={createMenuOpen} onOpenChange={setCreateMenuOpen}>
              <PopoverTrigger asChild>
                <div className="flex-1 bg-muted/50 text-sm  flex items-center gap-2 justify-center rounded-lg text-neutral-400 hover:text-neutral-300 transition-colors duration-200 cursor-pointer active:scale-95">
                  <PlusIcon size={16} /> Create
                </div>
              </PopoverTrigger>
              <PopoverContent className="w-fit p-2" align="end">
                <div className="flex flex-col gap-1">
                  <CreateProjectDialog
                    onProjectCreated={() => {
                      refreshProjects();
                      setCreateMenuOpen(false);
                      setIsExpanded(false);
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
                      setIsExpanded(false);
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

          {/* Navigation Links */}
          <nav className="flex-1 overflow-y-auto p-3">
            {navItems.map((section) => (
              <div key={section.section} className="mb-4">
                <h2 className="text-xs font-medium text-neutral-400 mb-2 px-2">
                  {section.section}
                </h2>
                <ul className="flex flex-col gap-1">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <li key={item.path}>
                        <Link
                          to={item.path}
                          onClick={() => setIsExpanded(false)}
                          className={`flex flex-row items-center gap-3 p-2.5 rounded-lg transition-colors ${
                            isActivePath(item.path)
                              ? "bg-accent text-white"
                              : "text-neutral-300 hover:bg-muted/50"
                          }`}
                        >
                          <Icon
                            size={20}
                            weight="bold"
                            className={
                              isActivePath(item.path)
                                ? "text-white"
                                : "text-neutral-400"
                            }
                          />
                          <span className="text-sm font-medium">
                            {item.name}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}

            {!selectedDatabase && (
              <div className="text-center py-8 text-neutral-500 text-sm">
                Select or create a database to get started
              </div>
            )}
          </nav>
        </div>
      )}

      {/* Floating Dock */}
      <div
        className={`fixed -translate-x-1/2 w-fit transition-all duration-300 left-1/2 right-0 z-50 md:hidden ${
          isDockVisible ? "bottom-4 translate-y-0" : "bottom-0 translate-y-full"
        }`}
      >
        <div className="mx-2 mb-2 bg-card/95 backdrop-blur-lg border border-border rounded-2xl shadow-2xl">
          <div className="flex flex-row justify-between items-center h-14 px-2 gap-2">
            {/* Database Selector */}
            <Popover open={selectorOpen} onOpenChange={setSelectorOpen}>
              <PopoverTrigger asChild>
                <div className="flex flex-row items-center gap-2 cursor-pointer p-2 rounded-xl bg-transparent hover:bg-muted transition-colors min-w-0">
                  <Facehash
                    name={selectedDatabase?.name || "database"}
                    className="rounded-sm shrink-0"
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
                    enableBlink={true}
                  />
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-sm font-medium truncate">
                      {getSelectorDisplayText()}
                    </span>
                  </div>
                  <CaretDownIcon
                    weight="bold"
                    size={12}
                    className="text-neutral-400 flex-shrink-0"
                  />
                </div>
              </PopoverTrigger>
              <PopoverContent className="w-72 max-h-80 overflow-y-auto p-2 pb-0 pt-4 ml-2">
                <div className="flex flex-col gap-2">
                  {(databases || []).length === 0 ? (
                    <div className="text-sm text-neutral-500 px-2 pb-4">
                      No databases yet. Create one to get started.
                    </div>
                  ) : (
                    Object.entries(databasesByProject).map(
                      ([projectId, dbs]) => (
                        <div key={projectId} className="mb-2">
                          {dbs.length > 0 && (
                            <>
                              <div className="flex flex-row items-center">
                                <p className="text-xs text-neutral-400 px-2 font-normal">
                                  {getProjectName(
                                    parseInt(projectId) || undefined,
                                  )}
                                </p>
                              </div>
                              <ul className="flex flex-col gap-1">
                                {dbs.map((db) => (
                                  <li key={db.id}>
                                    <Link
                                      to={`/db/${db.id}/dashboard`}
                                      onClick={() => {
                                        setSelectorOpen(false);
                                      }}
                                      className={`flex flex-row items-center gap-2 p-2 rounded-md transition-colors ${
                                        selectedDatabase?.id === db.id
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
                      ),
                    )
                  )}
                </div>
              </PopoverContent>
            </Popover>

            {/* Menu Button */}
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className={`flex flex-col items-center justify-center gap-0.5 px-4 py-2 rounded-xl transition-all`}
            >
              {isExpanded ? (
                <XIcon size={22} weight="regular" />
              ) : (
                <ListIcon size={22} weight="regular" />
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
