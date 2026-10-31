// The bridge's two databases, read only (one-device.md): messages.db for
// chats and messages, whatsapp.db for the device, contacts and LID mapping.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";

export interface MessageRow {
  id: string;
  chatJid: string;
  sender: string;
  content: string;
  timestamp: string;
  isFromMe: boolean;
  mediaType: string;
}

const messageSchema = z
  .object({
    id: z.string(),
    chat_jid: z.string(),
    sender: z.string().nullable(),
    content: z.string().nullable(),
    timestamp: z.string(),
    is_from_me: z.union([z.number(), z.boolean(), z.null()]),
    media_type: z.string().nullable(),
  })
  .transform((row): MessageRow => ({
    id: row.id,
    chatJid: row.chat_jid,
    sender: row.sender ?? "",
    content: row.content ?? "",
    timestamp: row.timestamp,
    isFromMe: row.is_from_me === true || row.is_from_me === 1,
    mediaType: row.media_type ?? "",
  }));

const deviceSchema = z.object({ jid: z.string(), lid: z.string().nullable() });
const idSchema = z.object({ id: z.string() });
const contactSchema = z.object({
  their_jid: z.string(),
  first_name: z.string().nullable(),
  full_name: z.string().nullable(),
  push_name: z.string().nullable(),
});
const lidSchema = z.object({ lid: z.string(), pn: z.string() });
const chatSchema = z.object({
  jid: z.string(),
  name: z.string().nullable(),
  last_message_time: z.string().nullable(),
});

const COLUMNS =
  "id, chat_jid, sender, content, timestamp, is_from_me, media_type";

/** When a stored timestamp ("2026-10-18 17:55:26+01:00") was, in ms. */
export const timeOf = (timestamp: string): number =>
  Date.parse(timestamp.replace(" ", "T"));

export class WhatsAppStore {
  readonly #dir: string;
  #messages: DatabaseSync | undefined;
  #device: DatabaseSync | undefined;

  constructor(dir: string) {
    this.#dir = dir;
  }

  /** Whether the bridge has a paired device here yet. */
  present(): boolean {
    return (
      existsSync(join(this.#dir, "whatsapp.db")) &&
      existsSync(join(this.#dir, "messages.db"))
    );
  }

  get dir(): string {
    return this.#dir;
  }

  #db(name: "messages" | "device"): DatabaseSync {
    if (name === "messages") {
      this.#messages ??= new DatabaseSync(join(this.#dir, "messages.db"), {
        readOnly: true,
      });
      return this.#messages;
    }
    this.#device ??= new DatabaseSync(join(this.#dir, "whatsapp.db"), {
      readOnly: true,
    });
    return this.#device;
  }

  /** The paired account's own phone and LID JIDs. */
  device(): { jid: string; lid: string | null } | undefined {
    const row = this.#db("device")
      .prepare("SELECT jid, lid FROM whatsmeow_device LIMIT 1")
      .get();
    return row === undefined ? undefined : deviceSchema.parse(row);
  }

  contacts(): { jid: string; name: string }[] {
    return this.#db("device")
      .prepare(
        "SELECT their_jid, first_name, full_name, push_name FROM whatsmeow_contacts",
      )
      .all()
      .map((row) => contactSchema.parse(row))
      .map((row) => ({
        jid: row.their_jid,
        name: (row.full_name || row.push_name || row.first_name || "").trim(),
      }))
      .filter((row) => row.name !== "");
  }

  lidMap(): { lid: string; pn: string }[] {
    return this.#db("device")
      .prepare("SELECT lid, pn FROM whatsmeow_lid_map")
      .all()
      .map((row) => lidSchema.parse(row));
  }

  chatName(jid: string): string | undefined {
    const row = this.#db("messages")
      .prepare("SELECT jid, name, last_message_time FROM chats WHERE jid = ?")
      .get(jid);
    return row === undefined
      ? undefined
      : (chatSchema.parse(row).name ?? undefined);
  }

  groupChats(): { jid: string; name: string }[] {
    return this.#db("messages")
      .prepare(
        "SELECT jid, name, last_message_time FROM chats WHERE jid LIKE '%@g.us' ORDER BY datetime(last_message_time) DESC",
      )
      .all()
      .map((row) => chatSchema.parse(row))
      .map((row) => ({ jid: row.jid, name: row.name ?? "" }));
  }

  message(chat: string, id: string | undefined): MessageRow | undefined {
    if (id === undefined || id === "") return undefined;
    const row = this.#db("messages")
      .prepare(`SELECT ${COLUMNS} FROM messages WHERE chat_jid = ? AND id = ?`)
      .get(chat, id);
    return row === undefined ? undefined : messageSchema.parse(row);
  }

  /** The id of the latest message the device sent in `chat` with exactly `text`. */
  sentId(chat: string, text: string): string | undefined {
    const row = this.#db("messages")
      .prepare(
        "SELECT id FROM messages WHERE chat_jid = ? AND is_from_me = 1 AND content = ? ORDER BY datetime(timestamp) DESC LIMIT 1",
      )
      .get(chat, text);
    return row === undefined ? undefined : idSchema.parse(row).id;
  }

  /** The newest message the device sent in `chat` that reads as `claude`'s answer (prompts.ts). */
  latestAnswer(chat: string, claude: string): MessageRow | undefined {
    const row = this.#db("messages")
      .prepare(
        `SELECT ${COLUMNS} FROM messages
         WHERE chat_jid = ? AND is_from_me = 1 AND deleted_at IS NULL AND content LIKE ?
         ORDER BY datetime(timestamp) DESC, rowid DESC LIMIT 1`,
      )
      .get(chat, `*${claude}:*%`);
    return row === undefined ? undefined : messageSchema.parse(row);
  }

  /** The chat's messages sent after `after` (ms), oldest first, at most `limit` of the latest; and how many more there were. */
  since(
    chat: string,
    after: number,
    limit: number,
  ): { rows: MessageRow[]; left: number } {
    const rows = this.recent(chat, 1000).filter(
      (row) => timeOf(row.timestamp) > after,
    );
    return {
      rows: rows.slice(-limit),
      left: Math.max(0, rows.length - limit),
    };
  }

  /** The chat's latest messages, oldest first, reactions and deleted ones left out. */
  recent(chat: string, limit: number): MessageRow[] {
    return this.#db("messages")
      .prepare(
        `SELECT ${COLUMNS} FROM messages
         WHERE chat_jid = ? AND deleted_at IS NULL AND COALESCE(media_type, '') <> 'reaction'
         ORDER BY datetime(timestamp) DESC LIMIT ?`,
      )
      .all(chat, limit)
      .map((row) => messageSchema.parse(row))
      .reverse();
  }
}
