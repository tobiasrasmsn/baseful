#!/bin/bash

# Baseful Installation Script
# This script automates the setup of Baseful on a VPS.
# Usage: curl -sSL https://raw.githubusercontent.com/tobiasrasmsn/baseful/main/install.sh | bash

set -e

# --- Configuration ---
INSTALL_DIR="baseful"
GITHUB_REPO="https://github.com/tobiasrasmsn/baseful.git"

# --- Colors for output ---
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

# Helper for colored output
# Fixed: Guaranteed to never trigger "invalid option" by using fixed format strings
info() { printf "%b%s%b\n" "$BLUE" "$1" "$NC"; }
success() { printf "%b%b%s%b\n" "$GREEN" "$BOLD" "$1" "$NC"; }
warn() { printf "%b%s%b\n" "$YELLOW" "$1" "$NC"; }
error() { printf "%b%b%s%b\n" "$RED" "$BOLD" "$1" "$NC"; }

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

# 0. Check if we are already in a baseful directory
if [ -f "docker-compose.yml" ] && grep -q "baseful-backend" "docker-compose.yml"; then
    info "Detected existing Baseful directory. Skipping clone..."
    INSTALL_DIR="."
else
    # 2. Clone Repository
    info "[2/6] Cloning Baseful repository..."
    if [ -d "$INSTALL_DIR" ]; then
        warn "Warning: Directory $INSTALL_DIR already exists. Updating..."
        cd "$INSTALL_DIR"
        git pull
    else
        git clone "$GITHUB_REPO" "$INSTALL_DIR"
        cd "$INSTALL_DIR"
    fi
fi

# 1. System Requirements Check
info "[1/6] Checking system requirements..."

# Check if Docker is installed
if ! command -v docker >/dev/null 2>&1; then
    warn "Docker not found. Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    if command -v systemctl >/dev/null 2>&1; then
        sudo systemctl enable --now docker
    fi
fi

# Check for Docker Compose
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

# 3. Environment Configuration
info "[3/6] Configuring environment..."

ENV_FILE="backend/.env"
ENV_EXAMPLE="backend/.env.example"

if [ ! -f "$ENV_FILE" ]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    
    # Generate a secure random JWT secret
    info "Generating secure JWT secret..."
    if command -v openssl >/dev/null 2>&1; then
        RAND_SECRET=$(openssl rand -hex 32)
    else
        RAND_SECRET=$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 48)
    fi
    
    # Update JWT_SECRET
    if sed --version 2>/dev/null | grep -q "GNU"; then
        sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$RAND_SECRET|" "$ENV_FILE"
    else
        sed -i '' "s|^JWT_SECRET=.*|JWT_SECRET=$RAND_SECRET|" "$ENV_FILE"
    fi
    
    # Automatically detect Public IP
    info "Detecting Public IP..."
    DETECTED_IP=$(curl -s -4 https://ifconfig.me || curl -s -4 https://api.ipify.org || curl -s https://ifconfig.me || echo "localhost")
    
    # Update PUBLIC_IP
    if sed --version 2>/dev/null | grep -q "GNU"; then
        sed -i "s|^PUBLIC_IP=.*|PUBLIC_IP=$DETECTED_IP|" "$ENV_FILE"
    else
        sed -i '' "s|^PUBLIC_IP=.*|PUBLIC_IP=$DETECTED_IP|" "$ENV_FILE"
    fi
    
    success "✓ Configured .env with IP: $DETECTED_IP"
else
    warn "Existing .env file found. Skipping configuration."
fi

# 4. Docker Network Setup
info "[4/6] Initializing Docker network..."
if ! docker network ls | grep -q "baseful-network"; then
    docker network create baseful-network
    success "✓ Created baseful-network."
else
    success "✓ baseful-network already exists."
fi

# 5. Build and Deploy
info "[5/6] Pulling images and starting services..."
$DOCKER_COMPOSE_CMD up -d --build

# 6. Finalization
info "[6/6] Finalizing installation..."

# Wait for services to start
info "Waiting for services to start..."
sleep 5

PUBLIC_IP=$(grep "^PUBLIC_IP=" "$ENV_FILE" | cut -d'=' -f2)

printf "\n\033[1;32m🚀 Baseful has been successfully installed!\033[0m\n"
cat << "EOF"
------------------------------------------------
EOF
printf "\033[1mDashboard:\033[0m    http://%s:3000\n" "$PUBLIC_IP"
printf "\033[1mBackend API:\033[0m  http://%s:8080\n" "$PUBLIC_IP"
printf "\033[1mDatabase Proxy:\033[0m %s:6432\n" "$PUBLIC_IP"
cat << "EOF"
------------------------------------------------
EOF
warn "\nNext Steps:"
printf "1. Open the Dashboard in your browser.\n"
printf "2. Start creating projects and databases.\n"
printf "3. Connection strings will use your token and the proxy address above.\n\n"
info "To view logs, run: cd $INSTALL_DIR && $DOCKER_COMPOSE_CMD logs -f"
printf "\n"
