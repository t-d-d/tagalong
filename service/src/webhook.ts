// What the bridge POSTs for every message, and the server that takes it.
// Only a request carrying the bridge's own token is read.
import { timingSafeEqual } from "node:crypto";
import { type Server, createServer } from "node:http";
import { z } from "zod";
import { readBody } from "./http.ts";
import { errorFields, log } from "./log.ts";

export const payloadSchema = z.looseObject({
  eventType: z.string().optional(),
  sender: z.string().default(""),
  content: z.string().default(""),
  chatJID: z.string(),
  isFromMe: z.boolean().default(false),
  quotedMessageId: z.string().optional(),
  quotedSender: z.string().optional(),
  quotedContent: z.string().optional(),
  quotedIsFromMe: z.boolean().optional(),
  mentionedJids: z.array(z.string()).nullable().default([]),
  messageId: z.string().default(""),
  mediaType: z.string().optional(),
  // A reaction's emoji, "" when one is taken off, and the message it is on.
  reactionEmoji: z.string().optional(),
  reactionToMessageId: z.string().optional(),
});

export type Payload = z.infer<typeof payloadSchema>;
export const WEBHOOK_PATH = "/whatsapp/webhook";
const LIMIT = 16 * 1024 * 1024;

export function webhookServer(
  token: () => string | undefined,
  onPayload: (payload: Payload) => void,
): Server {
  return createServer((request, response) => {
    if (request.method === "GET" && request.url === "/healthz") {
      response.end("ok");
      return;
    }
    if (request.method !== "POST" || request.url !== WEBHOOK_PATH) {
      response.writeHead(404).end();
      return;
    }
    const expected = Buffer.from(token() ?? "");
    const given = Buffer.from(String(request.headers["x-bridge-token"] ?? ""));
    if (
      expected.length === 0 ||
      given.length !== expected.length ||
      !timingSafeEqual(given, expected)
    ) {
      log.warn("webhook-rejected");
      response.writeHead(401).end();
      return;
    }
    readBody(request, LIMIT).then(
      (text) => {
        // Answer at once: the bridge waits on us.
        response.writeHead(200).end("ok");
        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch {
          data = undefined;
        }
        const parsed = payloadSchema.safeParse(data);
        if (!parsed.success) {
          log.warn("webhook-unreadable");
          return;
        }
        try {
          onPayload(parsed.data);
        } catch (error) {
          log.error("payload-failed", errorFields(error));
        }
      },
      (error: unknown) => {
        log.warn("webhook-unreadable", errorFields(error));
        response.writeHead(400).end();
      },
    );
  });
}
