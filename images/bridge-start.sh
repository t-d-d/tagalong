#!/bin/bash
# The bridge container's entrypoint (one-device.md). The task never pairs a
# device: until scripts/move-device.ts has put one in the store, it waits.
#
# Every line the bridge writes passes through the filter below before it
# reaches stdout and CloudWatch (logging.md). The masks replace JIDs, phone
# numbers, group ids, LIDs and the contact names in its chat-name lines, and
# keep the rest of each line. The bridge prints every message it sees, with
# its sender, so only its lines about the connection, its warnings and its
# errors are kept. It runs as PID 1 through exec, so it gets the task's
# SIGTERM itself.
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

keep='Starting WhatsApp client|Starting REST API server|REST API server error|connected to WhatsApp|Connected to WhatsApp|Device logged out|Disconnected from WhatsApp|Connection failure|Stream error|Stream replaced|Connection attempt|Failed to connect|Failed to establish|Failed to resolve media roots|reconnect|Reconnect|QR code|Disconnecting|^panic:| (WARN|ERROR)\]|^(Warning|Error)'

# Applied in order: JIDs first, then any digit run long enough to be a number
# or an id, then everything after a chat, group or contact name.
mask=(
  -e 's/[A-Za-z0-9._:+-]+@[a-z.]*[a-z]/<jid>/g'
  -e 's/\+?[0-9]{7,}/<number>/g'
  -e 's/( name( from PushName)?( for [^ ]+)?: ).*/\1<name>/'
)

exec whatsapp-bridge > >(sed -u -E "${mask[@]}" | grep --line-buffered -E "$keep" || true) 2>&1
