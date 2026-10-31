// Files a Claude sends back to the chat (attachments.md). Each session gets
// one short link; the upload link's Lambda turns it into a URL to put one file
// in the session's folder in the bucket. Once an answer is posted, what landed
// there goes to the chat through the bridge's outbox, each file once.
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { safeName } from "./attachments.ts";
import type { Aws } from "./aws.ts";
import type { Bridge } from "./bridge.ts";
import { errorFields, log } from "./log.ts";

export const OUTGOING = {
  bytes: 16 * 1024 * 1024,
  files: 5,
  // How long a link works after the session's latest delivery, and how long
  // a session goes before it is given the link again: two hours.
  linkSeconds: 7200,
  // How long a URL the Lambda signs works: long enough to start one upload.
  putSeconds: 300,
} as const;

/** A link's id: 18 random bytes, as 24 URL-safe characters. */
export const LINK_ID = /^[\w-]{24}$/u;
export const newLinkId = (): string => randomBytes(18).toString("base64url");

/** The folder a link's files go to. */
export const folderOf = (id: string): string => `outgoing/${id}/`;
/** The empty object whose age says whether a link still works. */
export const markerOf = (id: string): string => `links/${id}`;

/** Make a link work for the next linkSeconds. */
export async function keepLink(
  aws: Aws,
  bucket: string,
  id: string,
): Promise<void> {
  await aws.putObject(
    bucket,
    markerOf(id),
    Buffer.alloc(0),
    "application/octet-stream",
  );
}

/** A session's link: its id, and the files from its folder already sent or skipped. */
export interface Box {
  id: string;
  sent: string[];
}

export interface Send {
  aws: Aws;
  bucket: string;
  bridge: Bridge;
  outboxDir: string;
}

/**
 * Send what was uploaded to this link's folder and has not gone yet, at most
 * five, each at most 16 MB. Each file is noted in the box, sent or not, so it
 * goes once; a note whose file the bucket has dropped is let go.
 */
export async function sendUploads(
  chat: string,
  box: Box,
  send: Send,
): Promise<void> {
  const folder = folderOf(box.id);
  let objects: { key: string; bytes: number }[];
  try {
    objects = await send.aws.listObjects(send.bucket, folder);
  } catch (error) {
    log.warn("file-skipped", { why: "failed", ...errorFields(error) });
    return;
  }
  const listed = new Set(objects.map((object) => object.key));
  const kept = box.sent.filter((key) => listed.has(key));
  const fresh = objects.filter((object) => !kept.includes(object.key));
  box.sent.splice(0, box.sent.length, ...kept, ...fresh.map(({ key }) => key));
  const fit = fresh.filter(
    (object) => object.bytes > 0 && object.bytes <= OUTGOING.bytes,
  );
  if (fit.length < fresh.length)
    log.info("file-skipped", {
      why: "too-large",
      count: fresh.length - fit.length,
    });
  let count = 0;
  let bytes = 0;
  for (const { key } of fit.slice(0, OUTGOING.files)) {
    const dir = join(send.outboxDir, randomUUID());
    const path = join(dir, safeName(key.slice(folder.length)));
    try {
      const body = await send.aws.getObject(send.bucket, key);
      if (body === undefined) continue;
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, body);
      await send.bridge.sendFile(chat, path);
      count += 1;
      bytes += body.length;
    } catch (error) {
      log.warn("file-skipped", { why: "failed", ...errorFields(error) });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  if (count > 0) log.info("files-sent", { count, bytes });
}
