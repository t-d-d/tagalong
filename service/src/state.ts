// The sessions tagalong is waiting on, kept beside the device so a restart
// carries on. Read through its schema; written whole, atomically.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { z } from "zod";

const quoteSchema = z.object({
  id: z.string(),
  sender: z.string(),
  content: z.string(),
});

const sessionSchema = z.object({
  chat: z.string(),
  // The Claude the session is; "" for one from before named Claudes.
  claude: z.string().default(""),
  // The WhatsApp message the answer replies to.
  request: quoteSchema.optional(),
  // The last event read, as the sessions API numbers them.
  cursor: z.string().nullable().default(null),
  waiting: z.boolean(),
  since: z.number(),
  nudged: z.boolean().default(false),
  // The turn's latest words, kept across polls.
  lastText: z.string().default(""),
  // The folder in the bucket the turn may upload files to (outgoing.ts).
  outbox: z.string().nullable().default(null),
});

const stateSchema = z.object({
  sessions: z.record(z.string(), sessionSchema).default({}),
  // Media already given to a session, so the same photo is not sent twice.
  sentMedia: z.array(z.string()).default([]),
  // Which session each answer came from, by message id and by text (replies.ts).
  replies: z.record(z.string(), z.string()).default({}),
  // Each Claude's running conversation in each group, by threadKey: its
  // session, and when the last message it has heard was sent.
  threads: z
    .record(
      z.string(),
      z.object({
        session: z.string().nullable(),
        heard: z.number(),
        // The Claude's definition the session started on (versionOf).
        version: z.string().default(""),
        // A session to carry the dialogue over from, into the next one.
        carry: z.string().nullable().default(null),
      }),
    )
    .default({}),
});

export type SessionState = z.infer<typeof sessionSchema>;
export type Thread = State["threads"][string];

/** The key of a Claude's conversation in a group. */
export const threadKey = (chat: string, claude: string): string =>
  `${chat} ${claude}`;
export type State = z.infer<typeof stateSchema>;

export class StateStore {
  readonly #path: string;
  state: State;

  constructor(path: string) {
    this.#path = path;
    this.state = this.#load();
  }

  #load(): State {
    return existsSync(this.#path)
      ? stateSchema.parse(JSON.parse(readFileSync(this.#path, "utf8")))
      : stateSchema.parse({});
  }

  /** Read the file again, for one that arrived with the device. */
  reload(): void {
    this.state = this.#load();
  }

  save(): void {
    this.state.sentMedia = this.state.sentMedia.slice(-500);
    const replies = Object.entries(this.state.replies);
    if (replies.length > 1000)
      this.state.replies = Object.fromEntries(replies.slice(-1000));
    const tmp = `${this.#path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 1), { mode: 0o600 });
    renameSync(tmp, this.#path);
  }
}
