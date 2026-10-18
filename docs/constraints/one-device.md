# One device
Relevance: The bridge, its store, pairing, moving the device, or anything that reads the bridge's databases: images/bridge.Dockerfile, images/bridge-start.sh, service/src/store.ts, service/src/seed.ts, scripts/move-device.ts, the task's deployment settings
Decision: One linked WhatsApp device, run by one bridge at a time; it is paired on a laptop, moved to the volume once, and read only by tagalong.

Why: Two bridges on one device fight over its keys and WhatsApp logs
the device out. Pairing needs a QR code shown to a phone, which a task
in the cloud cannot show well.

## Rules

- The bridge is verygoodplugins/whatsapp-mcp's Go bridge, pinned by
  commit. It keeps the device in store/whatsapp.db and the chats in
  store/messages.db, under /data/bridge.
- The bridge in the task does not start until store/whatsapp.db is
  there. It never shows a QR code.
- The device is paired on a laptop. scripts/move-device.ts uploads it,
  with groups.json and state.json, to the bucket. The task unpacks it
  when it has no device, keeps a groups.json or state.json it already
  has, and deletes the upload.
- The laptop's bridge is stopped before the device is moved, and never
  started with that store again.
- tagalong opens the databases read only, through
  service/src/store.ts. It talks to the bridge through its REST API on
  127.0.0.1, with the bridge's token from store/.bridge-token.
- The webhook carries the bridge's token. Anything without it is
  refused unread.

## Do not

- Run two tasks, or a laptop bridge beside the task, with one store.
- Write to the bridge's databases.
- Copy the store anywhere else: it is the device's login.

History: Set when the repo was made, October 2026.
