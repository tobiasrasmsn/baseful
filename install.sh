#!/bin/bash

# Baseful Installation Script
# This script automates the setup of Baseful on a VPS.
# Usage: curl -sSL https://raw.githubusercontent.com/tobiasrasmsn/baseful/main/install.sh | bash

set -e

# --- Configuration ---
INSTALL_DIR="/opt/baseful"
GITHUB_REPO="https://github.com/tobiasrasmsn/baseful.git"

# Create install directory with correct permissions
sudo mkdir -p "$INSTALL_DIR"
sudo chown $(whoami):$(whoami) "$INSTALL_DIR"

# --- Colors for output ---
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

info()    { printf "%b%s%b\n" "$BLUE" "$1" "$NC"; }
success() { printf "%b%b%s%b\n" "$GREEN" "$BOLD" "$1" "$NC"; }
warn()    { printf "%b%s%b\n" "$YELLOW" "$1" "$NC"; }
error()   { printf "%b%b%s%b\n" "$RED" "$BOLD" "$1" "$NC"; }

# Clear screen and show banner
printf "\033[H\033[2J"
printf "%b%b" "$BLUE" "$BOLD"
cat << "EOF"
  ____                 _____       _
 |  _ \               |  ___|     | |
 | |_) | __ _ ___  ___| |_ _   _| |
 |  _ < / _` / __|/ _ \  _| | | | |
 | |_) | (_| \__ \  __/ | | |_| | |
 |____/ \__,_|___/\___|_|  \__,_|_|

   The Open Source Postgres Platform
EOF
printf "%b" "$NC"
cat << "EOF"
------------------------------------------------
EOF

# ============================================================
# [1/8] System Requirements Check
# ============================================================
info "[1/8] Checking system requirements..."

if ! command -v docker >/dev/null 2>&1; then
    warn "Docker not found. Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    if command -v systemctl >/dev/null 2>&1; then
        sudo systemctl enable --now docker
    fi
    # Add current user to docker group
    sudo usermod -aG docker "$(whoami)"
    # Apply group change for current session
    if ! groups | grep -q docker; then
        exec sg docker "$0 $*"
    fi
fi

if docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE_CMD="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
    DOCKER_COMPOSE_CMD="docker-compose"
else
    error "Error: Docker Compose is required but not found."
    info "Please install it: https://docs.docker.com/compose/install/"
    exit 1
fi

if ! command -v git >/dev/null 2>&1; then
    warn "Git not found. Installing git..."
    if command -v apt-get >/dev/null 2>&1; then
        sudo apt-get update && sudo apt-get install -y git
    elif command -v yum >/dev/null 2>&1; then
        sudo yum install -y git
    fi
fi

success "✓ Dependencies are ready."

# ============================================================
# [2/8] Clone Repository
# ============================================================
if [ -f "docker-compose.yml" ] && grep -q "baseful" "docker-compose.yml"; then
    info "Detected existing Baseful directory. Skipping clone..."
    INSTALL_DIR=$(pwd)
    cd "$INSTALL_DIR"
else
    info "[2/8] Cloning Baseful repository..."
    if [ -d "$INSTALL_DIR/.git" ]; then
        warn "Directory $INSTALL_DIR already exists. Updating..."
        cd "$INSTALL_DIR"
        git pull
    else
        git clone "$GITHUB_REPO" "$INSTALL_DIR"
        cd "$INSTALL_DIR"
    fi
fi

# ============================================================
# [3/8] Environment Configuration
# ============================================================
info "[3/8] Configuring environment..."

ENV_FILE=".env"
ENV_EXAMPLE="backend/.env.example"

if [ ! -f "$ENV_FILE" ]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"

    info "Generating secure JWT secret..."
    if command -v openssl >/dev/null 2>&1; then
        RAND_SECRET=$(openssl rand -hex 32)
    else
        RAND_SECRET=$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 48)
    fi

    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$RAND_SECRET|" "$ENV_FILE"

    info "Detecting Public IP..."
    DETECTED_IP=$(curl -s -4 https://ifconfig.me || curl -s -4 https://api.ipify.org || echo "localhost")
    sed -i "s|^PUBLIC_IP=.*|PUBLIC_IP=$DETECTED_IP|" "$ENV_FILE"

    info "Configuring security settings..."
    sed -i "s|^PROXY_SSL_ENABLED=.*|PROXY_SSL_ENABLED=false|"         "$ENV_FILE"
    sed -i "s|^PROXY_IDLE_TIMEOUT=.*|PROXY_IDLE_TIMEOUT=30m|"         "$ENV_FILE"
    sed -i "s|^PROXY_QUERY_TIMEOUT=.*|PROXY_QUERY_TIMEOUT=5m|"        "$ENV_FILE"
    sed -i "s|^PROXY_REVOCATION_CHECK=.*|PROXY_REVOCATION_CHECK=true|" "$ENV_FILE"
    sed -i "s|^PROXY_MAX_LOG_ENTRIES=.*|PROXY_MAX_LOG_ENTRIES=10000|"  "$ENV_FILE"
    sed -i "s|^PROXY_LOG_PATH=.*|PROXY_LOG_PATH=/var/log/proxy/proxy.log|" "$ENV_FILE"

    success "✓ Configured .env with IP: $DETECTED_IP"
else
    warn "Existing .env file found. Skipping configuration."
    DETECTED_IP=$(grep "^PUBLIC_IP=" "$ENV_FILE" | cut -d'=' -f2)
fi

# ============================================================
# [4/8] Log Directories
# ============================================================
info "[4/8] Creating log directories..."
sudo mkdir -p /var/log/proxy
sudo chmod 755 /var/log/proxy
success "✓ Log directories ready."

# ============================================================
# [5/8] Docker Network
# ============================================================
info "[5/8] Initializing Docker network..."
if ! docker network ls | grep -q "baseful-network"; then
    docker network create baseful-network
    success "✓ Created baseful-network."
else
    success "✓ baseful-network already exists."
fi

# ============================================================
# [6/8] Build and Deploy
# ============================================================
info "[6/8] Building and starting services..."
$DOCKER_COMPOSE_CMD up -d --build
success "✓ Services started."

# ============================================================
# [7/8] Security Hardening
# ============================================================
info "[7/8] Applying security hardening..."

# --- UFW ---
if ! command -v ufw >/dev/null 2>&1; then
    sudo apt-get install -y ufw
fi

# Only configure UFW if it's not already active
if ! sudo ufw status | grep -q "Status: active"; then
    info "Configuring firewall..."
    sudo ufw default deny incoming
    sudo ufw default allow outgoing
    sudo ufw allow 22/tcp       # SSH (default port — change manually if you use a custom port)
    sudo ufw allow 80/tcp
    sudo ufw allow 443/tcp
    sudo ufw allow 3000/tcp
    sudo ufw allow 6432/tcp
    echo "y" | sudo ufw enable
    success "✓ UFW firewall configured."
else
    warn "UFW already active. Skipping firewall setup — review rules manually with: sudo ufw status"
fi

# --- Fail2ban ---
if ! command -v fail2ban-client >/dev/null 2>&1; then
    sudo apt-get update -qq
    sudo apt-get install -y fail2ban
fi

# Write jail config only if it doesn't already exist
if [ ! -f /etc/fail2ban/jail.local ]; then
    info "Configuring Fail2ban..."
    sudo tee /etc/fail2ban/jail.local > /dev/null << 'JAIL'
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5
backend = systemd

[sshd]
enabled  = true
port     = ssh
logpath  = %(sshd_log)s

[baseful-proxy]
enabled  = true
port     = 6432
filter   = baseful-proxy
logpath  = /var/log/proxy/proxy.log
maxretry = 10
findtime = 5m
bantime  = 1h
JAIL

    # Write proxy filter
    sudo tee /etc/fail2ban/filter.d/baseful-proxy.conf > /dev/null << 'FILTER'
[Definition]
failregex = ^\{"timestamp":"[^"]+","level":"WARNING","component":"proxy","message":"(?:Connection failed|Token expired|Token revoked)[^"]*","connection":\{"remote_ip":"<HOST>:
ignoreregex =
FILTER

    sudo systemctl enable fail2ban
    sudo systemctl restart fail2ban
    success "✓ Fail2ban configured (SSH + proxy jails active)."
else
    warn "Fail2ban jail.local already exists. Skipping — review manually if needed."
fi

# --- Unattended Upgrades ---
if ! dpkg -l | grep -q unattended-upgrades; then
    sudo apt-get install -y unattended-upgrades
fi

if [ ! -f /etc/apt/apt.conf.d/20auto-upgrades ]; then
    info "Enabling unattended security upgrades..."
    sudo tee /etc/apt/apt.conf.d/20auto-upgrades > /dev/null << 'UPGRADES'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
UPGRADES
    success "✓ Automatic security upgrades enabled."
else
    warn "Unattended upgrades already configured. Skipping."
fi

success "✓ Security hardening complete."

# ============================================================
# [8/8] Finalization
# ============================================================
info "[8/8] Finalizing installation..."
sleep 3

PUBLIC_IP=$(grep "^PUBLIC_IP=" "$ENV_FILE" | cut -d'=' -f2)

printf "\n\033[1;32m🚀 Baseful has been successfully installed!\033[0m\n"
cat << "EOF"
------------------------------------------------
EOF
printf "\033[1mDashboard:\033[0m      http://%s:3000\n" "$PUBLIC_IP"
printf "\033[1mDatabase Proxy:\033[0m %s:6432\n" "$PUBLIC_IP"
cat << "EOF"
------------------------------------------------
EOF
printf "\033[1mSecurity:\033[0m\n"
printf "  ✔ UFW firewall active\n"
printf "  ✔ Fail2ban active (SSH + proxy)\n"
printf "  ✔ Automatic security upgrades enabled\n"
cat << "EOF"
------------------------------------------------
EOF
warn "Recommended next steps (manual):"
printf "1. Set up Tailscale and lock SSH behind it\n"
printf "2. Harden SSH: disable password auth, set ListenAddress\n"
printf "3. Set up encrypted backups to Cloudflare R2\n\n"
info "Logs: cd $INSTALL_DIR && $DOCKER_COMPOSE_CMD logs -f"
info "Proxy logs: tail -f /var/log/proxy/proxy.log"
printf "\n"
