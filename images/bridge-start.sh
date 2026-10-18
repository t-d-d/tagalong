#!/bin/bash
# The bridge container's entrypoint (one-device.md). The task never pairs a
# device: until scripts/move-device.ts has put one in the store, it waits.
#
# The bridge prints every message it sees, with its sender, so only its lines
# about the connection reach the log (logging.md). It runs as PID 1 through
# exec, so it gets the task's SIGTERM itself.
set -euo pipefail

mkdir -p /data/bridge/store /data/bridge/outbox
cd /data/bridge

if [ ! -s store/whatsapp.db ]; then
  echo "bridge: no device in /data/bridge/store yet; waiting for one (docs/setup.md)"
  while [ ! -s store/whatsapp.db ]; do
    sleep 10
  done
fi
echo "bridge: starting"

keep='Starting WhatsApp client|Starting REST API server|REST API server error|connected to WhatsApp|Connected to WhatsApp|Device logged out|Disconnected from WhatsApp|Connection failure|Stream error|Stream replaced|Connection attempt|Failed to connect|Failed to establish|Failed to resolve media roots|reconnect|Reconnect|QR code|Disconnecting|^panic:'

exec whatsapp-bridge > >(grep --line-buffered -E "$keep" || true) 2>&1
