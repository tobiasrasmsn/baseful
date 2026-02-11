#!/bin/bash

# Baseful Installation Script
# This script automates the setup of Baseful on a VPS.
# Usage: curl -sSL https://baseful.com/install.sh | bash

set -e

# --- Configuration ---
INSTALL_DIR="baseful"
GITHUB_REPO="https://github.com/fake-user/baseful.git" # Replace with actual repo

# --- Colors for output ---
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo -e "${BLUE}${BOLD}"
echo "  ____                 _____       _ "
echo " |  _ \               |  ___|     | |"
echo " | |_) | __ _ ___  ___| |_ _   _| |"
echo " |  _ < / _\` / __|/ _ \  _| | | | |"
echo " | |_) | (_| \__ \  __/ | | |_| | |"
echo " |____/ \__,_|___/\___|_|  \__,_|_|"
echo "                                    "
echo -e "   The Open Source Postgres Platform${NC}"
echo "------------------------------------------------"

# 1. System Requirements Check
echo -e "${BLUE}[1/6] Checking system requirements...${NC}"

if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Docker not found. Installing Docker...${NC}"
    curl -fsSL https://get.docker.com | sh
    if command -v systemctl &> /dev/null; then
        sudo systemctl enable --now docker
    fi
fi

if ! command -v docker compose &> /dev/null; then
    echo -e "${RED}Error: Docker Compose V2 is required but not found.${NC}"
    echo -e "Please install it manually: https://docs.docker.com/compose/install/"
    exit 1
fi

if ! command -v git &> /dev/null; then
    echo -e "${YELLOW}Git not found. Installing git...${NC}"
    if command -v apt-get &> /dev/null; then
        sudo apt-get update && sudo apt-get install -y git
    elif command -v yum &> /dev/null; then
        sudo sudo yum install -y git
    fi
fi

echo -e "${GREEN}✓ Dependencies are ready.${NC}"

# 2. Clone Repository
echo -e "${BLUE}[2/6] Cloning Baseful repository...${NC}"
if [ -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}Warning: Directory $INSTALL_DIR already exists. Updating...${NC}"
    cd "$INSTALL_DIR"
    git pull
else
    git clone "$GITHUB_REPO" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# 3. Environment Configuration
echo -e "${BLUE}[3/6] Configuring environment...${NC}"

ENV_FILE="backend/.env"
ENV_EXAMPLE="backend/.env.example"

if [ ! -f "$ENV_FILE" ]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    
    # Generate a secure random JWT secret (32+ chars)
    echo -e "Generating secure JWT secret..."
    if command -v openssl &> /dev/null; then
        RAND_SECRET=$(openssl rand -hex 32)
    else
        RAND_SECRET=$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 48)
    fi
    # Use | as delimiter for sed to avoid issues with special characters
    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$RAND_SECRET|" "$ENV_FILE"
    
    # Automatically detect Public IP
    echo -e "Detecting Public IP..."
    DETECTED_IP=$(curl -s https://ifconfig.me || curl -s https://api.ipify.org || echo "localhost")
    
    # Update PUBLIC_IP in .env
    sed -i "s|^PUBLIC_IP=.*|PUBLIC_IP=$DETECTED_IP|" "$ENV_FILE"
    
    echo -e "${GREEN}✓ Configured .env with IP: ${BOLD}$DETECTED_IP${NC}${GREEN} and generated JWT secret.${NC}"
else
    echo -e "${YELLOW}Existing .env file found. Skipping configuration.${NC}"
fi

# 4. Docker Network Setup
echo -e "${BLUE}[4/6] Initializing Docker network...${NC}"
if ! docker network ls | grep -q "baseful-network"; then
    docker network create baseful-network
    echo -e "${GREEN}✓ Created baseful-network.${NC}"
else
    echo -e "${GREEN}✓ baseful-network already exists.${NC}"
fi

# 5. Build and Deploy
echo -e "${BLUE}[5/6] Pulling images and starting services...${NC}"
docker compose up -d --build

# 6. Finalization
echo -e "${BLUE}[6/6] Finalizing installation...${NC}"

# Wait for services to start
echo -e "Waiting for services to start..."
sleep 5

PUBLIC_IP=$(grep "^PUBLIC_IP=" "$ENV_FILE" | cut -d'=' -f2)

echo -e "\n${GREEN}${BOLD}🚀 Baseful has been successfully installed!${NC}"
echo -e "------------------------------------------------"
echo -e "${BOLD}Dashboard:${NC}    http://${PUBLIC_IP}:3000"
echo -e "${BOLD}Backend API:${NC}  http://${PUBLIC_IP}:8080"
echo -e "${BOLD}Database Proxy:${NC} ${PUBLIC_IP}:6432"
echo -e "------------------------------------------------"
echo -e "\n${YELLOW}Next Steps:${NC}"
echo -e "1. Open the Dashboard in your browser."
echo -e "2. Start creating projects and databases."
echo -e "3. Connection strings will use your token and the proxy address above."
echo -e "\nTo view logs, run: ${BOLD}cd $INSTALL_DIR && docker compose logs -f${NC}\n"
