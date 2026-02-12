import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Globe,
  Shield,
  CheckCircle,
  WarningCircleIcon,
  CopyIcon,
  ArrowSquareOutIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { SquareArrowOutUpRight } from "lucide-react";

interface DomainStatus {
  configured: boolean;
  domain?: string;
}

export default function DomainSetup() {
  const [domainStatus, setDomainStatus] = useState<DomainStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const fetchDomainStatus = async () => {
      try {
        const res = await fetch("/api/system/domain");
        if (res.ok) {
          const data = await res.json();
          setDomainStatus(data);
        }
      } catch (err) {
        console.error("Failed to fetch domain status:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchDomainStatus();
  }, []);

  const copyIP = () => {
    navigator.clipboard.writeText(domainStatus?.domain || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const currentIP =
    typeof window !== "undefined" ? window.location.hostname : "";

  return (
    <div className="flex flex-col gap-6 h-full max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/">
          <Button variant="ghost" size="sm" className="cursor-pointer">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-medium text-neutral-100">
            Domain Setup
          </h1>
          <p className="text-sm text-neutral-400">
            Configure your domain to enable SSL/TLS encryption
          </p>
        </div>
      </div>

      {/* Current Status */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-lg font-medium text-neutral-200 mb-4">
          Current Status
        </h2>

        {loading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-6 bg-neutral-800 rounded w-1/3"></div>
            <div className="h-4 bg-neutral-800 rounded w-1/2"></div>
          </div>
        ) : domainStatus?.configured ? (
          <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
            <CheckCircle className="w-6 h-6 text-green-500" />
            <div>
              <p className="text-sm font-medium text-green-400">
                Domain is configured
              </p>
              <p className="text-xs text-neutral-400">
                Your domain{" "}
                <span className="text-green-300">{domainStatus.domain}</span> is
                connected and SSL is available.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
            <WarningCircleIcon className="w-6 h-6 text-amber-500" />
            <div>
              <p className="text-sm font-medium text-amber-400">
                No domain configured
              </p>
              <p className="text-xs text-neutral-400">
                You're currently using an IP address. Connect a domain to enable
                SSL/TLS.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Setup Instructions */}
      {!domainStatus?.configured && (
        <>
          {/* Step 1: Get Server IP */}
          <div className="bg-card border border-border rounded-lg p-6">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-500/20 text-blue-400 rounded-full flex items-center justify-center font-medium">
                1
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-medium text-neutral-200 mb-2">
                  Get your server IP address
                </h3>
                <p className="text-sm text-neutral-400 mb-4">
                  You'll need your server's IP address to configure DNS records.
                </p>

                <div className="flex items-center gap-2 p-3 bg-neutral-900 rounded-lg border border-border">
                  <code className="flex-1 text-sm font-mono text-neutral-300">
                    {currentIP || "Detecting..."}
                  </code>
                  {currentIP && (
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(currentIP);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      className="p-2 hover:bg-neutral-800 rounded-md transition-colors text-neutral-400 hover:text-neutral-200"
                      title="Copy IP"
                    >
                      {copied ? (
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      ) : (
                        <CopyIcon className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Step 2: Configure DNS */}
          <div className="bg-card border border-border rounded-lg p-6">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-500/20 text-blue-400 rounded-full flex items-center justify-center font-medium">
                2
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-medium text-neutral-200 mb-2">
                  Configure DNS records
                </h3>
                <p className="text-sm text-neutral-400 mb-4">
                  Add an A record pointing your domain to your server IP.
                </p>

                <div className="space-y-3">
                  <div className="p-3 bg-neutral-900 rounded-lg border border-border">
                    <div className="text-xs text-neutral-500 mb-1">Type</div>
                    <div className="text-sm font-mono text-neutral-300">
                      A Record
                    </div>
                  </div>
                  <div className="p-3 bg-neutral-900 rounded-lg border border-border">
                    <div className="text-xs text-neutral-500 mb-1">
                      Name / Host
                    </div>
                    <div className="text-sm font-mono text-neutral-300">
                      @ (or leave blank)
                    </div>
                  </div>
                  <div className="p-3 bg-neutral-900 rounded-lg border border-border">
                    <div className="text-xs text-neutral-500 mb-1">
                      Value / Target
                    </div>
                    <div className="text-sm font-mono text-neutral-300">
                      {currentIP || "Your server IP"}
                    </div>
                  </div>
                  <div className="p-3 bg-neutral-900 rounded-lg border border-border">
                    <div className="text-xs text-neutral-500 mb-1">TTL</div>
                    <div className="text-sm font-mono text-neutral-300">
                      3600 (1 hour) or Auto
                    </div>
                  </div>
                </div>

                <p className="text-xs text-neutral-500 mt-4">
                  <strong>Note:</strong> DNS changes may take up to 24 hours to
                  propagate, though it usually takes just a few minutes.
                </p>
              </div>
            </div>
          </div>

          {/* Step 3: Update PUBLIC_IP */}
          <div className="bg-card border border-border rounded-lg p-6">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-500/20 text-blue-400 rounded-full flex items-center justify-center font-medium">
                3
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-medium text-neutral-200 mb-2">
                  Update your server configuration
                </h3>
                <p className="text-sm text-neutral-400 mb-4">
                  Once DNS is configured and your domain resolves to your server
                  IP, update the PUBLIC_IP environment variable.
                </p>

                <div className="p-4 bg-neutral-900 rounded-lg border border-border">
                  <p className="text-xs text-neutral-500 mb-2">
                    Edit backend/.env file:
                  </p>
                  <div className="font-mono text-sm text-neutral-300">
                    PUBLIC_IP=your-domain.com
                  </div>
                </div>

                <div className="mt-4 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                  <h4 className="text-sm font-medium text-blue-400 mb-2">
                    For Docker deployments:
                  </h4>
                  <ol className="text-xs text-neutral-400 space-y-1 list-decimal list-inside">
                    <li>
                      Edit the <code className="text-neutral-300">.env</code>{" "}
                      file in the backend directory
                    </li>
                    <li>
                      Change{" "}
                      <code className="text-neutral-300">
                        PUBLIC_IP=localhost
                      </code>{" "}
                      to{" "}
                      <code className="text-neutral-300">
                        PUBLIC_IP=your-domain.com
                      </code>
                    </li>
                    <li>
                      Restart the containers:{" "}
                      <code className="text-neutral-300">
                        docker compose restart
                      </code>
                    </li>
                  </ol>
                </div>
              </div>
            </div>
          </div>

          {/* Step 4: Enable SSL */}
          <div className="bg-card border border-border rounded-lg p-6">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-500/20 text-blue-400 rounded-full flex items-center justify-center font-medium">
                4
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-medium text-neutral-200 mb-2">
                  Enable SSL/TLS
                </h3>
                <p className="text-sm text-neutral-400 mb-4">
                  Once your domain is configured, generate SSL certificates and
                  enable SSL in the proxy.
                </p>

                <div className="space-y-4">
                  <div className="p-4 bg-neutral-900 rounded-lg border border-border">
                    <h4 className="text-sm font-medium text-neutral-300 mb-2">
                      Option A: Self-signed certificates (development)
                    </h4>
                    <div className="font-mono text-xs text-neutral-400 space-y-1">
                      <div># Generate certificates</div>
                      <div>cd backend</div>
                      <div>
                        openssl req -x509 -newkey rsa:2048 -keyout server.key
                        -out server.crt -days 365 -nodes -subj
                        "/CN=your-domain.com"
                      </div>
                    </div>
                  </div>

                  <div className="p-4 bg-neutral-900 rounded-lg border border-border">
                    <h4 className="text-sm font-medium text-neutral-300 mb-2">
                      Option B: Let's Encrypt (production - recommended)
                    </h4>
                    <div className="font-mono text-xs text-neutral-400 space-y-1">
                      <div># Install certbot</div>
                      <div>sudo apt install certbot</div>
                      <div></div>
                      <div># Generate certificate</div>
                      <div>
                        sudo certbot certonly --standalone -d your-domain.com
                      </div>
                      <div></div>
                      <div># Copy to backend directory</div>
                      <div>
                        sudo cp
                        /etc/letsencrypt/live/your-domain.com/fullchain.pem
                        backend/server.crt
                      </div>
                      <div>
                        sudo cp
                        /etc/letsencrypt/live/your-domain.com/privkey.pem
                        backend/server.key
                      </div>
                    </div>
                  </div>

                  <div className="p-4 bg-neutral-900 rounded-lg border border-border">
                    <h4 className="text-sm font-medium text-neutral-300 mb-2">
                      Update .env for SSL
                    </h4>
                    <div className="font-mono text-xs text-neutral-400 space-y-1">
                      <div>PROXY_SSL_ENABLED=true</div>
                      <div>PROXY_TLS_CERT_FILE=/path/to/server.crt</div>
                      <div>PROXY_TLS_KEY_FILE=/path/to/server.key</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Already Configured - Show SSL Status */}
      {domainStatus?.configured && (
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex items-center gap-3 mb-6">
            <Shield className="w-6 h-6 text-green-500" />
            <h2 className="text-lg font-medium text-neutral-200">
              SSL/TLS Configuration
            </h2>
          </div>

          <div className="space-y-4">
            <div className="p-4 bg-neutral-900 rounded-lg border border-border">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-neutral-300">
                    Your Domain
                  </p>
                  <p className="text-xs text-neutral-500">
                    {domainStatus.domain}
                  </p>
                </div>
                <CheckCircle className="w-5 h-5 text-green-500" />
              </div>
            </div>

            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <h3 className="text-sm font-medium text-amber-400 mb-2">
                Enable SSL for the Proxy
              </h3>
              <p className="text-xs text-neutral-400 mb-3">
                Your domain is configured, but SSL is not yet enabled for the
                database proxy. Generate SSL certificates and update your .env
                file to enable encrypted connections.
              </p>
              <div className="font-mono text-xs text-neutral-400 bg-neutral-900 p-3 rounded">
                <div># Generate self-signed certificate for testing</div>
                <div>cd backend</div>
                <div>
                  openssl req -x509 -newkey rsa:2048 -keyout server.key -out
                  server.crt -days 365 -nodes -subj "/CN={domainStatus.domain}"
                </div>
                <div></div>
                <div># Update .env</div>
                <div>PROXY_SSL_ENABLED=true</div>
                <div>PROXY_TLS_CERT_FILE=/app/server.crt</div>
                <div>PROXY_TLS_KEY_FILE=/app/server.key</div>
                <div></div>
                <div># Restart proxy</div>
                <div>docker compose -f docker-compose.proxy.yml restart</div>
              </div>
            </div>

            <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <h3 className="text-sm font-medium text-blue-400 mb-2">
                For production use
              </h3>
              <p className="text-xs text-neutral-400 mb-2">
                Consider using Let's Encrypt for free, trusted SSL certificates:
              </p>
              <div className="font-mono text-xs text-neutral-400 bg-neutral-900 p-3 rounded">
                <div>
                  sudo certbot certonly --standalone -d {domainStatus.domain}
                </div>
                <div>
                  sudo cp /etc/letsencrypt/live/{domainStatus.domain}
                  /fullchain.pem backend/
                </div>
                <div>
                  sudo cp /etc/letsencrypt/live/{domainStatus.domain}
                  /privkey.pem backend/
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Help Section */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-lg font-medium text-neutral-200 mb-4">
          Need Help?
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <a
            href="https://github.com/tobiasrasmsn/baseful"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-4 bg-neutral-900 rounded-lg border border-border hover:border-neutral-700 transition-colors"
          >
            <SquareArrowOutUpRight className="w-5 h-5 text-blue-400" />
            <div>
              <p className="text-sm font-medium text-neutral-300">
                GitHub Repository
              </p>
              <p className="text-xs text-neutral-500">
                Documentation and issues
              </p>
            </div>
          </a>
          <a
            href="https://github.com/tobiasrasmsn/baseful/discussions"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-4 bg-neutral-900 rounded-lg border border-border hover:border-neutral-700 transition-colors"
          >
            <Globe className="w-5 h-5 text-blue-400" />
            <div>
              <p className="text-sm font-medium text-neutral-300">
                Community Discussions
              </p>
              <p className="text-xs text-neutral-500">
                Get help from the community
              </p>
            </div>
          </a>
        </div>
      </div>
    </div>
  );
}
