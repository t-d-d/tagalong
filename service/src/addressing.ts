// Which Claudes a message asks (who-can-use-it.md). A Claude is asked by its
// name, "@podstow", anywhere in the message, by a reply to one of its
// answers, or by a reaction on its latest answer in the chat. Several names
// ask each of them. "@claude", or a mention of the number, with no command
// and no name asks nobody: it gets told who is here.
import { userPart } from "./people.ts";
import { answerBy } from "./prompts.ts";
import type { MessageRow } from "./store.ts";
import type { Payload } from "./webhook.ts";

export interface Addressed {
  /** The group's Claudes this message asks, in the order named. */
  claudes: string[];
  /** Names of defined Claudes that are not in this group. */
  missing: string[];
  /** "@claude" or a mention of the number, and no Claude named. */
  bare: boolean;
}

const NONE: Addressed = { claudes: [], missing: [], bare: false };

export function addressed(
  payload: Payload,
  here: readonly string[],
  defined: ReadonlySet<string>,
  self: ReadonlySet<string>,
  /**
   * The Claude whose answer the message replies to, if it does; for a
   * reaction, the Claude whose latest answer it is on (reactedTo).
   */
  repliedTo: string | undefined,
): Addressed {
  if (payload.isFromMe) return NONE;
  if (payload.eventType === "reaction") {
    // Taking a reaction off asks nobody, and nor does the device's own.
    const added = (payload.reactionEmoji ?? "") !== "";
    const ours = self.has(userPart(payload.sender));
    return added && !ours && repliedTo !== undefined && here.includes(repliedTo)
      ? { claudes: [repliedTo], missing: [], bare: false }
      : NONE;
  }
  const text = payload.content.trim();
  // A voice note or other media with no text can still reply to an answer.
  if (text === "" && (payload.mediaType ?? "") === "") return NONE;
  const named = [
    ...new Set(
      [...text.matchAll(/(?:^|[\s(])@([a-z][a-z0-9-]{1,23})\b/giu)].map(
        (match) => (match[1] ?? "").toLowerCase(),
      ),
    ),
  ];
  const claudes = named.filter((name) => here.includes(name));
  const missing = named.filter(
    (name) => defined.has(name) && !here.includes(name),
  );
  if (
    claudes.length === 0 &&
    repliedTo !== undefined &&
    here.includes(repliedTo)
  )
    claudes.push(repliedTo);
  const mentioned = (payload.mentionedJids ?? []).some((jid) =>
    self.has(userPart(jid)),
  );
  const bare = claudes.length === 0 && (named.includes("claude") || mentioned);
  return { claudes, missing, bare };
}

export interface Answers {
  message(chat: string, id: string | undefined): MessageRow | undefined;
  /** The newest message the device sent in `chat` that reads as `claude`'s answer. */
  latestAnswer(chat: string, claude: string): MessageRow | undefined;
}

/**
 * The Claude a reaction asks and the answer it is on: only when it is on
 * that Claude's latest answer in the chat, never an older one, a person's
 * message or one of tagalong's notices.
 */
export function reactedTo(
  payload: Payload,
  store: Answers,
): { claude: string; answer: MessageRow } | undefined {
  // A reaction taken off, or the device's own, asks nobody (addressed).
  if (
    payload.eventType !== "reaction" ||
    payload.isFromMe ||
    (payload.reactionEmoji ?? "") === ""
  )
    return undefined;
  const answer = store.message(payload.chatJID, payload.reactionToMessageId);
  if (answer === undefined || !answer.isFromMe) return undefined;
  const claude = answerBy(answer.content);
  if (claude === undefined) return undefined;
  return store.latestAnswer(payload.chatJID, claude)?.id === answer.id
    ? { claude, answer }
    : undefined;
}
