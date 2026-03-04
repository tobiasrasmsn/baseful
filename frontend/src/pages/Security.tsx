import { useState, useEffect } from "react";
import {
  ShieldCheck,
  ArrowClockwise,
  CircleNotch,
  CheckCircle,
  DownloadSimple,
  Clock,
  Warning,
  Tag,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/lib/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface UpdateStatus {
  available: boolean;
  currentHash: string;
  remoteHash: string;
  lastChecked: string;
  checkingStatus: boolean;
  updatingStatus: boolean;
}

export default function Security() {
  const { token, logout } = useAuth();
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchUpdateStatus = async (forceCheck = false) => {
    if (forceCheck) setActionLoading(true);
    try {
      const endpoint = forceCheck
        ? "/api/system/update-check"
        : "/api/system/update-status";
      const res = await authFetch(
        endpoint,
        token,
        { method: forceCheck ? "POST" : "GET" },
        logout,
      );
      if (res.ok) {
        const data = await res.json();
        setUpdateStatus(data);
      }
    } catch (err) {
      console.error("Failed to fetch update status", err);
    } finally {
      if (forceCheck) setActionLoading(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUpdateStatus();
  }, []);

  const handleUpdate = async () => {
    if (
      !confirm(
        "Are you sure you want to update? The system will restart and the dashboard will be unavailable for a few seconds.",
      )
    )
      return;

    setActionLoading(true);
    try {
      const res = await authFetch(
        "/api/system/update",
        token,
        { method: "POST" },
        logout,
      );
      if (!res.ok) throw new Error("Update failed");
      // The Sidebar and this page will detect the updating state via polling (implicitly handled by the system)
    } catch (e) {
      alert("Failed to start update. Check backend logs.");
    } finally {
      setActionLoading(false);
    }
  };

  const formatHash = (hash: string) => {
    if (!hash) return "Unknown";
    return hash.substring(0, 7);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-[#0a0a0a] gap-3">
        <CircleNotch
          size={24}
          className="text-neutral-500 animate-spin"
          weight="bold"
        />
        <div className="text-neutral-400 text-sm font-medium">
          Loading security settings...
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <header className="flex-shrink-0 border-b px-8 py-5 flex items-center gap-3">
        <h1 className="text-xl font-medium text-neutral-100 tracking-tight">
          Security & Updates
        </h1>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto pb-32">
        <div className="max-w-4xl mx-auto w-full px-6 sm:px-8 py-10 space-y-12">
          <Tabs defaultValue="baseful">
            <TabsList>
              <TabsTrigger value="baseful">Baseful</TabsTrigger>
              <TabsTrigger value="system">System</TabsTrigger>
            </TabsList>
            <TabsContent value="baseful">
              <section className="space-y-6">
                <div className="px-1">
                  <h2 className="text-base font-medium text-neutral-100 mb-1.5 flex items-center gap-2">
                    <ArrowClockwise size={20} className="text-neutral-400" />
                    System Updates
                  </h2>
                  <p className="text-sm text-neutral-500 leading-relaxed max-w-2xl">
                    Keep your Baseful instance up to date with the latest
                    features, security patches, and performance improvements.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Status Card */}
                  <div className="p-5 rounded-xl border border-white/[0.08] bg-card space-y-4">
                    <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 uppercase tracking-wider">
                      <ShieldCheck size={16} className="text-blue-400" />
                      Current Status
                    </div>
                    <div className="flex items-center gap-2">
                      {updateStatus?.available ? (
                        <div className="flex items-center gap-1.5 text-amber-400 font-medium">
                          <Warning size={18} weight="bold" />
                          Update Available
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
                          <CheckCircle size={18} weight="bold" />
                          Up to Date
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Version Card */}
                  <div className="p-5 rounded-xl border border-white/[0.08] bg-card space-y-4">
                    <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 uppercase tracking-wider">
                      <Tag size={16} className="text-purple-400" />
                      Current Version (Hash)
                    </div>
                    <div className="text-lg font-mono text-neutral-200">
                      {formatHash(updateStatus?.currentHash || "")}
                    </div>
                  </div>

                  {/* Last Checked Card */}
                  <div className="p-5 rounded-xl border border-white/[0.08] bg-card space-y-4">
                    <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 uppercase tracking-wider">
                      <Clock size={16} className="text-neutral-400" />
                      Last Checked
                    </div>
                    <div className="text-sm text-neutral-300">
                      {updateStatus?.lastChecked
                        ? new Date(updateStatus.lastChecked).toLocaleString()
                        : "Never"}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-4 pt-2">
                  <Button
                    variant="outline"
                    className="bg-[#121214] border-white/[0.08] hover:bg-white/[0.04] text-neutral-300 h-11 px-6 font-medium gap-2 transition-all flex-1"
                    onClick={() => fetchUpdateStatus(true)}
                    disabled={actionLoading || updateStatus?.checkingStatus}
                  >
                    {actionLoading || updateStatus?.checkingStatus ? (
                      <CircleNotch size={18} className="animate-spin" />
                    ) : (
                      <ArrowClockwise size={18} weight="bold" />
                    )}
                    Check for Updates
                  </Button>

                  {updateStatus?.available && (
                    <Button
                      className="bg-blue-600 hover:bg-blue-500 text-white h-11 px-8 shadow-lg shadow-blue-500/20 transition-all font-medium gap-2 flex-1"
                      onClick={handleUpdate}
                      disabled={actionLoading || updateStatus?.updatingStatus}
                    >
                      {updateStatus?.updatingStatus ? (
                        <CircleNotch size={18} className="animate-spin" />
                      ) : (
                        <DownloadSimple size={18} weight="bold" />
                      )}
                      Install Update
                    </Button>
                  )}
                </div>
              </section>

              {/* Additional Security Section (Placeholder for future) */}
              <section className="pt-8 border-t border-white/[0.04] space-y-6">
                <div className="px-1">
                  <h2 className="text-base font-medium text-neutral-100 mb-1.5 flex items-center gap-2">
                    <ShieldCheck size={20} className="text-neutral-400" />
                    Security Policies
                  </h2>
                  <p className="text-sm text-neutral-500 leading-relaxed max-w-2xl">
                    Configure your instance's security settings, including
                    access controls and session management.
                  </p>
                </div>

                <div className="p-8 rounded-xl border border-dashed border-white/[0.08] bg-white/[0.01] flex flex-col items-center justify-center text-center gap-3">
                  <div className="p-3 rounded-full bg-neutral-900 border border-white/[0.04] text-neutral-500">
                    <ShieldCheck size={24} weight="duotone" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-sm font-medium text-neutral-300">
                      More Security Features Coming Soon
                    </h3>
                    <p className="text-xs text-neutral-500">
                      Future updates will include MFA, advanced audit logs, and
                      more.
                    </p>
                  </div>
                </div>
              </section>
            </TabsContent>
            <TabsContent value="system">
              <ul className="space-y-4">
                <li className="border border-border rounded-lg flex flex-row justify-normal items-center gap-4">
                  <div className="border-r border-border h-full p-4">
                    <input
                      type="checkbox"
                      className="checked:bg-[url('data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2016%2016%22%20fill%3D%22black%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M12.207%204.793a1%201%200%20010%201.414l-5%205a1%201%200%2001-1.414%200l-2-2a1%201%200%20011.414-1.414L6.5%209.086l4.293-4.293a1%201%200%20011.414%200z%22%2F%3E%3C%2Fsvg%3E')] border border-border size-8 appearance-none rounded  bg-card cursor-pointer checked:bg-neutral-200"
                    />
                  </div>
                  <div className="flex flex-col py-4 pr-4">
                    <h3 className="text-lg font-medium">SSH keys only</h3>
                    <p className="text-sm text-neutral-300">
                      Use SSH keys for authentication only, disabling
                      password-based login.
                    </p>
                  </div>
                </li>
                <li className="border border-border rounded-lg flex flex-row justify-normal items-center gap-4">
                  <div className="border-r border-border h-full p-4">
                    <input
                      type="checkbox"
                      className="checked:bg-[url('data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2016%2016%22%20fill%3D%22black%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M12.207%204.793a1%201%200%20010%201.414l-5%205a1%201%200%2001-1.414%200l-2-2a1%201%200%20011.414-1.414L6.5%209.086l4.293-4.293a1%201%200%20011.414%200z%22%2F%3E%3C%2Fsvg%3E')] border border-border size-8 appearance-none rounded  bg-card cursor-pointer checked:bg-neutral-200"
                    />
                  </div>
                  <div className="flex flex-col py-4 pr-4">
                    <h3 className="text-lg font-medium">
                      Firewall default-deny
                    </h3>
                    <p className="text-sm text-neutral-300">
                      Enable a strict firewall policy that denies all incoming
                      traffic by default.
                    </p>
                  </div>
                </li>
                <li className="border border-border rounded-lg flex flex-row justify-normal items-center gap-4">
                  <div className="border-r border-border h-full p-4">
                    <input
                      type="checkbox"
                      className="checked:bg-[url('data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2016%2016%22%20fill%3D%22black%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M12.207%204.793a1%201%200%20010%201.414l-5%205a1%201%200%2001-1.414%200l-2-2a1%201%200%20011.414-1.414L6.5%209.086l4.293-4.293a1%201%200%20011.414%200z%22%2F%3E%3C%2Fsvg%3E')] border border-border size-8 appearance-none rounded  bg-card cursor-pointer checked:bg-neutral-200"
                    />
                  </div>
                  <div className="flex flex-col py-4 pr-4">
                    <h3 className="text-lg font-medium">Tailscale</h3>
                    <p className="text-sm text-neutral-300">
                      Enable Tailscale for secure, private networking between
                      your devices.
                    </p>
                  </div>
                </li>
                <li className="border border-border rounded-lg flex flex-row justify-normal items-center gap-4">
                  <div className="border-r border-border h-full p-4">
                    <input
                      type="checkbox"
                      className="checked:bg-[url('data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2016%2016%22%20fill%3D%22black%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M12.207%204.793a1%201%200%20010%201.414l-5%205a1%201%200%2001-1.414%200l-2-2a1%201%200%20011.414-1.414L6.5%209.086l4.293-4.293a1%201%200%20011.414%200z%22%2F%3E%3C%2Fsvg%3E')] border border-border size-8 appearance-none rounded  bg-card cursor-pointer checked:bg-neutral-200"
                    />
                  </div>
                  <div className="flex flex-col py-4 pr-4">
                    <h3 className="text-lg font-medium">Fail2ban</h3>
                    <p className="text-sm text-neutral-300">
                      Automatically block IP addresses that show malicious
                      signs, such as too many password failures.
                    </p>
                  </div>
                </li>
                <li className="border border-border rounded-lg flex flex-row justify-normal items-center gap-4">
                  <div className="border-r border-border h-full p-4">
                    <input
                      type="checkbox"
                      className="checked:bg-[url('data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2016%2016%22%20fill%3D%22black%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M12.207%204.793a1%201%200%20010%201.414l-5%205a1%201%200%2001-1.414%200l-2-2a1%201%200%20011.414-1.414L6.5%209.086l4.293-4.293a1%201%200%20011.414%200z%22%2F%3E%3C%2Fsvg%3E')] border border-border size-8 appearance-none rounded  bg-card cursor-pointer checked:bg-neutral-200"
                    />
                  </div>
                  <div className="flex flex-col py-4 pr-4">
                    <h3 className="text-lg font-medium">
                      Change default SSH port
                    </h3>
                    <p className="text-sm text-neutral-300">
                      Move the SSH service to a non-standard port to reduce
                      automated brute-force attempts.
                    </p>
                  </div>
                </li>
                <li className="border border-border rounded-lg flex flex-row justify-normal items-center gap-4">
                  <div className="border-r border-border h-full p-4">
                    <input
                      type="checkbox"
                      className="checked:bg-[url('data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2016%2016%22%20fill%3D%22black%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M12.207%204.793a1%201%200%20010%201.414l-5%205a1%201%200%2001-1.414%200l-2-2a1%201%200%20011.414-1.414L6.5%209.086l4.293-4.293a1%201%200%20011.414%200z%22%2F%3E%3C%2Fsvg%3E')] border border-border size-8 appearance-none rounded  bg-card cursor-pointer checked:bg-neutral-200"
                    />
                  </div>
                  <div className="flex flex-col py-4 pr-4">
                    <h3 className="text-lg font-medium">Disable root login</h3>
                    <p className="text-sm text-neutral-300">
                      Prevent direct root access via SSH to improve system
                      security.
                    </p>
                  </div>
                </li>
                <li className="border border-border rounded-lg flex flex-row justify-normal items-center gap-4">
                  <div className="border-r border-border h-full p-4">
                    <input
                      type="checkbox"
                      className="checked:bg-[url('data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2016%2016%22%20fill%3D%22black%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M12.207%204.793a1%201%200%20010%201.414l-5%205a1%201%200%2001-1.414%200l-2-2a1%201%200%20011.414-1.414L6.5%209.086l4.293-4.293a1%201%200%20011.414%200z%22%2F%3E%3C%2Fsvg%3E')] border border-border size-8 appearance-none rounded  bg-card cursor-pointer checked:bg-neutral-200"
                    />
                  </div>
                  <div className="flex flex-col py-4 pr-4">
                    <h3 className="text-lg font-medium">Unattended upgrades</h3>
                    <p className="text-sm text-neutral-300">
                      Automatically install security updates to keep your system
                      protected without manual intervention.
                    </p>
                  </div>
                </li>
              </ul>
            </TabsContent>
          </Tabs>
          {/* Updates Section */}
        </div>
      </div>
    </div>
  );
}
