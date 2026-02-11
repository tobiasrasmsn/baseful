#!/bin/bash

# Baseful Installation Script
# This script automates the setup of Baseful on a VPS.
# Usage: curl -sSL https://raw.githubusercontent.com/tobiasrasmsn/baseful/main/install.sh | bash

set -e

# --- Configuration ---
INSTALL_DIR="baseful"
GITHUB_REPO="https://github.com/tobiasrasmsn/baseful.git"

# --- Colors for output ---
# Using printf because echo -e is not portable across all shells (like dash on Ubuntu)
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Helper for colored output
info() { printf "${BLUE}%b${NC}\n" "$1"; }
success() { printf "${GREEN}%b${NC}\n" "$1"; }
warn() { printf "${YELLOW}%b${NC}\n" "$1"; }
error() { printf "${RED}%b${NC}\n" "$1"; }

printf "${BLUE}${BOLD}"
printf "%s" "  ____                 _____       _ \n"
printf "%s" " |  _ \               |  ___|     | |\n"
printf "%s" " | |_) | __ _ ___  ___| |_ _   _| |\n"
printf "%s" " |  _ < / _\` / __|/ _ \  _| | | | |\n"
printf "%s" " | |_) | (_| \__ \  __/ | | |_| | |\n"
printf "%s" " |____/ \__,_|___/\___|_|  \__,_|_|\n"
printf "%s" "                                    \n"
printf "   The Open Source Postgres Platform${NC}\n"
printf "%s" "------------------------------------------------\n"

# 1. System Requirements Check
info "[1/6] Checking system requirements..."

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    warn "Docker not found. Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    if command -v systemctl &> /dev/null; then
        sudo systemctl enable --now docker
    fi
fi

# Check for Docker Compose V2 (docker compose) or V1 (docker-compose)
if docker compose version &> /dev/null; then
    DOCKER_COMPOSE_CMD="docker compose"
elif command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE_CMD="docker-compose"
else
    error "Error: Docker Compose is required but not found."
    info "Please install it: https://docs.docker.com/compose/install/"
    exit 1
fi

if ! command -v git &> /dev/null; then
    warn "Git not found. Installing git..."
    if command -v apt-get &> /dev/null; then
        sudo apt-get update && sudo apt-get install -y git
    elif command -v yum &> /dev/null; then
        sudo yum install -y git
    fi
fi

success "✓ Dependencies are ready."

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

# 3. Environment Configuration
info "[3/6] Configuring environment..."

ENV_FILE="backend/.env"
ENV_EXAMPLE="backend/.env.example"

if [ ! -f "$ENV_FILE" ]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    
    # Generate a secure random JWT secret (32+ chars)
    info "Generating secure JWT secret..."
    if command -v openssl &> /dev/null; then
        RAND_SECRET=$(openssl rand -hex 32)
    else
        RAND_SECRET=$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 48)
    fi
    
    # Use | as delimiter for sed to avoid issues with special characters
    # Support both GNU and BSD sed
    if sed --version 2>/dev/null | grep -q "GNU"; then
        sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$RAND_SECRET|" "$ENV_FILE"
    else
        sed -i '' "s|^JWT_SECRET=.*|JWT_SECRET=$RAND_SECRET|" "$ENV_FILE"
    fi
    
    # Automatically detect Public IP
    info "Detecting Public IP..."
    DETECTED_IP=$(curl -s https://ifconfig.me || curl -s https://api.ipify.org || echo "localhost")
    
    # Update PUBLIC_IP in .env
    if sed --version 2>/dev/null | grep -q "GNU"; then
        sed -i "s|^PUBLIC_IP=.*|PUBLIC_IP=$DETECTED_IP|" "$ENV_FILE"
    else
        sed -i '' "s|^PUBLIC_IP=.*|PUBLIC_IP=$DETECTED_IP|" "$ENV_FILE"
    fi
    
    success "✓ Configured .env with IP: ${BOLD}$DETECTED_IP${NC}${GREEN} and generated JWT secret."
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

printf "\n${GREEN}${BOLD}🚀 Baseful has been successfully installed!${NC}\n"
printf "------------------------------------------------\n"
printf "${BOLD}Dashboard:${NC}    http://${PUBLIC_IP}:3000\n"
printf "${BOLD}Backend API:${NC}  http://${PUBLIC_IP}:8080\n"
printf "${BOLD}Database Proxy:${NC} ${PUBLIC_IP}:6432\n"
printf "------------------------------------------------\n"
warn "\nNext Steps:"
printf "1. Open the Dashboard in your browser.\n"
printf "2. Start creating projects and databases.\n"
printf "3. Connection strings will use your token and the proxy address above.\n"
printf "\nTo view logs, run: ${BOLD}cd $INSTALL_DIR && $DOCKER_COMPOSE_CMD logs -f${NC}\n\n"
