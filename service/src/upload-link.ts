// The upload link's Lambda (attachments.md), behind an HTTP API:
// GET /up/<id>/<name> answers a short-lived URL to put one file in the
// session's folder, while the session's link works. It holds no state; the
// marker tagalong writes with each delivery says whether a link works.
import { z } from "zod";
import { safeName } from "./attachments.ts";
import { type Aws, realAws } from "./aws.ts";
import { readLinkEnv } from "./env.ts";
import { errorFields, log } from "./log.ts";
import { LINK_ID, OUTGOING, folderOf, markerOf } from "./outgoing.ts";

// The part of API Gateway's payload (format 2.0) read: the route's parameters.
const eventSchema = z.looseObject({
  pathParameters: z
    .looseObject({ id: z.string().optional(), name: z.string().optional() })
    .optional(),
});

export interface Reply {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const reply = (statusCode: number, body: string): Reply => ({
  statusCode,
  headers: { "content-type": "text/plain" },
  body,
});

const NO_LINK =
  "This link does not work now. It works again after the next message from the chat.";

export interface LinkDeps {
  aws: Aws;
  bucket: string;
  now: () => number;
}

/** A URL to put the named file in the link's folder, or why not. */
export async function answer(event: unknown, deps: LinkDeps): Promise<Reply> {
  const parsed = eventSchema.safeParse(event);
  const id = parsed.data?.pathParameters?.id ?? "";
  const name = parsed.data?.pathParameters?.name ?? "";
  if (!LINK_ID.test(id) || name === "") {
    log.info("link-refused", { why: "malformed" });
    return reply(404, NO_LINK);
  }
  let at: number | undefined;
  try {
    at = await deps.aws.modifiedAt(deps.bucket, markerOf(id));
  } catch (error) {
    log.warn("link-failed", errorFields(error));
    return reply(502, "The bucket did not answer. Try again in a minute.");
  }
  if (at === undefined || deps.now() - at > OUTGOING.linkSeconds * 1000) {
    log.info("link-refused", { why: at === undefined ? "unknown" : "lapsed" });
    return reply(404, NO_LINK);
  }
  const url = await deps.aws.presignPut(
    deps.bucket,
    `${folderOf(id)}${safeName(name)}`,
    OUTGOING.putSeconds,
  );
  log.info("link-signed");
  return reply(200, url);
}

/** The Lambda's entry point, loaded by images/upload-link.mjs. */
export async function handler(event: unknown): Promise<Reply> {
  const env = readLinkEnv();
  return answer(event, {
    aws: realAws(env.AWS_REGION),
    bucket: env.ATTACHMENTS_BUCKET,
    now: () => Date.now(),
  });
}
