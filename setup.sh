#!/bin/bash
# Crittix Panel Setup Script
# Run this on your VPS after SSH login

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  💀 CRITTIX PANEL SETUP"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Create panel directory
mkdir -p ~/crittix-panel
cd ~/crittix-panel

echo "[1/4] Downloading panel files..."
curl -sL "https://raw.githubusercontent.com/Heis-Devine/crittix-panel/main/server.js" -o server.js 2>/dev/null || echo "Will use uploaded file"

echo "[2/4] Installing panel dependencies..."
npm install express socket.io multer express-session adm-zip

echo "[3/4] Downloading cloudflared..."
wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O cloudflared
chmod +x cloudflared

echo "[4/4] Starting panel + tunnel..."
node server.js &
PANEL_PID=$!
sleep 2

echo ""
echo "Starting Cloudflare tunnel..."
./cloudflared tunnel --url http://localhost:3000 &
TUNNEL_PID=$!

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Panel running! (PID: $PANEL_PID)"
echo "🔗 Tunnel URL will appear above ↑"
echo "🔑 Password: R!v3r\$T0rm_92!XqZ"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

wait
