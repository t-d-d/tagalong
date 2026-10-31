import { describe, expect, it } from "vitest";
import { readRepoFile } from "../test/repo.ts";

// The bridge's own lines reach CloudWatch through the filter in
// images/bridge-start.sh. These checks read the filter's sed and grep
// expressions and run them here, on lines shaped like the bridge's own.
const script = readRepoFile("images/bridge-start.sh");

// sed's s/pattern/replacement/flags, written as a JavaScript replacement.
interface Substitution {
  pattern: RegExp;
  replacement: string;
}

// Each mask is one -e 's/.../.../' line of the mask array. The expressions
// keep to what sed -E and JavaScript read the same way: no slash, no POSIX
// class, no backslash inside brackets, and no & in the replacement.
function readMasks(): Substitution[] {
  const block = /^mask=\(\n([\s\S]*?)^\)$/mu.exec(script)?.[1] ?? "";
  return block
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const match = /^\s+-e 's\/([^/]+)\/([^/]*)\/(g?)'$/u.exec(line);
      if (match === null) throw new Error(`Unread mask line: ${line}`);
      const [, pattern = "", replacement = "", flags = ""] = match;
      if (/\[[^\]]*(\\|\[:)/u.test(pattern))
        throw new Error(
          `Mask reads differently in sed and JavaScript: ${line}`,
        );
      if (/[&$]/u.test(replacement))
        throw new Error(`Mask replacement uses & or $: ${line}`);
      return {
        pattern: new RegExp(pattern, `${flags}u`),
        replacement: replacement.replace(/\\(\d)/gu, "$$$1"),
      };
    });
}

function readKeep(): RegExp {
  const keep = /^keep='([^']+)'$/mu.exec(script)?.[1];
  if (keep === undefined) throw new Error("No keep pattern in the script.");
  return new RegExp(keep, "u");
}

const masks = readMasks();
const keep = readKeep();

function mask(line: string): string {
  return masks.reduce(
    (masked, { pattern, replacement }) => masked.replace(pattern, replacement),
    line,
  );
}

function kept(line: string): boolean {
  return keep.test(line);
}

const number = "447700900123";
const group = "120363000000123456";
const lid = "120363000000987654";

describe("fitness: the bridge's lines carry no number, id or name (logging.md)", () => {
  it("sends everything the bridge writes through the masks, then the keep list", () => {
    expect(script).toMatch(
      /^exec whatsapp-bridge > >\(sed -u -E "\$\{mask\[@\]\}" \| grep --line-buffered -E "\$keep" \|\| true\) 2>&1$/mu,
    );
    expect(script.match(/whatsapp-bridge/gu)).toHaveLength(1);
  });

  it("masks a phone number, a group id, a LID and a JID", () => {
    expect(
      mask(
        `12:00:00.000 [Client INFO] Call incoming: id=ABC type=voice from=${number}@s.whatsapp.net chat=${group}@g.us`,
      ),
    ).toBe(
      "12:00:00.000 [Client INFO] Call incoming: id=ABC type=voice from=<jid> chat=<jid>",
    );
    expect(mask(`Resolved ${number} -> ${lid}:12@lid (LID)`)).toBe(
      "Resolved <number> -> <jid> (LID)",
    );
    expect(
      mask(`Warning: server LID lookup failed for +${number}: timeout`),
    ).toBe("Warning: server LID lookup failed for <number>: timeout");
  });

  it("masks the contact names in the chat-name lines", () => {
    expect(
      mask(
        `12:00:00.000 [Client INFO] Updating chat name from PushName for ${number}@s.whatsapp.net: Ann Example -> Ann`,
      ),
    ).toBe(
      "12:00:00.000 [Client INFO] Updating chat name from PushName for <jid>: <name>",
    );
    expect(mask("12:00:00.000 [Client INFO] Using contact name: Ann")).toBe(
      "12:00:00.000 [Client INFO] Using contact name: <name>",
    );
    expect(
      mask(
        `12:00:00.000 [Client INFO] Using existing chat name for ${group}@g.us: Book club`,
      ),
    ).toBe(
      "12:00:00.000 [Client INFO] Using existing chat name for <jid>: <name>",
    );
  });

  it("keeps the rest of the line, so the bridge's errors still reach the log", () => {
    const line = mask(
      `12:00:00.000 [Client WARN] Failed to mark chat ${group}@g.us read: database is locked`,
    );
    expect(line).toBe(
      "12:00:00.000 [Client WARN] Failed to mark chat <jid> read: database is locked",
    );
    expect(kept(line)).toBe(true);
    expect(kept(mask("12:00:00.000 [Client ERROR] ❌ Stream error: 503"))).toBe(
      true,
    );
    expect(kept("Error sending webhook: connection refused")).toBe(true);
    expect(kept("⚠ Webhook failed with status 500")).toBe(true);
    expect(
      mask(
        `12:00:00.000 [Client WARN] Failed to query local contact name for ${number}@s.whatsapp.net: database is locked`,
      ),
    ).toBe(
      "12:00:00.000 [Client WARN] Failed to query local contact name for <jid>: database is locked",
    );
  });

  it("reads whatsmeow's coloured lines as the bridge writes them", () => {
    const line = mask(
      `12:00:00.000\u001b[33m [Client WARN] Failed to mark chat ${group}@g.us read: database is locked\u001b[0m`,
    );
    expect(line).toBe(
      "12:00:00.000\u001b[33m [Client WARN] Failed to mark chat <jid> read: database is locked\u001b[0m",
    );
    expect(kept(line)).toBe(true);
  });

  it("drops the lines that print a message", () => {
    expect(
      kept(mask(`[2026-10-31 12:00:00] ← ${number}: see you at noon`)),
    ).toBe(false);
    expect(
      kept(
        mask(
          `12:00:00.000 [Client INFO] Stored message: [2026-10-31] ${number} -> ${group}@g.us: see you at noon`,
        ),
      ),
    ).toBe(false);
  });

  it("keeps the bridge's own lines about the connection", () => {
    const own = [
      "12:00:00.000 [Client INFO] Starting WhatsApp client...",
      "12:00:00.000 [Client INFO] Connection attempt 1/3...",
      "12:00:00.000 [Client INFO] ✓ Successfully connected to WhatsApp servers",
      "12:00:00.000 [Client INFO] 🔄 Attempting to reconnect...",
      "12:00:00.000 [Client INFO] ✓ Reconnected successfully",
      "12:00:00.000 [Client INFO] Already connected, skipping reconnection",
      "12:00:00.000\u001b[33m [Client WARN] ⚠️  Device logged out, please scan QR code to log in again\u001b[0m",
      "12:00:00.000\u001b[31m [Client ERROR] ❌ Connection failure: 401\u001b[0m",
      "12:00:00.000 [Client/Socket WARN] Frame websocket read error",
      "12:00:00.000 [Database ERROR] Failed to upgrade database",
      "Starting REST API server on 127.0.0.1:8080...",
      "REST API server error: listen tcp: address already in use",
      "✓ Connected to WhatsApp! Type 'help' for commands.",
      "Disconnecting...",
      "Waiting for QR code scan...",
      "panic: runtime error: index out of range",
    ];
    expect(own.filter((line) => !kept(line))).toEqual([]);
  });

  // The words the keep list matched anywhere in a line before #53.
  const keepWords = [
    "Starting WhatsApp client",
    "Starting REST API server",
    "REST API server error",
    "connected to WhatsApp",
    "Connected to WhatsApp",
    "Device logged out",
    "Disconnected from WhatsApp",
    "Connection failure",
    "Stream error",
    "Stream replaced",
    "Connection attempt",
    "Failed to connect",
    "Failed to establish",
    "Failed to resolve media roots",
    "reconnect",
    "Reconnect",
    "QR code",
    "Disconnecting",
    "panic:",
    "[Client WARN]",
    "[Client ERROR]",
    "Warning: failed to persist",
    "Error sending webhook",
    "⚠ Could not",
  ];

  it.each(keepWords)("drops a message line that contains %s", (word) => {
    expect(
      kept(mask(`[2026-10-31 12:00:00] ← ${number}: before ${word} after`)),
    ).toBe(false);
  });

  it.each(keepWords)("drops a history sync line that contains %s", (word) => {
    expect(
      kept(
        mask(
          `12:00:00.000 [Client INFO] Stored message: [2026-10-31] ${number} -> ${group}@g.us: before ${word} after`,
        ),
      ),
    ).toBe(false);
    expect(
      kept(
        mask(
          `12:00:00.000 [Client INFO] Message content: before ${word} after, Media Type: `,
        ),
      ),
    ).toBe(false);
  });

  it.each(keepWords)(
    "drops a later line of a message that contains %s",
    (word) => {
      expect(kept(mask(`before ${word} after`))).toBe(false);
    },
  );

  it("drops the later lines of a message that runs over several lines", () => {
    expect(kept(mask("Warning: Ann is bringing the cake"))).toBe(false);
    expect(kept(mask("Error: train cancelled, ring me on 07700 900123"))).toBe(
      false,
    );
  });
});
