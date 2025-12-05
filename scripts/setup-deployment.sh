#!/bin/bash

# Helper script to gather information needed for GitHub Actions deployment
# Usage: ./scripts/setup-deployment.sh

set -e

echo "========================================="
echo "GitHub Actions Deployment Setup Helper"
echo "========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to prompt user
prompt() {
    read -p "$1: " value
    echo "$value"
}

# Check if SSH key exists
SSH_KEY_PATH="$HOME/.ssh/acroyoga_deploy"

echo -e "${YELLOW}Step 1: SSH Key Generation${NC}"
echo "----------------------------------------"

if [ -f "$SSH_KEY_PATH" ]; then
    echo -e "${GREEN}✓${NC} SSH key already exists at $SSH_KEY_PATH"
    read -p "Do you want to create a new one? (y/N): " recreate
    if [ "$recreate" = "y" ] || [ "$recreate" = "Y" ]; then
        ssh-keygen -t ed25519 -C "github-actions@acroyoga-club.es" -f "$SSH_KEY_PATH" -N ""
        echo -e "${GREEN}✓${NC} New SSH key created"
    fi
else
    echo "Creating new SSH key..."
    ssh-keygen -t ed25519 -C "github-actions@acroyoga-club.es" -f "$SSH_KEY_PATH" -N ""
    echo -e "${GREEN}✓${NC} SSH key created at $SSH_KEY_PATH"
fi

echo ""
echo -e "${YELLOW}Step 2: Public Key (to add to Hostinger)${NC}"
echo "----------------------------------------"
echo -e "${GREEN}Copy this public key and add it to Hostinger SSH settings:${NC}"
echo ""
cat "${SSH_KEY_PATH}.pub"
echo ""
read -p "Press Enter after you've added the key to Hostinger..."

echo ""
echo -e "${YELLOW}Step 3: Gather Server Information${NC}"
echo "----------------------------------------"

SSH_HOST=$(prompt "Enter your Hostinger SSH host (e.g., srv123.hostinger.com or IP address)")
SSH_PORT=$(prompt "Enter your SSH port (default: 22)")
SSH_PORT=${SSH_PORT:-22}
SSH_USER=$(prompt "Enter your SSH username (e.g., u123456789)")

echo ""
echo "Testing SSH connection..."
if ssh -i "$SSH_KEY_PATH" -p "$SSH_PORT" -o StrictHostKeyChecking=no -o ConnectTimeout=5 "$SSH_USER@$SSH_HOST" "echo 'Connection successful'" 2>/dev/null; then
    echo -e "${GREEN}✓${NC} SSH connection successful!"
else
    echo -e "${RED}✗${NC} SSH connection failed. Please check your credentials and try again."
    exit 1
fi

echo ""
echo "Finding WordPress plugins directory..."
PLUGINS_PATH=$(ssh -i "$SSH_KEY_PATH" -p "$SSH_PORT" "$SSH_USER@$SSH_HOST" "find ~ -type d -path '*/wp-content/plugins' 2>/dev/null | head -1")

if [ -n "$PLUGINS_PATH" ]; then
    echo -e "${GREEN}✓${NC} Found WordPress plugins directory: $PLUGINS_PATH"
else
    echo -e "${YELLOW}⚠${NC} Could not auto-detect plugins directory."
    PLUGINS_PATH=$(prompt "Enter full path to WordPress plugins directory")
fi

echo ""
echo -e "${YELLOW}Step 4: GitHub Secrets Summary${NC}"
echo "----------------------------------------"
echo "Add these secrets to your GitHub repository:"
echo "(Settings → Secrets and variables → Actions → New repository secret)"
echo ""

echo -e "${GREEN}SSH_PRIVATE_KEY:${NC}"
echo "Copy everything below (including BEGIN/END lines):"
echo "---"
cat "$SSH_KEY_PATH"
echo "---"
echo ""

echo -e "${GREEN}SSH_HOST:${NC}"
echo "$SSH_HOST"
echo ""

echo -e "${GREEN}SSH_PORT:${NC}"
echo "$SSH_PORT"
echo ""

echo -e "${GREEN}SSH_USER:${NC}"
echo "$SSH_USER"
echo ""

echo -e "${GREEN}WORDPRESS_PLUGINS_PATH:${NC}"
echo "$PLUGINS_PATH"
echo ""

# Save to file for reference
CONFIG_FILE="deployment-config.txt"
cat > "$CONFIG_FILE" << EOF
GitHub Secrets Configuration
Generated: $(date)

SSH_HOST: $SSH_HOST
SSH_PORT: $SSH_PORT
SSH_USER: $SSH_USER
WORDPRESS_PLUGINS_PATH: $PLUGINS_PATH

SSH_PRIVATE_KEY: See $SSH_KEY_PATH

Public key (added to Hostinger): $(cat "${SSH_KEY_PATH}.pub")
EOF

echo -e "${GREEN}✓${NC} Configuration saved to $CONFIG_FILE"
echo ""
echo -e "${YELLOW}Step 5: Test Deployment${NC}"
echo "----------------------------------------"
echo "You can now:"
echo "1. Add the secrets to GitHub"
echo "2. Push to main branch to trigger auto-deployment"
echo "3. Or manually trigger: gh workflow run deploy-acroyoga.yml"
echo ""
echo -e "${GREEN}Setup complete!${NC}"
