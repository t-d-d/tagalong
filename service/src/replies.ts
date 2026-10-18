// Which session an answer came from, so a reply to it carries on there
// without a link in the message (cloud-sessions.md). An answer is known by
// the id WhatsApp gave it, read back from the bridge's store, and by a hash
// of its text, for a reply whose id the store missed.
import { createHash } from "node:crypto";
import { lastSession } from "./format.ts";
import type { State } from "./state.ts";
import type { WhatsAppStore } from "./store.ts";

const textKey = (text: string): string =>
  `text:${createHash("sha256").update(text.trim()).digest("hex").slice(0, 24)}`;

/** Note that `text`, just sent to `chat`, came from `session`. */
export function remember(
  state: State,
  store: WhatsAppStore,
  chat: string,
  text: string,
  session: string,
): void {
  state.replies[textKey(text)] = session;
  const id = store.sentId(chat, text);
  if (id !== undefined) state.replies[`id:${id}`] = session;
}

/** The session a quoted answer came from: by its id, its text, or a link in an older answer. */
export function sessionFor(
  state: State,
  quotedId: string | undefined,
  quotedText: string | undefined,
): string | null {
  return (
    (quotedId === undefined ? undefined : state.replies[`id:${quotedId}`]) ??
    (quotedText === undefined
      ? undefined
      : state.replies[textKey(quotedText)]) ??
    lastSession(quotedText)
  );
}
