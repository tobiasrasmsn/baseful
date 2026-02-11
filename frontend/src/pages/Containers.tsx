import { useEffect, useState, useRef } from "react";
import {
    CubeIcon,
    TerminalWindowIcon,
    ArrowClockwiseIcon,
    TerminalIcon
} from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

interface ContainerInfo {
    id: string;
    names: string[];
    image: string;
    status: string;
    state: string;
    ip: string;
    labels: Record<string, string>;
    created: number;
}

export default function Containers() {
    const [containers, setContainers] = useState<ContainerInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedContainer, setSelectedContainer] = useState<ContainerInfo | null>(null);
    const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
    const [command, setCommand] = useState("");
    const [executing, setExecuting] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    const fetchContainers = async () => {
        try {
            setLoading(true);
            const response = await fetch("/api/docker/containers");
            if (!response.ok) throw new Error("Failed to fetch containers");
            const data = await response.json();
            setContainers(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : "An error occurred");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchContainers();
        const interval = setInterval(fetchContainers, 30000); // Polling every 30s
        return () => clearInterval(interval);
    }, []);

    const handleExecute = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!command || !selectedContainer || executing) return;

        const cmd = command.trim();
        setExecuting(true);
        setTerminalOutput(prev => [...prev, `> ${cmd}`]);
        setCommand("");

        try {
            const response = await fetch(`/api/docker/containers/${selectedContainer.id}/exec`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ command: cmd.split(" ") }),
            });

            const data = await response.json();
            if (data.output) {
                setTerminalOutput(prev => [...prev, data.output]);
            } else if (data.error) {
                setTerminalOutput(prev => [...prev, `Error: ${data.error}`]);
            }
        } catch (err) {
            setTerminalOutput(prev => [...prev, `System Error: ${err instanceof Error ? err.message : "Unknown error"}`]);
        } finally {
            setExecuting(false);
        }
    };

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [terminalOutput]);

    const renderTerminalDialogContent = () => (
        <DialogContent className="max-w-3xl h-[600px] flex flex-col p-0 gap-0 bg-[#0c0c0c] border-neutral-800 text-neutral-200 shadow-2xl overflow-hidden focus:outline-none">
            {/* Header - Styled like a window bar */}
            <DialogHeader className="px-4 py-3 border-b border-neutral-800 bg-neutral-900/50">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <div className="p-1 rounded-md bg-neutral-800 border border-neutral-700">
                            <TerminalWindowIcon className="w-3.5 h-3.5 text-neutral-400" />
                        </div>
                        <DialogTitle className="text-sm font-medium font-mono text-neutral-300">
                            root@{selectedContainer?.names[0].replace("/", "")}:~
                        </DialogTitle>
                    </div>
                    <DialogDescription className="text-[10px] uppercase tracking-wider font-semibold text-neutral-500">
                        {selectedContainer?.state}
                    </DialogDescription>
                </div>
            </DialogHeader>

            {/* Console Area - Pure Black Background */}
            <div
                ref={scrollRef}
                className="flex-1 bg-[#0c0c0c] p-4 font-mono text-xs md:text-sm overflow-y-auto scrollbar-thin scrollbar-thumb-neutral-800"
            >
                <div className="flex flex-col gap-1">
                    {terminalOutput.map((line, i) => (
                        <div key={i} className="break-all whitespace-pre-wrap flex gap-2">
                            {/* Optional: Add a subtle timestamp or line number if desired, otherwise just: */}
                            <span className={line.startsWith(">") ? "text-blue-400 font-bold" : "text-neutral-300"}>
                                {line}
                            </span>
                        </div>
                    ))}
                    {executing && (
                        <div className="flex items-center gap-2 text-neutral-500 mt-1">
                            <span className="animate-pulse">_</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Input Area - Integrated securely at bottom */}
            <div className="p-3 bg-neutral-900/30 border-t border-neutral-800">
                <form onSubmit={handleExecute} className="flex gap-2 relative items-center">
                    <span className="text-emerald-500 font-bold font-mono pl-1">➜</span>
                    <input
                        value={command}
                        onChange={(e) => setCommand(e.target.value)}
                        placeholder="Enter command..."
                        className="flex-1 bg-transparent border-none outline-none text-sm font-mono text-neutral-200 placeholder:text-neutral-600 focus:ring-0 w-full h-9"
                        disabled={executing}
                        autoFocus
                        autoComplete="off"
                    />
                    <Button
                        type="submit"
                        disabled={executing || !command}
                        size="sm"
                        className="h-7 bg-neutral-100 text-black hover:bg-neutral-300 font-medium text-xs px-3"
                    >
                        Run
                    </Button>
                </form>
            </div>
        </DialogContent>
    );
    return (
        <div className="flex flex-col gap-6">

            <div className="flex flex-row items-center justify-between">
                <div className="flex flex-row border-b border-border p-4 items-center gap-4 w-full">
                    <div className="flex flex-row items-center gap-3 flex-1">
                        <h1 className="text-2xl font-medium text-neutral-100">
                            Containers
                        </h1>
                    </div>
                    <Button variant="outline" size="sm" onClick={fetchContainers} className="gap-2">
                        <ArrowClockwiseIcon className={loading ? "animate-spin" : ""} />
                        Refresh
                    </Button>
                </div>

            </div>

            <div className="p-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {loading && containers.length === 0 ? (
                    Array.from({ length: 6 }).map((_, i) => (
                        <Card key={i} className="border-border/50 bg-card/50">
                            <CardHeader className="pb-2">
                                <Skeleton className="h-5 w-3/4 mb-2" />
                                <Skeleton className="h-4 w-1/2" />
                            </CardHeader>
                            <CardContent>
                                <Skeleton className="h-10 w-full" />
                            </CardContent>
                            Card            </Card>
                    ))
                ) : error ? (
                    <div className="col-span-full p-12 flex flex-col items-center justify-center text-center border border-dashed rounded-lg border-red-500/20 bg-red-500/5">
                        <p className="text-red-500 font-medium mb-2">Error connecting to Docker</p>
                        <p className="text-sm text-neutral-400 max-w-md">{error}</p>
                    </div>
                ) : containers.length === 0 ? (
                    <div className="col-span-full p-12 flex flex-col items-center justify-center text-center border border-dashed rounded-lg border-neutral-800">
                        <CubeIcon size={48} className="text-neutral-700 mb-4" />
                        <p className="text-neutral-300 font-medium mb-1">No Containers Found</p>
                        <p className="text-sm text-neutral-500 max-w-md">No containers managed by Baseful were detected on this server.</p>
                    </div>
                ) : (
                    containers.map((container) => (
                        <Card key={container.id} className="group flex flex-col justify-between bg-card hover:bg-zinc-50 dark:hover:bg-zinc-900/50 border-border transition-colors duration-200">
                            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                                <div className="flex flex-col gap-1">
                                    <div className="flex items-center gap-2">
                                        <Badge variant="secondary" className={`bg-transparent border px-1.5 h-5 text-[10px] uppercase font-mono tracking-wider ${container.state === 'running'
                                            ? 'text-emerald-600 border-emerald-200 dark:border-emerald-900/30'
                                            : 'text-zinc-500 border-zinc-200 dark:border-zinc-800'
                                            }`}>
                                            {container.state}
                                        </Badge>
                                    </div>
                                    <CardTitle className="text-base font-semibold tracking-tight text-foreground">
                                        {container.names[0].replace("/", "")}
                                    </CardTitle>
                                    <p className="text-xs text-muted-foreground font-mono">
                                        {container.image}
                                    </p>
                                </div>

                                {/* Quick Actions - Floating Top Right */}
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Dialog onOpenChange={(open) => open && setSelectedContainer(container)}>
                                        <DialogTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                                                <TerminalIcon size={14} />
                                            </Button>
                                        </DialogTrigger>
                                        {renderTerminalDialogContent()}
                                    </Dialog>
                                </div>
                            </CardHeader>

                            <CardContent className="pt-4">
                                <div className="flex items-center gap-4 text-xs text-muted-foreground font-mono">
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-1.5 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                                        {container.ip || "No IP"}
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-1.5 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                                        {container.status}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>
        </div>
    );
}
