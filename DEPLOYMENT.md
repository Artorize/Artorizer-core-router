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

### 2. Application Setup
- Creates dedicated `artorizer` user for security
- Clones repository directly to `/opt/artorizer-router/`
- Preserves `.env` configuration file across deployments
- Builds TypeScript to production code
- Installs production dependencies only
- Fresh clone on each deployment ensures clean state

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
BACKEND_URL=http://your-backend-server:3000
PROCESSOR_URL=http://your-processor-server:8000
ROUTER_BASE_URL=http://your-domain.com

# Generate a strong secret token
CALLBACK_AUTH_TOKEN=your-secure-random-token-here
```

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

# Check all related services
sudo systemctl status artorizer-router nginx redis-server

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

### Enable/Disable Auto-start
```bash
# Enable auto-start on boot (default)
sudo systemctl enable artorizer-router

# Disable auto-start
sudo systemctl disable artorizer-router
```

## Monitoring and Logs

### Application Logs
```bash
# Real-time logs (structured JSON in production)
sudo journalctl -u artorizer-router -f

# Last 100 lines
sudo journalctl -u artorizer-router -n 100

# Logs from specific time
sudo journalctl -u artorizer-router --since "1 hour ago"

# Application log files
sudo tail -f /var/log/artorizer/router.log
sudo tail -f /var/log/artorizer/router-error.log
```

### Nginx Logs
```bash
# Access logs
sudo tail -f /var/log/nginx/artorizer-access.log

# Error logs
sudo tail -f /var/log/nginx/artorizer-error.log
```

### System Monitoring
```bash
# CPU and memory usage
htop

# Process status
ps aux | grep node

# Network connections
sudo netstat -tlnp | grep :7000
```

## Updating the Application

### Automated GitHub-Based Update
The deployment script now pulls directly from GitHub, making updates simple:

```bash
# SSH to server and re-run deployment script
ssh user@your-server
sudo ./deploy.sh production

# Your .env configuration is automatically preserved
# Fresh code is cloned from GitHub
# Dependencies are reinstalled
# Application is rebuilt and restarted
```

**What happens during update:**
1. Backs up existing `.env` configuration
2. Cleans `/opt/artorizer-router/` directory
3. Clones fresh code from GitHub
4. Restores `.env` configuration
5. Installs dependencies and rebuilds
6. Restarts service

### Manual Code Update (Alternative)
If you need to deploy from local changes instead of GitHub:

```bash
# 1. Upload to server
scp -r . user@your-server:/tmp/artorizer-router-update

# 2. SSH to server and re-run deployment
ssh user@your-server
cd /tmp/artorizer-router-update
sudo ./deploy.sh production
```

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

### Disk Space Full

**Clean logs:**
```bash
# Rotate and compress old logs
sudo journalctl --vacuum-time=7d
```

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

**3. Enable nginx gzip compression:**
```nginx
# In nginx config
gzip on;
gzip_types application/json;
gzip_min_length 1000;
```

**4. Configure Redis persistence:**
```bash
sudo nano /etc/redis/redis.conf
# Uncomment and configure:
save 900 1
save 300 10
save 60 10000
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

**3. Enable swap:**
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
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

# Bind to localhost only (if on same server)
bind 127.0.0.1

# Update .env file
echo "REDIS_PASSWORD=YOUR_STRONG_PASSWORD" | sudo tee -a /opt/artorizer-router/.env
```

### 3. Regular Updates
```bash
# Create weekly update cron job
sudo crontab -e

# Add this line:
0 2 * * 0 apt-get update && apt-get upgrade -y
```

### 4. Fail2ban (Optional)
```bash
sudo apt-get install -y fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

## Backup and Recovery

### Backup Script
```bash
#!/bin/bash
# Save as /usr/local/bin/backup-artorizer.sh

BACKUP_DIR="/var/backups/artorizer"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

# Backup configuration
tar -czf "$BACKUP_DIR/config-$DATE.tar.gz" \
    /opt/artorizer-router/.env \
    /etc/nginx/sites-available/artorizer-router \
    /etc/systemd/system/artorizer-router.service

# Keep only last 7 backups
cd "$BACKUP_DIR" && ls -t | tail -n +8 | xargs rm -f

echo "Backup completed: $BACKUP_DIR/config-$DATE.tar.gz"
```

### Restore Configuration
```bash
# Extract backup
tar -xzf /var/backups/artorizer/config-YYYYMMDD_HHMMSS.tar.gz -C /

# Reload services
sudo systemctl daemon-reload
sudo systemctl restart artorizer-router nginx
```

## Multi-Server Deployment

For distributed setups with separate backend/processor servers:

### 1. Router Server
```bash
# Deploy router
sudo ./deploy.sh production

# Configure URLs to point to other servers
sudo nano /opt/artorizer-router/.env
BACKEND_URL=http://backend-server:3000
PROCESSOR_URL=http://processor-server:8000
```

### 2. Network Configuration
Ensure servers can communicate:
```bash
# On router server - test connectivity
curl http://backend-server:3000
curl http://processor-server:8000

# Open firewall on backend/processor servers
sudo ufw allow from ROUTER_SERVER_IP to any port 3000
sudo ufw allow from ROUTER_SERVER_IP to any port 8000
```

## Support and Resources

- **Documentation:** See `CLAUDE.md` for architecture details
- **Logs:** Always check logs first when troubleshooting
- **GitHub Issues:** Report bugs and feature requests
- **API Reference:** See backend/processor documentation for integration

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
