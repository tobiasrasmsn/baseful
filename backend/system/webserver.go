package system

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"

	"baseful/db"
)

type DomainInfo struct {
	Domain        string `json:"domain"`
	IP            string `json:"ip"`
	Propagated    bool   `json:"propagated"`
	SSLEnabled    bool   `json:"ssl_enabled"`
	DashboardPort int    `json:"dashboard_port"`
	BackendPort   int    `json:"backend_port"`
	ProxyPort     int    `json:"proxy_port"`
}

func GetPublicIP() (string, error) {
	resp, err := http.Get("https://api.ipify.org")
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	ip, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	return string(ip), nil
}

func CheckPropagation(domain string) (bool, error) {
	publicIP, err := GetPublicIP()
	if err != nil {
		return false, err
	}

	ips, err := net.LookupIP(domain)
	if err != nil {
		return false, nil // Not propagated yet or doesn't exist
	}

	for _, ip := range ips {
		if ip.String() == publicIP {
			return true, nil
		}
	}

	return false, nil
}

func ProvisionSSL(domain string) error {
	// We'll use Caddy to provision SSL.
	// We'll generate a Caddyfile and reload Caddy.

	// Get ports
	backendPort := 8080

	// When running in Docker, we can use the service names defined in docker-compose.
	// 'baseful-frontend' is the container name for the frontend.
	// 'localhost' works for the backend since Caddy is in the same container.
	frontendHost := "baseful-frontend"
	backendHost := "localhost"

	caddyfileContent := fmt.Sprintf(`{
    email admin@%s
    admin 0.0.0.0:2019
}

%s {
    # Backend API
    handle /api/* {
        reverse_proxy %s:%d
    }

    # Dashboard / Frontend
    # The frontend container listens on port 80 internally
    reverse_proxy %s:80
}
`, domain, domain, backendHost, backendPort, frontendHost)

	// If the user wants TCP proxying for the database proxy,
	// they would need the Caddy layer4 module which is not standard.
	// We will stick to HTTP for now as requested for the "dashboard".

	caddyfilePath := "./Caddyfile"
	err := os.WriteFile(caddyfilePath, []byte(caddyfileContent), 0644)
	if err != nil {
		return err
	}

	// Check if caddy is installed
	_, err = exec.LookPath("caddy")
	if err != nil {
		return fmt.Errorf("caddy not found in PATH")
	}

	// Reload or start caddy
	// We use --adapter caddyfile to ensure it knows how to read the config
	fmt.Printf("Attempting to reload Caddy with domain: %s\n", domain)

	cmd := exec.Command("caddy", "reload", "--config", caddyfilePath, "--adapter", "caddyfile")
	output, err := cmd.CombinedOutput()
	if err != nil {
		fmt.Printf("Caddy reload failed: %s\nOutput: %s\n", err, string(output))

		// If reload fails, try starting it
		cmd = exec.Command("caddy", "start", "--config", caddyfilePath, "--adapter", "caddyfile")
		output, err = cmd.CombinedOutput()
		if err != nil {
			fmt.Printf("Caddy start failed: %s\nOutput: %s\n", err, string(output))
			return fmt.Errorf("caddy failed: %s (output: %s)", err, string(output))
		}
	}

	return db.UpdateSetting("domain_ssl_enabled", "true")
}

func GetDomainInfo() (*DomainInfo, error) {
	domain, _ := db.GetSetting("domain_name")
	sslEnabled, _ := db.GetSetting("domain_ssl_enabled")

	publicIP, _ := GetPublicIP()

	info := &DomainInfo{
		Domain:        domain,
		IP:            publicIP,
		SSLEnabled:    sslEnabled == "true",
		DashboardPort: 3000,
		BackendPort:   8080,
		ProxyPort:     6432,
	}

	if domain != "" {
		propagated, _ := CheckPropagation(domain)
		info.Propagated = propagated
	}

	return info, nil
}

func SaveDomain(domain string) error {
	return db.UpdateSetting("domain_name", domain)
}
