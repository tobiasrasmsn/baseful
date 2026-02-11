import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PlusIcon } from "@phosphor-icons/react";
import { useDatabase } from "@/context/DatabaseContext";
import { useNavigate } from "react-router-dom";

interface Project {
  id: number;
  name: string;
  description: string;
}

interface CreateDatabaseDialogProps {
  onDatabaseCreated: () => void;
  children?: React.ReactNode;
}

export default function CreateDatabaseDialog({
  onDatabaseCreated,
  children,
}: CreateDatabaseDialogProps) {
  const { setSelectedDatabase } = useDatabase();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("postgresql");
  const [version, setVersion] = useState("15");
  const [projectId, setProjectId] = useState<string>("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [maxCpu, setMaxCpu] = useState<number>(1);
  const [maxRamMb, setMaxRamMb] = useState<number>(512);
  const [maxStorageMb, setMaxStorageMb] = useState<number>(1024);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      fetchProjects();
    }
  }, [open]);

  const fetchProjects = async () => {
    try {
      const response = await fetch("/api/projects");
      const data = await response.json();
      setProjects(data);
      if (data.length > 0 && !projectId) {
        setProjectId(String(data[0].id));
      }
    } catch (err) {
      console.error("Failed to fetch projects:", err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (!projectId) {
      setError("Please select a project");
      setLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/databases", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          type,
          version,
          projectId: parseInt(projectId),
          maxCpu,
          maxRamMb,
          maxStorageMb,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create database");
      }

      const data = await response.json();

      // Auto-select the new database and navigate to it
      if (data.id) {
        const newDatabase = {
          id: data.id,
          name: name,
          type: type,
          host: data.internal_host || "",
          port: 5432,
          status: "active",
          projectId: parseInt(projectId),
        };
        setSelectedDatabase(newDatabase);
        navigate(`/db/${data.id}/dashboard`);
      }

      setName("");
      setType("postgresql");
      setVersion("15");
      setProjectId("");
      setMaxCpu(1);
      setMaxRamMb(512);
      setMaxStorageMb(1024);
      setOpen(false);
      onDatabaseCreated();
    } catch (error: any) {
      setError(error.message);
      console.error("Error creating database:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button variant="ghost" size="sm" className="cursor-pointer">
            <PlusIcon size={16} />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Database</DialogTitle>
          <DialogDescription>
            Create a new database connection. Enter a name and select the
            database type.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            {error && (
              <div className="p-3 text-sm bg-red-500/10 border border-red-500/20 text-red-400 rounded-md">
                {error}
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="name">Database Name</Label>
              <Input
                id="name"
                placeholder="my-database"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="project">Project</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  {projects.length === 0 ? (
                    <SelectItem value="none" disabled>
                      No projects available
                    </SelectItem>
                  ) : (
                    projects.map((project) => (
                      <SelectItem key={project.id} value={String(project.id)}>
                        {project.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="type">Database Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select database type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="postgresql">PostgreSQL</SelectItem>
                  <SelectItem value="mysql">MySQL</SelectItem>
                  <SelectItem value="mongodb">MongoDB</SelectItem>
                  <SelectItem value="redis">Redis</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {type === "postgresql" && (
              <div className="grid gap-2">
                <Label htmlFor="version">PostgreSQL Version</Label>
                <Select value={version} onValueChange={setVersion}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select version" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">15</SelectItem>
                    <SelectItem value="16">16</SelectItem>
                    <SelectItem value="17">17</SelectItem>
                    <SelectItem value="18">18 (latest)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Resource Limits Section */}
            <div className="border-t border-border pt-4 mt-2">
              <h3 className="text-sm font-medium text-neutral-200 mb-3">
                Resource Limits
              </h3>

              <div className="grid gap-3">
                <div className="grid gap-1">
                  <Label htmlFor="maxCpu">CPU Cores</Label>
                  <Select
                    value={String(maxCpu)}
                    onValueChange={(value) => setMaxCpu(parseFloat(value))}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0.5">0.5 CPU</SelectItem>
                      <SelectItem value="1">1 CPU</SelectItem>
                      <SelectItem value="2">2 CPUs</SelectItem>
                      <SelectItem value="4">4 CPUs</SelectItem>
                      <SelectItem value="8">8 CPUs</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-1">
                  <Label htmlFor="maxRamMb">RAM</Label>
                  <Select
                    value={String(maxRamMb)}
                    onValueChange={(value) => setMaxRamMb(parseInt(value))}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="256">256 MB</SelectItem>
                      <SelectItem value="512">512 MB</SelectItem>
                      <SelectItem value="1024">1 GB</SelectItem>
                      <SelectItem value="2048">2 GB</SelectItem>
                      <SelectItem value="4096">4 GB</SelectItem>
                      <SelectItem value="8192">8 GB</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-1">
                  <Label htmlFor="maxStorageMb">Storage</Label>
                  <Select
                    value={String(maxStorageMb)}
                    onValueChange={(value) => setMaxStorageMb(parseInt(value))}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="512">512 MB</SelectItem>
                      <SelectItem value="1024">1 GB</SelectItem>
                      <SelectItem value="5120">5 GB</SelectItem>
                      <SelectItem value="10240">10 GB</SelectItem>
                      <SelectItem value="51200">50 GB</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create Database"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
