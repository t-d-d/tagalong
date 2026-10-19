// Files a Claude sends back to the chat (attachments.md). Each turn gets its
// own folder in the bucket and a form to upload to it; once the turn's answer
// is posted, what landed there goes to the chat through the bridge's outbox.
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

/** Send what the turn uploaded to `folder`, at most five, each at most 16 MB. */
export async function sendUploads(
  chat: string,
  folder: string,
  send: Send,
): Promise<void> {
  let count = 0;
  let bytes = 0;
  try {
    const objects = await send.aws.listObjects(send.bucket, folder);
    const fit = objects.filter(
      (object) => object.bytes > 0 && object.bytes <= OUTGOING.bytes,
    );
    if (fit.length < objects.length)
      log.info("file-skipped", {
        why: "too-large",
        count: objects.length - fit.length,
      });
    for (const object of fit.slice(0, OUTGOING.files)) {
      const dir = join(send.outboxDir, randomUUID());
      const path = join(dir, safeName(object.key.slice(folder.length)));
      try {
        const body = await send.aws.getObject(send.bucket, object.key);
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
  } catch (error) {
    log.warn("file-skipped", { why: "failed", ...errorFields(error) });
  }
  if (count > 0) log.info("files-sent", { count, bytes });
}
