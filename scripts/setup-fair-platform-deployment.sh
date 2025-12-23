#!/bin/bash

# Helper script to gather information needed for fair-platform GitHub Actions deployment
# Usage: ./scripts/setup-fair-platform-deployment.sh

set -e

echo "==========================================================="
echo "Fair Platform Deployment Setup Helper"
echo "Deploy fair-platform to fair-event-plugins.com"
echo "==========================================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to prompt user
prompt() {
    read -p "$1: " value
    echo "$value"
}

# Check if SSH key exists
SSH_KEY_PATH="$HOME/.ssh/fair_platform_deploy"

echo -e "${YELLOW}Step 1: SSH Key Generation${NC}"
echo "----------------------------------------"

if [ -f "$SSH_KEY_PATH" ]; then
    echo -e "${GREEN}✓${NC} SSH key already exists at $SSH_KEY_PATH"
    read -p "Do you want to create a new one? (y/N): " recreate
    if [ "$recreate" = "y" ] || [ "$recreate" = "Y" ]; then
        ssh-keygen -t ed25519 -C "github-actions@fair-event-plugins.com" -f "$SSH_KEY_PATH" -N ""
        echo -e "${GREEN}✓${NC} New SSH key created"
    fi
else
    echo "Creating new SSH key for fair-platform deployment..."
    ssh-keygen -t ed25519 -C "github-actions@fair-event-plugins.com" -f "$SSH_KEY_PATH" -N ""
    echo -e "${GREEN}✓${NC} SSH key created at $SSH_KEY_PATH"
fi

echo ""
echo -e "${YELLOW}Step 2: Public Key (to add to server)${NC}"
echo "----------------------------------------"
echo -e "${GREEN}Copy this public key and add it to fair-event-plugins.com server:${NC}"
echo ""
echo -e "${BLUE}# On the server, run:${NC}"
echo -e "${BLUE}mkdir -p ~/.ssh${NC}"
echo -e "${BLUE}nano ~/.ssh/authorized_keys  # Then paste the key below${NC}"
echo ""
cat "${SSH_KEY_PATH}.pub"
echo ""
read -p "Press Enter after you've added the key to the server..."

echo ""
echo -e "${YELLOW}Step 3: Gather Server Information${NC}"
echo "----------------------------------------"

SSH_HOST=$(prompt "Enter fair-event-plugins.com SSH host (domain or IP address)")
SSH_PORT=$(prompt "Enter SSH port (default: 22)")
SSH_PORT=${SSH_PORT:-22}
SSH_USER=$(prompt "Enter SSH username")

echo ""
echo "Testing SSH connection to fair-event-plugins.com..."
if ssh -i "$SSH_KEY_PATH" -p "$SSH_PORT" -o StrictHostKeyChecking=no -o ConnectTimeout=5 "$SSH_USER@$SSH_HOST" "echo 'Connection successful'" 2>/dev/null; then
    echo -e "${GREEN}✓${NC} SSH connection successful!"
else
    echo -e "${RED}✗${NC} SSH connection failed. Please check your credentials and try again."
    echo ""
    echo "Troubleshooting tips:"
    echo "1. Verify the public key was added to ~/.ssh/authorized_keys on the server"
    echo "2. Check SSH permissions: chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"
    echo "3. Verify SSH_HOST and SSH_PORT are correct"
    echo "4. Test manually: ssh -i $SSH_KEY_PATH -p $SSH_PORT $SSH_USER@$SSH_HOST"
    exit 1
fi

echo ""
echo "Finding WordPress plugins directory on fair-event-plugins.com..."
PLUGINS_PATH=$(ssh -i "$SSH_KEY_PATH" -p "$SSH_PORT" "$SSH_USER@$SSH_HOST" "find ~ -type d -path '*/wp-content/plugins' 2>/dev/null | head -1")

if [ -n "$PLUGINS_PATH" ]; then
    echo -e "${GREEN}✓${NC} Found WordPress plugins directory: $PLUGINS_PATH"
    echo ""
    echo "Verifying write permissions..."
    if ssh -i "$SSH_KEY_PATH" -p "$SSH_PORT" "$SSH_USER@$SSH_HOST" "test -w '$PLUGINS_PATH' && echo 'writable'" | grep -q "writable"; then
        echo -e "${GREEN}✓${NC} Directory is writable"
    else
        echo -e "${YELLOW}⚠${NC} Warning: Directory may not be writable. Deployment might fail."
        echo "You may need to run: sudo chown -R $SSH_USER:$SSH_USER $PLUGINS_PATH"
    fi
else
    echo -e "${YELLOW}⚠${NC} Could not auto-detect plugins directory."
    PLUGINS_PATH=$(prompt "Enter full path to WordPress plugins directory")
fi

echo ""
echo -e "${YELLOW}Step 4: GitHub Environment Setup${NC}"
echo "----------------------------------------"
echo "1. Go to your GitHub repository"
echo "2. Navigate to: Settings → Environments"
echo "3. Click 'New environment'"
echo "4. Name: ${GREEN}fair-event-plugins.com${NC}"
echo "5. (Optional) Add protection rules for production safety"
echo ""
read -p "Press Enter after you've created the environment..."

echo ""
echo -e "${YELLOW}Step 5: GitHub Secrets Summary${NC}"
echo "----------------------------------------"
echo "Add these secrets to your GitHub repository:"
echo "(Settings → Secrets and variables → Actions → New repository secret)"
echo ""

echo -e "${GREEN}Secret name: FAIR_PLATFORM_SSH_KEY${NC}"
echo "Copy everything below (including BEGIN/END lines):"
echo "---"
cat "$SSH_KEY_PATH"
echo "---"
echo ""

echo -e "${GREEN}Secret name: FAIR_PLATFORM_SSH_HOST${NC}"
echo "Value:"
echo "$SSH_HOST"
echo ""

echo -e "${GREEN}Secret name: FAIR_PLATFORM_SSH_PORT${NC}"
echo "Value:"
echo "$SSH_PORT"
echo ""

echo -e "${GREEN}Secret name: FAIR_PLATFORM_SSH_USER${NC}"
echo "Value:"
echo "$SSH_USER"
echo ""

echo -e "${GREEN}Secret name: FAIR_PLATFORM_PLUGINS_PATH${NC}"
echo "Value:"
echo "$PLUGINS_PATH"
echo ""

# Save to file for reference
CONFIG_FILE="fair-platform-deployment-config.txt"
cat > "$CONFIG_FILE" << EOF
Fair Platform GitHub Secrets Configuration
Generated: $(date)
Target: fair-event-plugins.com

===========================================
GitHub Secrets (copy these exactly)
===========================================

Secret name: FAIR_PLATFORM_SSH_HOST
Value: $SSH_HOST

Secret name: FAIR_PLATFORM_SSH_PORT
Value: $SSH_PORT

Secret name: FAIR_PLATFORM_SSH_USER
Value: $SSH_USER

Secret name: FAIR_PLATFORM_PLUGINS_PATH
Value: $PLUGINS_PATH

Secret name: FAIR_PLATFORM_SSH_KEY
Value: See $SSH_KEY_PATH

===========================================
Reference Information
===========================================

Public key (added to server):
$(cat "${SSH_KEY_PATH}.pub")

SSH connection test:
ssh -i $SSH_KEY_PATH -p $SSH_PORT $SSH_USER@$SSH_HOST

Manual deployment test:
rsync -avz --delete -e "ssh -i $SSH_KEY_PATH -p $SSH_PORT" \\
  ./fair-platform/ \\
  $SSH_USER@$SSH_HOST:$PLUGINS_PATH/fair-platform/

===========================================
GitHub Environment
===========================================

Environment name: fair-event-plugins.com
Location: Settings → Environments → New environment
EOF

echo -e "${GREEN}✓${NC} Configuration saved to $CONFIG_FILE"
echo ""

echo -e "${YELLOW}Step 6: Verify Plugin Directory${NC}"
echo "----------------------------------------"
echo "Checking if fair-platform directory exists on server..."
if ssh -i "$SSH_KEY_PATH" -p "$SSH_PORT" "$SSH_USER@$SSH_HOST" "test -d '$PLUGINS_PATH/fair-platform' && echo 'exists'" | grep -q "exists"; then
    echo -e "${GREEN}✓${NC} fair-platform directory already exists on server"
    read -p "Do you want to test deployment now? (y/N): " test_deploy
    if [ "$test_deploy" = "y" ] || [ "$test_deploy" = "Y" ]; then
        echo ""
        echo "Testing rsync deployment..."
        echo "This will sync the local fair-platform directory to the server (DRY RUN):"
        rsync -avzn --delete \
          -e "ssh -i $SSH_KEY_PATH -p $SSH_PORT" \
          ./fair-platform/ \
          "$SSH_USER@$SSH_HOST:$PLUGINS_PATH/fair-platform/"
        echo ""
        echo -e "${BLUE}Note: This was a dry run (no files changed). Remove the 'n' flag to actually deploy.${NC}"
    fi
else
    echo -e "${YELLOW}⚠${NC} fair-platform directory does not exist on server yet"
    echo "It will be created automatically during first deployment"
fi

echo ""
echo -e "${YELLOW}Step 7: Next Steps${NC}"
echo "----------------------------------------"
echo "You can now deploy fair-platform by:"
echo ""
echo -e "${BLUE}Option 1: Automatic deployment (recommended)${NC}"
echo "  1. Add all 5 secrets to GitHub (shown above)"
echo "  2. Create the 'fair-event-plugins.com' environment"
echo "  3. Push changes to main branch"
echo "  4. GitHub Actions will automatically deploy after CI passes"
echo ""
echo -e "${BLUE}Option 2: Manual deployment${NC}"
echo "  1. Add all 5 secrets to GitHub"
echo "  2. Create the 'fair-event-plugins.com' environment"
echo "  3. Go to Actions → Deploy Fair Platform to fair-event-plugins.com"
echo "  4. Click 'Run workflow'"
echo ""
echo -e "${BLUE}Option 3: Local deployment (for testing)${NC}"
echo "  cd fair-platform"
echo "  composer install --no-dev"
echo "  cd .."
echo "  rsync -avz --delete \\"
echo "    -e \"ssh -i $SSH_KEY_PATH -p $SSH_PORT\" \\"
echo "    ./fair-platform/ \\"
echo "    $SSH_USER@$SSH_HOST:$PLUGINS_PATH/fair-platform/"
echo ""
echo -e "${GREEN}✓ Setup complete!${NC}"
echo ""
echo "Configuration details saved to: $CONFIG_FILE"
echo ""
