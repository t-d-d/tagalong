// A bridge store in a temporary folder: messages.db and whatsapp.db with the
// tables and columns the bridge writes (one-device.md), for the int tier.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Fictional numbers only (no-values.static.ts): Ofcom keeps 07700 900xxx for drama.
export const OWNER = "447700900001";
export const MEMBER = "447700900002";
export const STRANGER = "447700900003";
export const CLAUDE = "447700900100";
export const CLAUDE_LID = "120363000000100";
export const OWNER_LID = "12036300000001";
export const GROUP = "120363000000000001@g.us";
export const OTHER_GROUP = "120363000000000002@g.us";

/** A stored timestamp the way the bridge writes one. */
export const stamp = (ms: number): string =>
  new Date(ms).toISOString().replace("T", " ").replace("Z", "+00:00");

export interface Row {
  id: string;
  chat?: string;
  sender: string;
  content: string;
  at: number;
  fromMe?: boolean;
  mediaType?: string;
  /** The media's length in bytes, as WhatsApp gave it. */
  fileLength?: number;
}

export class BridgeDb {
  readonly dir: string;
  readonly store: string;
  readonly #messages: DatabaseSync;
  readonly #device: DatabaseSync;

  constructor(dir = mkdtempSync(join(tmpdir(), "tagalong-store-"))) {
    this.dir = dir;
    this.store = join(dir, "store");
    mkdirSync(this.store, { recursive: true });
    this.#messages = new DatabaseSync(join(this.store, "messages.db"));
    this.#messages.exec(`
      CREATE TABLE chats (jid TEXT PRIMARY KEY, name TEXT, last_message_time TIMESTAMP,
        ephemeral_expiration INTEGER NOT NULL DEFAULT 0, ephemeral_setting_timestamp INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE messages (id TEXT, chat_jid TEXT, sender TEXT, content TEXT, timestamp TIMESTAMP,
        is_from_me BOOLEAN, media_type TEXT, filename TEXT, url TEXT, media_key BLOB, file_sha256 BLOB,
        file_enc_sha256 BLOB, file_length INTEGER, deleted_at TIMESTAMP, PRIMARY KEY (id, chat_jid));`);
    this.#device = new DatabaseSync(join(this.store, "whatsapp.db"));
    this.#device.exec(`
      CREATE TABLE whatsmeow_device (jid TEXT PRIMARY KEY, lid TEXT, registration_id INTEGER);
      CREATE TABLE whatsmeow_contacts (our_jid TEXT, their_jid TEXT, first_name TEXT, full_name TEXT,
        push_name TEXT, business_name TEXT, PRIMARY KEY (our_jid, their_jid));
      CREATE TABLE whatsmeow_lid_map (lid TEXT PRIMARY KEY, pn TEXT UNIQUE NOT NULL);`);
    writeFileSync(
      join(this.store, ".bridge-token"),
      "bridge-token-for-tests\n",
    );
  }

  device(
    jid = `${CLAUDE}:7@s.whatsapp.net`,
    lid = `${CLAUDE_LID}:7@lid`,
  ): this {
    this.#device
      .prepare(
        "INSERT INTO whatsmeow_device (jid, lid, registration_id) VALUES (?, ?, 1)",
      )
      .run(jid, lid);
    return this;
  }

  contact(number: string, fullName: string): this {
    this.#device
      .prepare(
        "INSERT INTO whatsmeow_contacts (our_jid, their_jid, full_name) VALUES (?, ?, ?)",
      )
      .run(`${CLAUDE}@s.whatsapp.net`, `${number}@s.whatsapp.net`, fullName);
    return this;
  }

  lid(lid: string, number: string): this {
    this.#device
      .prepare("INSERT INTO whatsmeow_lid_map (lid, pn) VALUES (?, ?)")
      .run(lid, number);
    return this;
  }

  chat(jid: string, name: string, at = 0): this {
    this.#messages
      .prepare(
        "INSERT OR REPLACE INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)",
      )
      .run(jid, name, stamp(at));
    return this;
  }

  message(row: Row): this {
    this.#messages
      .prepare(
        "INSERT INTO messages (id, chat_jid, sender, content, timestamp, is_from_me, media_type, file_length) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        row.id,
        row.chat ?? GROUP,
        row.sender,
        row.content,
        stamp(row.at),
        row.fromMe === true ? 1 : 0,
        row.mediaType ?? "",
        row.fileLength ?? null,
      );
    return this;
  }

  deleteMessage(id: string, at: number): this {
    this.#messages
      .prepare("UPDATE messages SET deleted_at = ? WHERE id = ?")
      .run(stamp(at), id);
    return this;
  }

  close(): void {
    this.#messages.close();
    this.#device.close();
  }
}

/** The usual cast: Claude's device, the owner, a member and a stranger, in one set-up group. */
export function standardDb(now: number): BridgeDb {
  return new BridgeDb()
    .device()
    .contact(OWNER, "Thomas Example")
    .contact(MEMBER, "Ollie Example")
    .contact(STRANGER, "Sam Stranger")
    .lid(`${OWNER_LID}@lid`, `${OWNER}@s.whatsapp.net`)
    .chat(GROUP, "Side projects", now)
    .chat(OTHER_GROUP, "Family", now);
}
