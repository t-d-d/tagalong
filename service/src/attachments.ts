// Photos and files people send, passed to a session as short-lived links
// (attachments.md). From anyone in the chat, only recent ones.
import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import type { Aws } from "./aws.ts";
import type { Bridge } from "./bridge.ts";
import { errorFields, log } from "./log.ts";
import { type MessageRow, type WhatsAppStore, timeOf } from "./store.ts";

export const LIMITS = {
  bytes: 25 * 1024 * 1024,
  files: 5,
  windowMs: 10 * 60_000,
  linkSeconds: 3600,
  /** How often to ask the bridge for a file it is still writing, and how long to wait between. */
  wholeTries: 10,
  wholeWaitMs: 200,
} as const;

const MEDIA = new Set(["image", "video", "audio", "document", "sticker"]);

/** Media anyone in the chat sent, not the device's own. */
const passable = (row: MessageRow) => MEDIA.has(row.mediaType) && !row.isFromMe;

export interface Attachment {
  name: string;
  type: string;
  bytes: number;
  url: string;
  /** A voice note's words, by speech recognition. */
  transcript?: string;
}

export interface Pick {
  store: {
    message: WhatsAppStore["message"];
    recent: WhatsAppStore["recent"];
  };
  chat: string;
  messageId: string | undefined;
  quotedMessageId: string | undefined;
  /** Media already given to this Claude. */
  sent: { has(id: string): boolean };
  now: number;
}

/**
 * Which media a request carries: the message itself, the one it replies to,
 * and anything anyone sent in the last ten minutes, not yet given to the Claude.
 */
export function pickMedia(pick: Pick): MessageRow[] {
  const ok = (row: MessageRow | undefined): row is MessageRow =>
    row !== undefined && passable(row);
  const own = pick.store.message(pick.chat, pick.messageId);
  const quoted = pick.store.message(pick.chat, pick.quotedMessageId);
  const recent = pick.store
    .recent(pick.chat, 30)
    .filter(
      (row) =>
        pick.now - timeOf(row.timestamp) <= LIMITS.windowMs &&
        !pick.sent.has(row.id),
    );
  // The request's own media and what it replies to always go, so others'
  // files cannot crowd them out; the latest of the rest fill what is left.
  const kept = [quoted, own].filter(ok);
  const keptIds = new Set(kept.map((row) => row.id));
  const others = recent.filter((row) => ok(row) && !keptIds.has(row.id));
  const rest = others.slice(
    Math.max(0, others.length - (LIMITS.files - kept.length)),
  );
  const chosen = new Set([...kept, ...rest].map((row) => row.id));
  const rows = [quoted, ...recent, own].filter(
    (row): row is MessageRow => row !== undefined && chosen.has(row.id),
  );
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

/**
 * Which media an interjecting delivery carries: what anyone sent in `rows`,
 * the messages since it last heard, not yet given to it. The latest five, as
 * for a request.
 */
export function heardMedia(
  rows: MessageRow[],
  heard: {
    /** Media already given to this Claude. */
    sent: { has(id: string): boolean };
  },
): MessageRow[] {
  return rows
    .filter((row) => passable(row) && !heard.sent.has(row.id))
    .slice(-LIMITS.files);
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

/** A voice note's transcript, or undefined when it cannot be had: the link still goes. */
async function transcribed(
  share: Share,
  key: string,
): Promise<string | undefined> {
  const started = Date.now();
  try {
    const text = await share.aws.transcribe(share.bucket, key);
    log.info("attachment-transcribed", {
      ms: Date.now() - started,
      length: text.length,
    });
    return text === "" ? undefined : text;
  } catch (error) {
    log.warn("attachment-untranscribed", errorFields(error));
    return undefined;
  }
}

/**
 * The file's bytes once the bridge has finished writing it. The bridge
 * writes a download in place, and hands back a file that exists as whole,
 * so a file whose size is not the length WhatsApp gave is asked for again.
 * Undefined when it never comes whole. With no length to check, the bytes
 * read; the bridge cannot download a file without one.
 */
async function wholeFile(
  share: Share,
  row: MessageRow,
): Promise<
  { filename: string; body: Buffer } | { tooLarge: number } | undefined
> {
  const { fileLength } = row;
  if (fileLength !== undefined && fileLength > LIMITS.bytes)
    return { tooLarge: fileLength };
  for (let tries = 1; ; tries += 1) {
    const file = await share.bridge.download(share.chat, row.id);
    const size = statSync(file.path).size;
    if (size > LIMITS.bytes) return { tooLarge: size };
    if (fileLength === undefined || size === fileLength) {
      // Checked again on the bytes read: a second download can truncate it between.
      const body = readFileSync(file.path);
      if (body.length > LIMITS.bytes) return { tooLarge: body.length };
      if (fileLength === undefined || body.length === fileLength)
        return { filename: file.filename, body };
    }
    if (tries >= LIMITS.wholeTries) return undefined;
    await new Promise((done) => setTimeout(done, LIMITS.wholeWaitMs));
  }
}

/** What shareMedia made of the rows it was given. */
export interface Shared {
  files: Attachment[];
  /** The ids of the rows passed on as `files`. */
  passed: string[];
  /** The ids of the rows too large ever to pass on. */
  tooLarge: string[];
}

/**
 * Upload each to the bucket and link it. A file that cannot be passed on is
 * skipped and logged; one the bridge never hands over whole, or whose upload
 * fails, is in neither `passed` nor `tooLarge`, so it can be tried again.
 */
export async function shareMedia(
  rows: MessageRow[],
  share: Share,
): Promise<Shared> {
  const shared: Attachment[] = [];
  const passed: string[] = [];
  const tooLarge: string[] = [];
  for (const row of rows) {
    try {
      const file = await wholeFile(share, row);
      if (file === undefined) {
        log.warn("attachment-skipped", { why: "unfinished" });
        continue;
      }
      if ("tooLarge" in file) {
        log.info("attachment-skipped", {
          why: "too-large",
          bytes: file.tooLarge,
        });
        tooLarge.push(row.id);
        continue;
      }
      const bytes = file.body.length;
      const name = safeName(file.filename);
      const key = `attachments/${randomUUID()}/${name}`;
      await share.aws.putObject(share.bucket, key, file.body, typeOf(name));
      const transcript =
        row.mediaType === "audio" ? await transcribed(share, key) : undefined;
      shared.push({
        name,
        type: typeOf(name),
        bytes,
        url: await share.aws.presign(share.bucket, key, LIMITS.linkSeconds),
        ...(transcript === undefined ? {} : { transcript }),
      });
      passed.push(row.id);
    } catch (error) {
      log.warn("attachment-skipped", { why: "failed", ...errorFields(error) });
    }
  }
  if (shared.length > 0)
    log.info("attachments-sent", {
      count: shared.length,
      bytes: shared.reduce((sum, file) => sum + file.bytes, 0),
    });
  return { files: shared, passed, tooLarge };
}
