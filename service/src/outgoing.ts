// Files a Claude sends back to the chat (attachments.md). Each delivery gets
// its own folder in the bucket and a form to upload to it; once a turn's
// answer is posted, what landed there goes to the chat through the bridge's
// outbox, each file once.
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { safeName } from "./attachments.ts";
import type { Aws } from "./aws.ts";
import type { Bridge } from "./bridge.ts";
import { errorFields, log } from "./log.ts";

export const OUTGOING = {
  bytes: 16 * 1024 * 1024,
  files: 5,
  // As long as a turn is waited on (GIVE_UP_MS's default).
  linkSeconds: 7200,
} as const;

export interface Upload {
  /** The turn's folder in the bucket. */
  folder: string;
  url: string;
  fields: Record<string, string>;
}

/** A new folder for one turn, and the form to upload to it. */
export async function uploadFor(aws: Aws, bucket: string): Promise<Upload> {
  const folder = `outgoing/${randomUUID()}/`;
  const { url, fields } = await aws.presignPost(
    bucket,
    folder,
    OUTGOING.bytes,
    OUTGOING.linkSeconds,
  );
  return { folder, url, fields };
}

export interface Send {
  aws: Aws;
  bucket: string;
  bridge: Bridge;
  outboxDir: string;
}

/** A delivery's upload folder, and the files from it already sent or skipped. */
export interface Box {
  folder: string;
  sent: string[];
}

/**
 * Send what was uploaded to these folders and has not gone yet, at most five,
 * each at most 16 MB. Each file is noted in its box, sent or not, so it goes
 * once.
 */
export async function sendUploads(
  chat: string,
  boxes: Box[],
  send: Send,
): Promise<void> {
  const fresh: { box: Box; key: string; bytes: number }[] = [];
  for (const box of boxes) {
    try {
      const objects = await send.aws.listObjects(send.bucket, box.folder);
      for (const object of objects)
        if (!box.sent.includes(object.key)) fresh.push({ box, ...object });
    } catch (error) {
      log.warn("file-skipped", { why: "failed", ...errorFields(error) });
    }
  }
  for (const { box, key } of fresh) box.sent.push(key);
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
  for (const { box, key } of fit.slice(0, OUTGOING.files)) {
    const dir = join(send.outboxDir, randomUUID());
    const path = join(dir, safeName(key.slice(box.folder.length)));
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
