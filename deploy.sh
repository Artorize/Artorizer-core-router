#!/bin/bash

################################################################################
# Artorizer Core Router - Debian 12 Auto Deployment Script
################################################################################
# This script automates deployment on a fresh Debian 12 server
# Usage: sudo ./deploy.sh [production|staging]
################################################################################

set -e  # Exit on error
set -u  # Exit on undefined variable

# Configuration
DEPLOY_ENV="${1:-production}"
APP_NAME="artorize-router"
APP_USER="artorize"
APP_DIR="/opt/artorize-router"
LOG_DIR="/var/log/artorize"
NODE_VERSION="20"  # LTS version

# Repository Configuration
GITHUB_REPO="https://github.com/Artorize/Artorizer-core-router.git"
GITHUB_BRANCH="${2:-master}"  # Default to master branch

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   log_error "This script must be run as root (use sudo)"
   exit 1
fi

log_info "Starting deployment for environment: $DEPLOY_ENV"

################################################################################
# 1. System Updates and Prerequisites
################################################################################
log_info "Step 1/7: Updating system packages..."
apt-get update -y
apt-get upgrade -y

log_info "Installing system dependencies..."
apt-get install -y \
    curl \
    wget \
    git \
    build-essential \
    python3 \
    ca-certificates \
    gnupg \
    ufw \
    nginx \
    redis-server \
    supervisor

################################################################################
# 2. Install Node.js
################################################################################
log_info "Step 2/7: Installing Node.js ${NODE_VERSION}..."

# Remove old NodeSource repository if it exists
rm -f /etc/apt/sources.list.d/nodesource.list

# Add NodeSource repository and install
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
apt-get install -y nodejs

# Verify installation
node_version=$(node --version)
npm_version=$(npm --version)
log_info "Node.js version: $node_version"
log_info "npm version: $npm_version"

# Verify minimum required version (Node 18+)
required_major=18
current_major=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$current_major" -lt "$required_major" ]; then
    log_error "Node.js $current_major detected, but version $required_major+ is required"
    log_error "Please upgrade Node.js and try again"
    exit 1
fi
log_info "Node.js version check passed (v$current_major >= v$required_major)"

################################################################################
# 3. Create Application User
################################################################################
log_info "Step 3/7: Creating application user..."

if ! id "$APP_USER" &>/dev/null; then
    useradd -r -s /bin/bash -d "$APP_DIR" -m "$APP_USER"
    log_info "Created user: $APP_USER"
else
    log_warn "User $APP_USER already exists"
fi

################################################################################
# 4. Setup Application Directory
################################################################################
log_info "Step 4/7: Setting up application directory..."

# Create directories
mkdir -p "$APP_DIR"
mkdir -p "$LOG_DIR"

# Set ownership
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chown -R "$APP_USER:$APP_USER" "$LOG_DIR"

################################################################################
# 5. Clone/Update Repository
################################################################################
log_info "Step 5/7: Cloning repository from $GITHUB_REPO (branch: $GITHUB_BRANCH)..."

# Preserve existing config if it exists
SAVED_ENV=""
if [ -f "$APP_DIR/.env" ]; then
    log_info "Preserving existing configuration..."
    SAVED_ENV=$(cat "$APP_DIR/.env")
fi

# Remove old installation if it exists
if [ -d "$APP_DIR" ]; then
    log_info "Removing old installation..."
    rm -rf "$APP_DIR"
fi

# Clone repository
git clone --branch "$GITHUB_BRANCH" "$GITHUB_REPO" "$APP_DIR"

# Restore preserved config
if [ -n "$SAVED_ENV" ]; then
    log_info "Restoring configuration..."
    echo "$SAVED_ENV" > "$APP_DIR/.env"
    chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
    chmod 600 "$APP_DIR/.env"
fi

# Ensure proper ownership
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# Install dependencies, build, and prune (all in correct directory)
log_info "Installing npm dependencies..."
cd "$APP_DIR"
sudo -u "$APP_USER" bash -c "cd $APP_DIR && npm ci"

log_info "Building TypeScript..."
sudo -u "$APP_USER" bash -c "cd $APP_DIR && npm run build"

# Verify build succeeded
if [ ! -f "$APP_DIR/dist/index.js" ]; then
    log_error "Build failed - dist/index.js not found"
    exit 1
fi
log_info "Build successful - dist/index.js created"

log_info "Pruning dev dependencies..."
sudo -u "$APP_USER" bash -c "cd $APP_DIR && npm prune --production"

################################################################################
# 6. Environment Configuration
################################################################################
log_info "Step 6/7: Configuring environment..."

ENV_FILE="$APP_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
    log_warn "No .env file found. Creating from template..."

    cat > "$ENV_FILE" << 'EOF'
# Environment
NODE_ENV=production

# Server Configuration
PORT=7000
HOST=127.0.0.1
WORKERS=4

# External Services (UPDATE THESE!)
BACKEND_URL=http://localhost:5001
PROCESSOR_URL=http://localhost:8000

# Router Configuration
ROUTER_BASE_URL=http://localhost:7000
CALLBACK_AUTH_TOKEN=CHANGE_THIS_SECRET_TOKEN

# Redis Configuration
REDIS_HOST=127.0.0.1
REDIS_PORT=6379

# Performance
PROCESSOR_TIMEOUT=30000
MAX_FILE_SIZE=268435456

# Logging
LOG_LEVEL=info
EOF

    log_warn "IMPORTANT: Edit $ENV_FILE with your actual configuration!"
    log_warn "Especially update: BACKEND_URL, PROCESSOR_URL, CALLBACK_AUTH_TOKEN"
fi

# Set proper permissions
chown "$APP_USER:$APP_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"

# Verify .env exists and is readable
if [ ! -f "$ENV_FILE" ]; then
    log_error ".env file was not created properly"
    exit 1
fi
log_info ".env file configured successfully"

################################################################################
# 7. Setup Systemd Service
################################################################################
log_info "Step 7/7: Configuring systemd service..."

cat > "/etc/systemd/system/$APP_NAME.service" << EOF
[Unit]
Description=Artorizer Core Router - High-performance ingress API
After=network.target redis-server.service
Wants=redis-server.service

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=-$APP_DIR/.env

# Start command
ExecStart=/usr/bin/node $APP_DIR/dist/index.js

# Restart policy
Restart=always
RestartSec=10
StartLimitInterval=60
StartLimitBurst=3

# Logging
StandardOutput=append:$LOG_DIR/router.log
StandardError=append:$LOG_DIR/router-error.log
SyslogIdentifier=$APP_NAME

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$LOG_DIR

# Resource limits
LimitNOFILE=65536
LimitNPROC=4096

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd
systemctl daemon-reload

################################################################################
# 8. Configure Firewall
################################################################################
log_info "Configuring firewall..."

# Allow SSH (important!)
ufw allow 22/tcp

# Allow HTTP/HTTPS
ufw allow 80/tcp
ufw allow 443/tcp

# Enable firewall (non-interactive)
echo "y" | ufw enable || true

################################################################################
# 9. Configure Redis
################################################################################
log_info "Configuring Redis..."

# Ensure Redis is running
systemctl enable redis-server
systemctl start redis-server

################################################################################
# 10. Start Services
################################################################################
log_info "Starting services..."

# Enable and start the application
systemctl enable "$APP_NAME"
systemctl restart "$APP_NAME"

# Wait a moment for service to start
sleep 3

################################################################################
# 11. Verify Deployment
################################################################################
log_info "Verifying deployment..."

# Check service status
if systemctl is-active --quiet "$APP_NAME"; then
    log_info "✓ Service $APP_NAME is running"
else
    log_error "✗ Service $APP_NAME failed to start"
    log_error "Check logs: journalctl -u $APP_NAME -n 50"
    exit 1
fi

# Check Redis status
if systemctl is-active --quiet redis-server; then
    log_info "✓ Redis is running"
else
    log_warn "✗ Redis is not running (may be optional)"
fi

# Test HTTP endpoint
sleep 2
if curl -sf http://localhost:7000 > /dev/null 2>&1 || curl -sf http://localhost > /dev/null 2>&1; then
    log_info "✓ HTTP endpoint is responding"
else
    log_warn "✗ HTTP endpoint not responding (this may be normal if no root route exists)"
fi

################################################################################
# Cleanup
################################################################################
log_info "Deployment cleanup complete"

################################################################################
# Deployment Summary
################################################################################
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_info "Deployment completed successfully!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📂 Application Directory: $APP_DIR"
echo "📝 Environment File: $ENV_FILE"
echo "📊 Logs Directory: $LOG_DIR"
echo ""
echo "🔧 Useful Commands:"
echo "  - View logs:        journalctl -u $APP_NAME -f"
echo "  - Restart service:  systemctl restart $APP_NAME"
echo "  - Check status:     systemctl status $APP_NAME"
echo "  - View app logs:    tail -f $LOG_DIR/router.log"
echo ""
echo "⚠️  IMPORTANT NEXT STEPS:"
echo "  1. Edit environment file: nano $ENV_FILE"
echo "  2. Update BACKEND_URL, PROCESSOR_URL, CALLBACK_AUTH_TOKEN"
echo "  3. Restart service: systemctl restart $APP_NAME"
echo ""
echo "🔒 Security Recommendations:"
echo "  - Review firewall: ufw status"
echo "  - Secure Redis: add password in /etc/redis/redis.conf"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
