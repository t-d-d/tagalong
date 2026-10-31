// The whatsapp-mcp bridge's REST API, on loopback. It records what it is
// asked to send and react, and downloads media into the store the way the
// bridge does, answering with the file's absolute path.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { type Served, serve } from "./serve.ts";

export const BRIDGE_TOKEN = "bridge-token-for-tests";

const sendSchema = z.object({
  recipient: z.string(),
  message: z.string(),
  media_path: z.string().optional(),
  quoted_message_id: z.string().optional(),
});
const reactSchema = z.object({
  recipient: z.string(),
  message_id: z.string(),
  from_me: z.boolean().optional(),
  sender_jid: z.string().optional(),
  emoji: z.string(),
});
const downloadSchema = z.object({
  message_id: z.string(),
  chat_jid: z.string(),
});

export interface FakeBridge {
  url: string;
  served: Served;
  sent: z.infer<typeof sendSchema>[];
  reactions: z.infer<typeof reactSchema>[];
  connected: boolean;
  /** How many of the next messages sent the bridge refuses with a 500. */
  refusing: number;
  /** The bytes of each file sent, by its path, read as the bridge sends it. */
  files: Map<string, Buffer>;
  /**
   * Media the bridge can download, by message id. Each download answers with
   * the next of `writing`, a file its own download is still writing, while any
   * are left, and then with the whole file.
   */
  media: Map<string, { filename: string; bytes: Buffer; writing?: Buffer[] }>;
  close(): Promise<void>;
}

/** Each message sent, stored the way the bridge stores its own; returns the id it got. */
export type OnSend = (sent: { recipient: string; message: string }) => string;

export async function fakeBridge(
  store: string,
  onSend: OnSend = () => "",
): Promise<FakeBridge> {
  const sent: FakeBridge["sent"] = [];
  const reactions: FakeBridge["reactions"] = [];
  const media: FakeBridge["media"] = new Map();
  const files: FakeBridge["files"] = new Map();
  const state = { connected: true, refusing: 0 };
  const served = await serve((request) => {
    if (request.headers.authorization !== `Bearer ${BRIDGE_TOKEN}`)
      return { status: 401, body: { success: false } };
    switch (request.path) {
      case "/api/health":
        return state.connected
          ? { body: { status: "ok", connected: true } }
          : { status: 503, body: { status: "disconnected", connected: false } };
      case "/api/send": {
        const message = sendSchema.parse(request.body);
        if (state.refusing > 0) {
          state.refusing -= 1;
          return { status: 500, body: { success: false } };
        }
        sent.push(message);
        if (message.media_path !== undefined)
          files.set(message.media_path, readFileSync(message.media_path));
        onSend(message);
        return { body: { success: true, message: "Message sent" } };
      }
      case "/api/react":
        reactions.push(reactSchema.parse(request.body));
        return { body: { success: true } };
      case "/api/download": {
        const { message_id: id } = downloadSchema.parse(request.body);
        const file = media.get(id);
        if (file === undefined) return { body: { success: false } };
        const dir = join(store, "media");
        mkdirSync(dir, { recursive: true });
        const path = join(dir, file.filename);
        writeFileSync(path, file.writing?.shift() ?? file.bytes);
        return { body: { success: true, filename: file.filename, path } };
      }
      default:
        return { status: 404 };
    }
  });
  return {
    url: `${served.url}/api`,
    served,
    sent,
    reactions,
    get connected() {
      return state.connected;
    },
    set connected(value: boolean) {
      state.connected = value;
    },
    get refusing() {
      return state.refusing;
    },
    set refusing(value: number) {
      state.refusing = value;
    },
    media,
    files,
    close: () => served.close(),
  };
}
