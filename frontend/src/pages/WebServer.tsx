import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import {
  Globe,
  CheckCircle,
  XCircle,
  ArrowClockwise,
  ShieldCheck,
  CopyIcon,
  CheckIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";

interface WebServerStatus {
  domain: string;
  ip: string;
  propagated: boolean;
  ssl_enabled: boolean;
  dashboard_port: number;
  backend_port: number;
  proxy_port: number;
}

export default function WebServer() {
  const { id } = useParams();
  const [status, setStatus] = useState<WebServerStatus | null>(null);
  const [domainInput, setDomainInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/system/webserver/status");
      const data = await res.json();
      setStatus(data);
      if (data.domain) {
        setDomainInput(data.domain);
      }
    } catch (err) {
      console.error("Failed to fetch web server status", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleSaveDomain = async () => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/system/webserver/domain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: domainInput }),
      });
      if (res.ok) {
        await fetchStatus();
      }
    } catch (err) {
      console.error("Failed to save domain", err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCheckDNS = async () => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/system/webserver/check-dns");
      const data = await res.json();
      if (status) {
        setStatus({ ...status, propagated: data.propagated });
      }
    } catch (err) {
      console.error("Failed to check DNS", err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleProvisionSSL = async () => {
    setActionLoading(true);
    try {
      const res = await fetch("/api/system/webserver/provision-ssl", {
        method: "POST",
      });
      if (res.ok) {
        await fetchStatus();
      }
    } catch (err) {
      console.error("Failed to provision SSL", err);
    } finally {
      setActionLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <ArrowClockwise className="animate-spin text-neutral-500" size={32} />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2 bg-blue-500/10 rounded-lg">
          <Globe size={24} className="text-blue-500" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Web Server</h1>
          <p className="text-neutral-400 text-sm">
            Connect your domain and secure your dashboard with SSL.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="bg-card/50 border-border">
          <CardHeader>
            <CardTitle className="text-lg">Domain Configuration</CardTitle>
            <CardDescription>
              Enter the domain you want to use for this dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="domain">Domain Name</Label>
              <div className="flex gap-2">
                <Input
                  id="domain"
                  placeholder="example.com"
                  value={domainInput}
                  onChange={(e) => setDomainInput(e.target.value)}
                  className="bg-background"
                />
                <Button
                  onClick={handleSaveDomain}
                  disabled={
                    actionLoading ||
                    !domainInput ||
                    domainInput === status?.domain
                  }
                >
                  Save
                </Button>
              </div>
            </div>

            {status?.domain && (
              <div className="pt-4 space-y-4 border-t border-border">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">DNS Propagation</span>
                  {status.propagated ? (
                    <Badge className="bg-green-500/10 text-green-500 border-green-500/20 gap-1">
                      <CheckCircle size={14} />
                      Propagated
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-neutral-400 gap-1">
                      <XCircle size={14} />
                      Not Detected
                    </Badge>
                  )}
                </div>
                <Button
                  variant="outline"
                  className="w-full gap-2"
                  onClick={handleCheckDNS}
                  disabled={actionLoading}
                >
                  <ArrowClockwise
                    className={actionLoading ? "animate-spin" : ""}
                    size={16}
                  />
                  Check DNS Again
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border">
          <CardHeader>
            <CardTitle className="text-lg">DNS Settings</CardTitle>
            <CardDescription>
              Add this A-record to your DNS provider to point your domain here.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-background rounded-md border border-border space-y-3">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold">
                  Type
                </span>
                <span className="text-sm font-mono">A</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold">
                  Name
                </span>
                <span className="text-sm font-mono">@ (or your subdomain)</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-bold">
                  Value
                </span>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-mono text-blue-400">
                    {status?.ip || "Loading..."}
                  </span>
                  <button
                    onClick={() => copyToClipboard(status?.ip || "")}
                    className="text-neutral-500 hover:text-neutral-300 transition-colors"
                  >
                    {copied ? (
                      <CheckIcon size={16} className="text-green-500" />
                    ) : (
                      <CopyIcon size={16} />
                    )}
                  </button>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-neutral-500 italic">
              Note: DNS changes can take up to 24-48 hours to propagate
              globally.
            </p>
          </CardContent>
        </Card>
      </div>

      {status?.domain && status.propagated && (
        <Card className="bg-card/50 border-border border-blue-500/20">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldCheck size={20} className="text-blue-500" />
              <CardTitle className="text-lg">SSL Certificate</CardTitle>
            </div>
            <CardDescription>
              Secure your dashboard with a free Let's Encrypt SSL certificate
              via Caddy.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {status.ssl_enabled ? (
              <div className="flex items-center gap-2 text-green-500 bg-green-500/5 p-4 rounded-md border border-green-500/20">
                <CheckCircle size={20} />
                <span className="text-sm font-medium">
                  SSL is active and protecting your domain.
                </span>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="text-sm text-neutral-400">
                  Your domain is pointing to this server. You can now provision
                  an SSL certificate. This will configure Caddy to handle HTTPS
                  automatically.
                </div>
                <Button
                  className="w-full bg-blue-600 hover:bg-blue-500"
                  onClick={handleProvisionSSL}
                  disabled={actionLoading}
                >
                  {actionLoading
                    ? "Provisioning..."
                    : "Provision SSL Certificate"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="bg-card/50 border-border">
        <CardHeader>
          <CardTitle className="text-lg">Internal Routing</CardTitle>
          <CardDescription>
            Caddy will route traffic to these internal ports.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div className="p-3 bg-background rounded-md border border-border text-center">
              <div className="text-[10px] uppercase text-neutral-500 mb-1">
                Dashboard
              </div>
              <div className="text-sm font-mono">{status?.dashboard_port}</div>
            </div>
            <div className="p-3 bg-background rounded-md border border-border text-center">
              <div className="text-[10px] uppercase text-neutral-500 mb-1">
                Backend
              </div>
              <div className="text-sm font-mono">{status?.backend_port}</div>
            </div>
            <div className="p-3 bg-background rounded-md border border-border text-center">
              <div className="text-[10px] uppercase text-neutral-500 mb-1">
                Proxy
              </div>
              <div className="text-sm font-mono">{status?.proxy_port}</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
