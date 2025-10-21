#!/bin/bash
################################################################################
# Quick Fix: Upgrade Node.js to version 20 on Debian server
################################################################################

set -e

echo "[INFO] Upgrading Node.js to version 20..."

# Remove old NodeSource repository
rm -f /etc/apt/sources.list.d/nodesource.list

# Add NodeSource repository for Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -

# Install/upgrade Node.js
apt-get install -y nodejs

# Verify version
node_version=$(node --version)
echo "[INFO] Node.js upgraded to: $node_version"

# Verify it's at least v18
major_version=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$major_version" -lt 18 ]; then
    echo "[ERROR] Node.js version is still too old: v$major_version"
    exit 1
fi

echo "[SUCCESS] Node.js version is compatible (v$major_version >= v18)"
echo ""
echo "Next steps:"
echo "1. Re-run the deployment script: sudo ./deploy.sh production"
echo "2. Or restart the service: sudo systemctl restart artoize-router"
