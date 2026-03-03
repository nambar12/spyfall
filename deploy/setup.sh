#!/usr/bin/env bash
# EC2 first-time setup for SpyFall on Ubuntu 22.04 LTS.
# Run as the ubuntu user after copying the project to ~/spyfall.
#
# Usage:
#   scp -r /path/to/spyfall ubuntu@<IP>:~/spyfall
#   ssh ubuntu@<IP> "bash ~/spyfall/deploy/setup.sh"

set -euo pipefail

APP_DIR="$HOME/spyfall"

echo "==> Installing Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "==> Installing app dependencies and building frontend..."
cd "$APP_DIR"
npm install
npm run build   # builds frontend/dist/ which Express will serve

echo "==> Installing systemd service..."
sudo cp "$APP_DIR/deploy/spyfall.service" /etc/systemd/system/spyfall.service
sudo systemctl daemon-reload
sudo systemctl enable spyfall
sudo systemctl start spyfall

echo "==> Granting shutdown permission (for idle auto-shutdown)..."
echo "ubuntu ALL=(ALL) NOPASSWD: /sbin/shutdown" | sudo tee /etc/sudoers.d/spyfall-shutdown
sudo chmod 0440 /etc/sudoers.d/spyfall-shutdown

echo ""
echo "Done! Service status:"
sudo systemctl status spyfall --no-pager

echo ""
echo "Useful commands:"
echo "  sudo journalctl -fu spyfall        # live logs"
echo "  sudo systemctl restart spyfall     # restart after code update"
