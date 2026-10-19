// The whatsapp-mcp bridge's REST API, on loopback inside the task.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { fetchJson } from "./http.ts";
import { HttpError } from "./log.ts";

const sendSchema = z.looseObject({ success: z.boolean().optional() });
const healthSchema = z.looseObject({
  status: z.string().optional(),
  connected: z.boolean().optional(),
});
const downloadSchema = z.looseObject({
  success: z.boolean(),
  filename: z.string().optional(),
  path: z.string().optional(),
});

export interface Quote {
  id: string;
  sender: string;
  content: string;
}

/** The bridge's token: given, or the one it wrote beside its store. */
export function bridgeToken(
  store: string,
  given: string | undefined,
): string | undefined {
  if (given !== undefined) return given;
  const file = join(store, ".bridge-token");
  return existsSync(file) ? readFileSync(file, "utf8").trim() : undefined;
}

export class Bridge {
  readonly #url: string;
  readonly #token: () => string | undefined;
  readonly #toJid: (user: string) => string;

  constructor(
    url: string,
    token: () => string | undefined,
    toJid: (user: string) => string,
  ) {
    this.#url = url;
    this.#token = token;
    this.#toJid = toJid;
  }

  async #call<T>(
    endpoint: string,
    body: unknown,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const token = this.#token();
    if (token === undefined) throw new HttpError(`bridge ${endpoint}`, 0);
    return fetchJson(
      `bridge ${endpoint}`,
      `${this.#url}/${endpoint}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30_000),
      },
      schema,
    );
  }

  /** Whether the bridge is up and connected to WhatsApp. It answers 503 while disconnected. */
  async connected(): Promise<boolean> {
    try {
      return (
        (await this.#call("health", undefined, healthSchema)).connected === true
      );
    } catch (error) {
      if (error instanceof HttpError && error.status === 503) return false;
      throw error;
    }
  }

  async send(chat: string, message: string, quote?: Quote): Promise<void> {
    await this.#call(
      "send",
      {
        recipient: chat,
        message,
        ...(quote === undefined || quote.id === ""
          ? {}
          : {
              quoted_message_id: quote.id,
              quoted_sender_jid: this.#toJid(quote.sender),
              quoted_content: quote.content.slice(0, 500),
            }),
      },
      sendSchema,
    );
  }

  /** Send a file from the outbox, as a picture, audio, video or document by its extension. */
  async sendFile(chat: string, path: string): Promise<void> {
    await this.#call(
      "send",
      { recipient: chat, message: "", media_path: path },
      sendSchema,
    );
  }

  async react(
    chat: string,
    message: { id: string; sender: string },
    emoji: string,
  ): Promise<void> {
    if (message.id === "") return;
    await this.#call(
      "react",
      {
        recipient: chat,
        message_id: message.id,
        sender_jid: this.#toJid(message.sender),
        emoji,
      },
      sendSchema,
    );
  }

  /** Download a message's media into the bridge's store; returns where it landed. */
  async download(
    chat: string,
    id: string,
  ): Promise<{ path: string; filename: string }> {
    const result = await this.#call(
      "download",
      { message_id: id, chat_jid: chat },
      downloadSchema,
    );
    if (!result.success || result.path === undefined)
      throw new HttpError("bridge download", 500);
    return { path: result.path, filename: result.filename ?? id };
  }
}
