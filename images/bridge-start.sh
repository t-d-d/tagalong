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

# Every entry is tied to the start of a line, so a word in the middle of a
# message cannot match it. A later line of a message still starts a line, and
# is kept if it opens like one of these. whatsmeow's lines start with a time,
# a colour code and a [<module> <LEVEL>] tag: every WARN and ERROR line is
# kept, and only the INFO lines about the connection. The bridge's other lines
# are matched by their exact opening.
keep='^[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}[^ ]* \[[A-Za-z/]+ ((WARN|ERROR)\] |INFO\] (Starting WhatsApp client|Connection attempt|✓ Successfully connected to WhatsApp|🔄 Attempting to reconnect|✓ Reconnected successfully|Already connected, skipping reconnection|Got [0-9]+ code, reconnecting|Got [^,]+ (stream error|connect failure), refreshing CAT before reconnecting))|^(Starting REST API server|REST API server error|✓ Connected to WhatsApp|Disconnecting\.\.\.$|Scan this QR code|QR code refreshed|Waiting for QR code scan|panic:|Warning: (could not open whatsmeow database|LID cache lookup failed|server LID lookup failed|skipping unparseable mention|upload path does not match|failed to store outbound|failed to persist|could not resolve LID chat|OpusHead not found|No valid granule)|Error (marshaling|building|sending) webhook|⚠ (Webhook failed|Could not|Media file too large))'

# Applied in order: JIDs first, then any digit run long enough to be a number
# or an id, then everything after the name in a chat-name line.
mask=(
  -e 's/[A-Za-z0-9._:+-]+@[a-z.]*[a-z]/<jid>/g'
  -e 's/\+?[0-9]{7,}/<number>/g'
  -e 's/((Using|Updating) [a-z ]*name( from PushName)?( for [^ ]+)?: ).*/\1<name>/'
)

exec whatsapp-bridge > >(sed -u -E "${mask[@]}" | grep --line-buffered -E "$keep" || true) 2>&1
