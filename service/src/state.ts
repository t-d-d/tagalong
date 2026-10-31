// The sessions tagalong is reading, kept beside the device so a restart
// carries on. Read through its schema; written whole, atomically.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { z } from "zod";

const quoteSchema = z.object({
  id: z.string(),
  sender: z.string(),
  content: z.string(),
});

// A message tagalong put into a session (cloud-sessions.md).
const deliverySchema = z.object({
  // The session's uuid for it, read from its user event; null until then.
  uuid: z.string().nullable().default(null),
  // A hash of the text sent, to know that user event by.
  key: z.string(),
  // The WhatsApp message an answer to it replies to.
  ask: quoteSchema.nullable().default(null),
  at: z.number(),
  // Whether a result has listed it, or it was given up on.
  answered: z.boolean().default(false),
  // A delivery nobody asked for, to an interjecting Claude: nobody waits on it.
  interjecting: z.boolean().default(false),
});

// The session's upload link (outgoing.ts): its id, when the session was last
// given it, and the files from its folder already sent or skipped.
const linkSchema = z.object({
  id: z.string(),
  given: z.number(),
  sent: z.array(z.string()).default([]),
});

// A session saved before deliveries were noted (#17): the request it waits
// on becomes a delivery whose uuid can no longer be read, keyed "".
const legacySchema = z.looseObject({
  request: quoteSchema,
  waiting: z.literal(true),
  since: z.number(),
  deliveries: z.undefined().optional(),
});

const sessionSchema = z.preprocess(
  (raw) => {
    const old = legacySchema.safeParse(raw);
    if (!old.success) return raw;
    const { request, since } = old.data;
    return { ...old.data, deliveries: [{ key: "", ask: request, at: since }] };
  },
  z.object({
    chat: z.string(),
    // The Claude the session is; "" for one from before named Claudes.
    claude: z.string().default(""),
    // The last event read, as the sessions API numbers them.
    cursor: z.string().nullable().default(null),
    // Whether tagalong still reads the session.
    waiting: z.boolean(),
    // When it last had a delivery or a result.
    since: z.number(),
    nudged: z.boolean().default(false),
    deliveries: z.array(deliverySchema).default([]),
    // None for a session from before links (#59) until its next delivery,
    // or with no bucket or link to give.
    link: linkSchema.nullable().default(null),
    // An interjecting Claude's idle session: the reads in a row that found
    // nothing, and when it is read next (relay.ts).
    idle: z.number().default(0),
    readAt: z.number().default(0),
  }),
);

const stateSchema = z.object({
  sessions: z.record(z.string(), sessionSchema).default({}),
  // Media already given to a session, so the same photo is not sent twice.
  sentMedia: z.array(z.string()).default([]),
  // Which session each answer came from, by message id and by text (replies.ts).
  replies: z.record(z.string(), z.string()).default({}),
  // The requests showing tagalong's 👀, by eyesKey, until none of their
  // deliveries waits.
  eyes: z.array(z.string()).default([]),
  // Each chat's line labels, such as m41, and the message each stands for.
  labels: z
    .record(
      z.string(),
      z.object({
        next: z.number(),
        messages: z.record(
          z.string(),
          z.object({ id: z.string(), sender: z.string() }),
        ),
      }),
    )
    .default({}),
  // When each interjecting Claude, by threadKey, was set to interject: it hears
  // only what is said after.
  interjecting: z.record(z.string(), z.number()).default({}),
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
export type Delivery = z.infer<typeof deliverySchema>;
export type Link = z.infer<typeof linkSchema>;
export type Thread = State["threads"][string];

/** The key of a request that shows tagalong's 👀. */
export const eyesKey = (chat: string, id: string): string => `${chat} ${id}`;

/** Forget a request's 👀: it was taken off, or something replaced it. */
export function unsee(state: State, chat: string, id: string): void {
  const key = eyesKey(chat, id);
  state.eyes = state.eyes.filter((each) => each !== key);
}

/** The key of a Claude's conversation in a group. */
export const threadKey = (chat: string, claude: string): string =>
  `${chat} ${claude}`;
export type State = z.infer<typeof stateSchema>;

/** A state with nothing in it yet. */
export const emptyState = (): State => stateSchema.parse({});

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
    this.state.eyes = this.state.eyes.slice(-200);
    const replies = Object.entries(this.state.replies);
    if (replies.length > 1000)
      this.state.replies = Object.fromEntries(replies.slice(-1000));
    const tmp = `${this.#path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 1), { mode: 0o600 });
    renameSync(tmp, this.#path);
  }
}
