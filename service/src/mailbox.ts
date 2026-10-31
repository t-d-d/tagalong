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

/** A session is busy while a delivery has no result that lists it. */
export const busy = (session: SessionState): boolean =>
  session.deliveries.some((delivery) => !delivery.answered);

const OPEN = /<whatsapp(?:\s+reply\s*=\s*"\[?(m\d+)\]?")?\s*>/gu;
const CLOSE = "</whatsapp>";

/** Whether a message from a Claude holds a <whatsapp> tag, closed or not. */
export const tagged = (message: string): boolean =>
  new RegExp(OPEN.source, "u").test(message);
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
 * <whatsapp> pair, in order, and whether a tag was left open. Nothing
 * outside the tags, and no empty pair (cloud-sessions.md).
 */
export function forChat(message: string): { posts: Post[]; unclosed: boolean } {
  const posts: Post[] = [];
  OPEN.lastIndex = 0;
  for (
    let open = OPEN.exec(message);
    open !== null;
    open = OPEN.exec(message)
  ) {
    const start = open.index + open[0].length;
    const end = message.indexOf(CLOSE, start);
    if (end === -1) return { posts, unclosed: true };
    OPEN.lastIndex = end + CLOSE.length;
    const text = message.slice(start, end).trim();
    if (text === "") continue;
    const reply = open[1];
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
