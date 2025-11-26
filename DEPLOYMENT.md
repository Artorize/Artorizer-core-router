# Artorizer Core Router - Deployment Guide

## Quick Start

### Prerequisites
- Fresh Debian 12 server with root access
- At least 2GB RAM
- 2+ CPU cores recommended
- 20GB disk space

### One-Command Deployment

```bash
# 1. Upload project to server
scp -r . user@your-server:/tmp/artorizer-router

# 2. SSH to server
ssh user@your-server

# 3. Run deployment script
cd /tmp/artorizer-router
sudo ./deploy.sh production
```

## What the Script Does

The `deploy.sh` script automates the entire deployment process:

### 1. System Setup
- Updates all packages
- Installs Node.js 20 LTS
- Installs system dependencies (build tools, Python, etc.)
- Installs Redis for queue management
- Installs Nginx as reverse proxy
- Configures UFW firewall
- **Note:** PostgreSQL is **NOT** installed by default (only needed if `AUTH_ENABLED=true`). See post-deployment step 1a for manual PostgreSQL setup.

### 2. Application Setup
- Creates dedicated `artorizer` user for security
- Clones repository from GitHub to `/opt/artorizer-router/`
- Preserves `.env` configuration file across deployments
- Builds TypeScript to production code
- Installs production dependencies only

### 3. Service Configuration
- Creates systemd service for auto-start and supervision
- Configures Nginx reverse proxy with:
  - 256MB upload limit
  - Proper headers for proxying
  - Connection keep-alive
  - Health check endpoint
- Sets up automatic restart on failure

### 4. Security Hardening
- Runs application as non-root user
- Configures firewall (SSH, HTTP, HTTPS only)
- Sets file permissions (600 for .env)
- Enables systemd security features

## Post-Deployment Configuration

### 1. Configure Environment Variables

Edit the environment file:
```bash
sudo nano /opt/artorizer-router/.env
```

**Required changes:**
```env
# Update these URLs to match your infrastructure
BACKEND_URL=http://your-backend-server:5001
PROCESSOR_URL=http://your-processor-server:8000
ROUTER_BASE_URL=http://your-domain.com

# Generate a strong secret token
CALLBACK_AUTH_TOKEN=your-secure-random-token-here
```

**Optional - Authentication (Better Auth with OAuth):**

If you want to enable user authentication:

```env
# Enable authentication
AUTH_ENABLED=true

# Generate a secure secret (required if AUTH_ENABLED=true)
BETTER_AUTH_SECRET=$(openssl rand -base64 32)

# Set your router's public URL (required if AUTH_ENABLED=true)
BETTER_AUTH_URL=https://your-domain.com

# Configure allowed frontend origins
ALLOWED_ORIGINS=https://your-frontend-domain.com,http://localhost:8080

# PostgreSQL configuration (required if AUTH_ENABLED=true)
DB_HOST=localhost
DB_PORT=5432
DB_USER=artorizer
DB_PASSWORD=your-secure-db-password
DB_NAME=artorizer_db

# OAuth providers (optional - configure at least one)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
```

**Note:** Authentication is **disabled by default** (`AUTH_ENABLED=false`). Only enable it if you need user management and have PostgreSQL configured. See step 1a below for PostgreSQL setup.

**Optional tuning:**
```env
# Worker processes (default: 4, max: CPU cores)
WORKERS=4

# Upload size limit (default: 256MB)
MAX_FILE_SIZE=268435456

# Processor timeout (default: 30 seconds)
PROCESSOR_TIMEOUT=30000

# Redis configuration
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
```

### 1a. PostgreSQL Setup (Only if AUTH_ENABLED=true)

If you enabled authentication, install and configure PostgreSQL:

**Install PostgreSQL:**
```bash
sudo apt-get update
sudo apt-get install -y postgresql postgresql-contrib
```

**Create database and user:**
```bash
# Switch to postgres user
sudo -u postgres psql

# In psql prompt:
CREATE DATABASE artorizer_db;
CREATE USER artorizer WITH ENCRYPTED PASSWORD 'your-secure-db-password';
GRANT ALL PRIVILEGES ON DATABASE artorizer_db TO artorizer;
\q
```

**Run Better Auth migrations:**
```bash
cd /opt/artorizer-router
sudo -u artorizer npx better-auth migrate
```

This creates the necessary tables: `users`, `accounts`, `sessions`.

**Configure OAuth providers (at least one required):**

For **Google OAuth**:
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project and enable OAuth
3. Add authorized redirect URI: `https://your-domain.com/auth/callback/google`
4. Copy Client ID and Secret to `.env`

For **GitHub OAuth**:
1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Create a new OAuth App
3. Set callback URL: `https://your-domain.com/auth/callback/github`
4. Copy Client ID and generate Client Secret, add to `.env`

### 2. Configure Domain and SSL

**Update Nginx configuration:**
```bash
sudo nano /etc/nginx/sites-available/artorizer-router
```

Replace `server_name _;` with your domain:
```nginx
server_name your-domain.com www.your-domain.com;
```

**Install SSL certificate (recommended):**
```bash
# Install certbot
sudo apt-get install -y certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d your-domain.com -d www.your-domain.com

# Auto-renewal is configured automatically
```

### 3. Restart Services

After configuration changes:
```bash
sudo systemctl restart artorizer-router
sudo systemctl restart nginx
```

## Service Management

### Status Checks
```bash
# Check service status
sudo systemctl status artorizer-router

# View real-time logs
sudo journalctl -u artorizer-router -f

# View application logs
sudo tail -f /var/log/artorizer/router.log
```

### Start/Stop/Restart
```bash
# Start service
sudo systemctl start artorizer-router

# Stop service
sudo systemctl stop artorizer-router

# Restart service
sudo systemctl restart artorizer-router

# Reload nginx after config changes
sudo nginx -t && sudo systemctl reload nginx
```

## Updating the Application

The deployment script pulls directly from GitHub, making updates simple:

```bash
# SSH to server and re-run deployment script
ssh user@your-server
cd /tmp/artorizer-router
sudo ./deploy.sh production

# Your .env configuration is automatically preserved
# Fresh code is cloned from GitHub
# Dependencies are reinstalled
# Application is rebuilt and restarted
```

**What happens during update:**
1. Backs up existing `.env` configuration
2. Removes `/opt/artorizer-router/` directory
3. Clones fresh code from GitHub
4. Restores `.env` configuration
5. Installs dependencies and rebuilds
6. Restarts service

## Troubleshooting

### Service Won't Start

**Check logs:**
```bash
sudo journalctl -u artorizer-router -n 50 --no-pager
```

**Common issues:**
- Missing environment variables → check `/opt/artorizer-router/.env`
- Port already in use → check `netstat -tlnp | grep :7000`
- Redis not running → `sudo systemctl start redis-server`
- Permission errors → check ownership with `ls -la /opt/artorizer-router`

### High Memory Usage

**Adjust worker count:**
```bash
sudo nano /opt/artorizer-router/.env
# Set WORKERS=2 (or 1 for minimal memory)
sudo systemctl restart artorizer-router
```

### Connection Timeouts

**Increase timeouts:**
```bash
# In .env file
PROCESSOR_TIMEOUT=60000  # 60 seconds

# In nginx config (/etc/nginx/sites-available/artorizer-router)
proxy_read_timeout 120s;
```

### 502 Bad Gateway

**Possible causes:**
1. Application not running → `sudo systemctl status artorizer-router`
2. Wrong port in nginx config → check upstream definition
3. Processor service down → check `PROCESSOR_URL` and processor logs

## Performance Tuning

### For High-Traffic Deployments

**1. Increase worker processes:**
```env
# In .env - set to number of CPU cores
WORKERS=8
```

**2. Increase file descriptor limits:**
```bash
sudo nano /etc/systemd/system/artorizer-router.service
# Add under [Service]:
LimitNOFILE=100000
```

### For Low-Memory Servers

**1. Reduce workers:**
```env
WORKERS=1
```

**2. Limit max file size:**
```env
MAX_FILE_SIZE=52428800  # 50MB
```

## Security Best Practices

### 1. Firewall Configuration
```bash
# Review firewall rules
sudo ufw status verbose

# Allow only specific IPs (optional)
sudo ufw allow from YOUR_IP to any port 22
sudo ufw delete allow 22/tcp
```

### 2. Secure Redis
```bash
sudo nano /etc/redis/redis.conf

# Set password
requirepass YOUR_STRONG_PASSWORD

# Bind to localhost only
bind 127.0.0.1

# Update .env file
echo "REDIS_PASSWORD=YOUR_STRONG_PASSWORD" | sudo tee -a /opt/artorizer-router/.env
```

## Quick Reference

| Task | Command |
|------|---------|
| View logs | `sudo journalctl -u artorizer-router -f` |
| Restart service | `sudo systemctl restart artorizer-router` |
| Check status | `sudo systemctl status artorizer-router` |
| Edit config | `sudo nano /opt/artorizer-router/.env` |
| Test nginx | `sudo nginx -t` |
| View processes | `ps aux \| grep node` |
| Check ports | `sudo netstat -tlnp` |
| Disk usage | `df -h` |
| Memory usage | `free -h` |
