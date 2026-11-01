// A Claude's session as a mailbox (cloud-sessions.md): tagalong delivers
// messages into it when it decides to, whether or not the session is
// working, and posts what the Claude tags for the chat. A delivery is known
// in the session by its text, and a result by the messages it lists.
import { createHash } from "node:crypto";
import type { Quote } from "./bridge.ts";
import type { Delivery, SessionState, State } from "./state.ts";

/** How many line labels a chat keeps, the oldest forgotten first. */
const LABELS = 500;

/** A chat line's label, such as m41, the same each time the line is shown. */
export function labelFor(
  state: State,
  chat: string,
  message: { id: string; sender: string },
): string {
  const labels = (state.labels[chat] ??= { next: 1, messages: {} });
  const known = Object.entries(labels.messages).find(
    ([, line]) => line.id === message.id,
  );
  if (known !== undefined) return known[0];
  const label = `m${String(labels.next)}`;
  labels.next += 1;
  labels.messages[label] = { id: message.id, sender: message.sender };
  const all = Object.entries(labels.messages);
  if (all.length > LABELS)
    labels.messages = Object.fromEntries(all.slice(-LABELS));
  return label;
}

/** The message a label stands for in a chat, if the chat still knows it. */
export const messageFor = (
  state: State,
  chat: string,
  label: string,
): { id: string; sender: string } | undefined =>
  state.labels[chat]?.messages[label];

// Whitespace aside, so a message the CLI trims or rewraps is still known.
const keyOf = (text: string): string =>
  createHash("sha256")
    .update(text.replace(/\s+/gu, ""))
    .digest("hex")
    .slice(0, 24);

/** A message about to go into a session, with the ask an answer to it replies to. */
export const deliveryOf = (
  text: string,
  ask: Quote | null,
  at: number,
  interjecting = false,
): Delivery => ({
  uuid: null,
  key: keyOf(text),
  ask,
  at,
  answered: false,
  started: false,
  interjecting,
});

/** Note the uuid of a user event in the session that is one of tagalong's deliveries. */
export function heard(session: SessionState, uuid: string, text: string): void {
  if (session.deliveries.some((delivery) => delivery.uuid === uuid)) return;
  const key = keyOf(text);
  const delivery = session.deliveries.find(
    (each) => each.uuid === null && each.key === key,
  );
  if (delivery !== undefined) delivery.uuid = uuid;
}

/**
 * The deliveries a result answers, from the messages it lists: none for a
 * turn the session started by itself, and null when every message it lists
 * was given from elsewhere, such as Claude Desktop.
 */
export function answering(
  session: SessionState,
  uuids: string[],
): Delivery[] | null {
  const ours = session.deliveries.filter(
    (delivery) => delivery.uuid !== null && uuids.includes(delivery.uuid),
  );
  if (uuids.length === 0 || ours.length > 0) return ours;
  // A delivery saved before uuids were noted (state.ts) takes the next result.
  const legacy = session.deliveries.filter(
    (delivery) => !delivery.answered && delivery.key === "",
  );
  return legacy.length > 0 ? legacy : null;
}

/** A session is busy while a delivery's turn is open (relay.ts). */
export const busy = (session: SessionState): boolean =>
  session.deliveries.some((delivery) => !delivery.answered);

// Sticky, so an opening tag is matched only where a line starts.
const OPEN = /<whatsapp(?:\s+reply\s*=\s*"\[?(m\d+)\]?")?\s*>/uy;
const CLOSE = "</whatsapp>";
// A fence opens a code block, as in Markdown: three or more backticks with
// no backtick after them on the line, or three or more tildes. A bare fence
// of the same character, at least as long, closes it.
const FENCE = /`{3,}(?=[^`\n]*(?:\n|$))|~{3,}/uy;
const BARE = /(`{3,}|~{3,})[ \t\r]*(?:\n|$)/uy;

interface Pair {
  reply: string | undefined;
  /** Where the pair's text starts and ends, the end -1 for a tag left open. */
  start: number;
  end: number;
}

/**
 * Each <whatsapp> pair a Claude means: one whose opening tag is the first
 * thing on its line, outside a fenced code block. A tag anywhere else is
 * text, and so is a code block inside a pair (cloud-sessions.md).
 */
function* pairs(message: string): Generator<Pair> {
  // The fence that opened the block the scan is in, if it is in one.
  let fence: string | undefined;
  let at = 0;
  while (at < message.length) {
    const eol = message.indexOf("\n", at);
    const next = eol === -1 ? message.length : eol + 1;
    OPEN.lastIndex = at;
    const open = fence === undefined ? OPEN.exec(message) : null;
    if (open !== null) {
      const start = at + open[0].length;
      const end = message.indexOf(CLOSE, start);
      yield { reply: open[1], start, end };
      if (end === -1) return;
      // The rest of the line the pair closed on has the pair before it.
      const after = message.indexOf("\n", end + CLOSE.length);
      at = after === -1 ? message.length : after + 1;
      continue;
    }
    if (fence === undefined) {
      FENCE.lastIndex = at;
      fence = FENCE.exec(message)?.[0];
    } else {
      BARE.lastIndex = at;
      const bare = BARE.exec(message)?.[1];
      if (
        bare !== undefined &&
        bare[0] === fence[0] &&
        bare.length >= fence.length
      )
        fence = undefined;
    }
    at = next;
  }
}

/** Whether a message from a Claude holds a <whatsapp> tag it means, closed or not. */
export const tagged = (message: string): boolean =>
  pairs(message).next().done !== true;

const EMOJI =
  /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[#*0-9]️?⃣)/u;
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

export interface Post {
  /** A message to post, or a reaction to put on the line it replies to. */
  kind: "message" | "reaction";
  /** The label of the line it replies to, such as m45. */
  reply: string | undefined;
  text: string;
}

/**
 * What one message from a Claude asks tagalong to post: the text of each
 * <whatsapp> pair it means, in order, and whether a tag was left open. Nothing
 * outside the tags, and no empty pair (cloud-sessions.md).
 */
export function forChat(message: string): { posts: Post[]; unclosed: boolean } {
  const posts: Post[] = [];
  for (const { reply, start, end } of pairs(message)) {
    if (end === -1) return { posts, unclosed: true };
    const text = message.slice(start, end).trim();
    if (text === "") continue;
    const one = [...graphemes.segment(text)].length === 1;
    posts.push({
      kind:
        reply !== undefined && one && EMOJI.test(text) ? "reaction" : "message",
      reply,
      text,
    });
  }
  return { posts, unclosed: false };
}
