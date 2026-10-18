// Photos and files people send, passed to a session as short-lived links
// (attachments.md). Only from people who may use the group, only recent ones.
import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { allowed } from "./access.ts";
import type { Aws } from "./aws.ts";
import type { Bridge } from "./bridge.ts";
import type { Config, Group } from "./groups.ts";
import { errorFields, log } from "./log.ts";
import type { People } from "./people.ts";
import { type MessageRow, type WhatsAppStore, timeOf } from "./store.ts";

export const LIMITS = {
  bytes: 25 * 1024 * 1024,
  files: 5,
  windowMs: 10 * 60_000,
  linkSeconds: 3600,
} as const;

const MEDIA = new Set(["image", "video", "audio", "document", "sticker"]);

export interface Attachment {
  name: string;
  type: string;
  bytes: number;
  url: string;
}

export interface Pick {
  config: Config;
  group: Group;
  people: People;
  store: WhatsAppStore;
  chat: string;
  messageId: string | undefined;
  quotedMessageId: string | undefined;
  sent: ReadonlySet<string>;
  now: number;
}

/**
 * Which media a request carries: the message itself, the one it replies to,
 * and anything a member sent in the last ten minutes, not yet given to a session.
 */
export function pickMedia(pick: Pick): MessageRow[] {
  const ok = (row: MessageRow | undefined): row is MessageRow =>
    row !== undefined &&
    MEDIA.has(row.mediaType) &&
    !row.isFromMe &&
    allowed(pick.config, pick.group, pick.people, row.sender);
  const own = pick.store.message(pick.chat, pick.messageId);
  const quoted = pick.store.message(pick.chat, pick.quotedMessageId);
  const recent = pick.store
    .recent(pick.chat, 30)
    .filter(
      (row) =>
        pick.now - timeOf(row.timestamp) <= LIMITS.windowMs &&
        !pick.sent.has(row.id),
    );
  const rows = [quoted, ...recent, own].filter(ok);
  const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
  return unique.slice(-LIMITS.files);
}

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
  ".zip": "application/zip",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export const typeOf = (name: string): string =>
  TYPES[extname(name).toLowerCase()] ?? "application/octet-stream";

/** A file name safe in a key and a shell: letters, digits, dot, dash and underscore. */
export const safeName = (name: string): string =>
  name
    .replace(/[^\w.-]+/gu, "_")
    .replace(/^\.+/u, "")
    .slice(-80) || "file";

export interface Share {
  bridge: Bridge;
  aws: Aws;
  bucket: string;
  chat: string;
}

/** Upload each to the bucket and link it. A file that cannot be passed on is skipped and logged. */
export async function shareMedia(
  rows: MessageRow[],
  share: Share,
): Promise<Attachment[]> {
  const shared: Attachment[] = [];
  for (const row of rows) {
    try {
      const file = await share.bridge.download(share.chat, row.id);
      const bytes = statSync(file.path).size;
      if (bytes > LIMITS.bytes) {
        log.info("attachment-skipped", { why: "too-large", bytes });
        continue;
      }
      const name = safeName(file.filename);
      const key = `attachments/${randomUUID()}/${name}`;
      await share.aws.putObject(
        share.bucket,
        key,
        readFileSync(file.path),
        typeOf(name),
      );
      shared.push({
        name,
        type: typeOf(name),
        bytes,
        url: await share.aws.presign(share.bucket, key, LIMITS.linkSeconds),
      });
    } catch (error) {
      log.warn("attachment-skipped", { why: "failed", ...errorFields(error) });
    }
  }
  if (shared.length > 0)
    log.info("attachments-sent", {
      count: shared.length,
      bytes: shared.reduce((sum, file) => sum + file.bytes, 0),
    });
  return shared;
}
