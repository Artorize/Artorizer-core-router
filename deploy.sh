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
APP_NAME="artoize-router"
APP_USER="artorizer"
APP_DIR="/opt/artorizer-router"
LOG_DIR="/var/log/artorizer"
NODE_VERSION="20"  # LTS version

# Repository Configuration
# For public repos: use HTTPS (no authentication needed)
GITHUB_REPO="https://github.com/Artorize/Artorizer-core-router.git"
# For private repos: use SSH (requires deploy key setup)
# GITHUB_REPO="git@github.com:Artorize/Artorizer-core-router.git"

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
log_info "Step 1/8: Updating system packages..."
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
log_info "Step 2/8: Installing Node.js ${NODE_VERSION}..."

# Add NodeSource repository
if [ ! -f /etc/apt/sources.list.d/nodesource.list ]; then
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
    apt-get install -y nodejs
fi

# Verify installation
node_version=$(node --version)
npm_version=$(npm --version)
log_info "Node.js version: $node_version"
log_info "npm version: $npm_version"

################################################################################
# 3. Create Application User
################################################################################
log_info "Step 3/8: Creating application user..."

if ! id "$APP_USER" &>/dev/null; then
    useradd -r -s /bin/bash -d "$APP_DIR" -m "$APP_USER"
    log_info "Created user: $APP_USER"
else
    log_warn "User $APP_USER already exists"
fi

################################################################################
# 4. Setup Application Directory
################################################################################
log_info "Step 4/8: Setting up application directory..."

# Create directories
mkdir -p "$APP_DIR"
mkdir -p "$LOG_DIR"
mkdir -p "$APP_DIR/.ssh"

# Set ownership
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chown -R "$APP_USER:$APP_USER" "$LOG_DIR"

# Set proper SSH directory permissions (required for SSH keys)
chmod 700 "$APP_DIR/.ssh" 2>/dev/null || true

################################################################################
# 5. Clone/Update Repository
################################################################################
log_info "Step 5/8: Deploying application code from GitHub..."

# Check if repository is accessible before proceeding
log_info "Checking repository accessibility..."
export GIT_TERMINAL_PROMPT=0  # Prevent interactive prompts

if ! sudo -u "$APP_USER" git ls-remote "$GITHUB_REPO" &>/dev/null; then
    log_error "Cannot access repository: $GITHUB_REPO"
    log_error "Possible reasons:"
    log_error "  1. Repository doesn't exist or URL is incorrect"
    log_error "  2. Repository is private and requires authentication"
    log_error "  3. Network connectivity issues"
    log_error ""
    log_error "For private repositories:"
    log_error "  - Use SSH: GITHUB_REPO=\"git@github.com:Artorize/artorize-core-router.git\""
    log_error "  - Setup deploy key in $APP_DIR/.ssh/ before running this script"
    log_error ""
    log_error "For public repositories:"
    log_error "  - Verify the repository URL is correct"
    log_error "  - Check your network connection"
    exit 1
fi

log_info "Repository is accessible ✓"

# Backup config files if they exist
BACKUP_DIR="/tmp/artorizer-backup-$$"
if [ -d "$APP_DIR" ]; then
    log_info "Backing up existing configuration files..."
    mkdir -p "$BACKUP_DIR"

    # Backup .env if exists
    if [ -f "$APP_DIR/.env" ]; then
        cp "$APP_DIR/.env" "$BACKUP_DIR/.env" 2>/dev/null || true
    fi

    # Backup SSH keys if they exist (for private repos)
    if [ -d "$APP_DIR/.ssh" ]; then
        cp -r "$APP_DIR/.ssh" "$BACKUP_DIR/.ssh" 2>/dev/null || true
    fi

    log_info "Configuration backed up to $BACKUP_DIR"
fi

# Clean existing directory if it exists
if [ -d "$APP_DIR" ]; then
    log_info "Existing installation found. Cleaning directory..."
    # Remove everything except logs
    rm -rf "$APP_DIR"/*
    rm -rf "$APP_DIR"/.[!.]* 2>/dev/null || true
    log_info "Directory cleaned"
fi

# Clone fresh repository (non-interactive)
log_info "Cloning fresh repository from $GITHUB_REPO (branch: $GITHUB_BRANCH)..."
if [ -d "$APP_DIR" ] && [ ! "$(ls -A $APP_DIR 2>/dev/null)" ]; then
    # Directory exists but is empty
    sudo -u "$APP_USER" GIT_TERMINAL_PROMPT=0 git clone --branch "$GITHUB_BRANCH" "$GITHUB_REPO" "$APP_DIR"
else
    # Directory doesn't exist
    sudo -u "$APP_USER" GIT_TERMINAL_PROMPT=0 git clone --branch "$GITHUB_BRANCH" "$GITHUB_REPO" "$APP_DIR"
fi

# Restore config files if they were backed up
if [ -d "$BACKUP_DIR" ]; then
    log_info "Restoring configuration files..."

    # Restore .env
    if [ -f "$BACKUP_DIR/.env" ]; then
        cp "$BACKUP_DIR/.env" "$APP_DIR/.env"
        chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
        chmod 600 "$APP_DIR/.env"
    fi

    # Restore SSH keys (for private repos)
    if [ -d "$BACKUP_DIR/.ssh" ]; then
        cp -r "$BACKUP_DIR/.ssh" "$APP_DIR/"
        chown -R "$APP_USER:$APP_USER" "$APP_DIR/.ssh"
        chmod 700 "$APP_DIR/.ssh"
        chmod 600 "$APP_DIR/.ssh"/* 2>/dev/null || true
    fi

    rm -rf "$BACKUP_DIR"
    log_info "Configuration restored"
fi

# Ensure proper ownership
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# Install dependencies
log_info "Installing npm dependencies..."
cd "$APP_DIR"
sudo -u "$APP_USER" npm ci --production

# Build TypeScript
log_info "Building TypeScript..."
sudo -u "$APP_USER" npm run build

################################################################################
# 6. Environment Configuration
################################################################################
log_info "Step 6/8: Configuring environment..."

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
BACKEND_URL=http://localhost:3000
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

################################################################################
# 7. Setup Systemd Service
################################################################################
log_info "Step 7/8: Configuring systemd service..."

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
EnvironmentFile=$APP_DIR/.env

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
# 8. Setup Nginx Reverse Proxy
################################################################################
log_info "Step 8/8: Configuring Nginx reverse proxy..."

cat > "/etc/nginx/sites-available/$APP_NAME" << 'EOF'
upstream artorizer_router {
    # If using cluster mode (WORKERS > 1), single backend is fine
    # as OS handles load balancing across workers on same port
    server 127.0.0.1:7000;
    keepalive 64;
}

server {
    listen 80;
    server_name _;  # Update with your domain

    # Increase buffer sizes for large uploads
    client_max_body_size 256M;
    client_body_buffer_size 10M;

    # Timeouts
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;

    # Logging
    access_log /var/log/nginx/artorizer-access.log;
    error_log /var/log/nginx/artorizer-error.log;

    location / {
        proxy_pass http://artorizer_router;
        proxy_http_version 1.1;

        # Headers
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_cache_bypass $http_upgrade;

        # Disable buffering for streaming
        proxy_buffering off;
    }

    # Health check endpoint
    location /health {
        access_log off;
        proxy_pass http://artorizer_router;
    }
}
EOF

# Enable site
ln -sf "/etc/nginx/sites-available/$APP_NAME" "/etc/nginx/sites-enabled/$APP_NAME"

# Remove default site if exists
rm -f /etc/nginx/sites-enabled/default

# Test nginx config
nginx -t

################################################################################
# 9. Configure Firewall
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
# 10. Configure Redis
################################################################################
log_info "Configuring Redis..."

# Ensure Redis is running
systemctl enable redis-server
systemctl start redis-server

################################################################################
# 11. Start Services
################################################################################
log_info "Starting services..."

# Enable and start the application
systemctl enable "$APP_NAME"
systemctl restart "$APP_NAME"

# Restart nginx
systemctl restart nginx

# Wait a moment for service to start
sleep 3

################################################################################
# 12. Verify Deployment
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

# Check nginx status
if systemctl is-active --quiet nginx; then
    log_info "✓ Nginx is running"
else
    log_error "✗ Nginx failed to start"
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
echo "  - Nginx logs:       tail -f /var/log/nginx/artorizer-access.log"
echo ""
echo "⚠️  IMPORTANT NEXT STEPS:"
echo "  1. Edit environment file: nano $ENV_FILE"
echo "  2. Update BACKEND_URL, PROCESSOR_URL, CALLBACK_AUTH_TOKEN"
echo "  3. Update Nginx server_name with your domain"
echo "  4. Setup SSL/TLS with certbot (recommended)"
echo "  5. Restart service: systemctl restart $APP_NAME"
echo ""
echo "🔒 Security Recommendations:"
echo "  - Setup SSL: certbot --nginx -d yourdomain.com"
echo "  - Review firewall: ufw status"
echo "  - Secure Redis: add password in /etc/redis/redis.conf"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
