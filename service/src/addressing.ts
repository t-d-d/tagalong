// Which Claudes a message asks (who-can-use-it.md). A Claude is asked by its
// name, "@podstow", anywhere in the message, or by a reply to one of its
// answers. Several names ask each of them. "@claude", or a mention of the
// number, with no command and no name asks nobody: it gets told who is here.
import { userPart } from "./people.ts";
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
  /** The Claude whose answer the message replies to, if it does. */
  repliedTo: string | undefined,
): Addressed {
  if (payload.eventType === "reaction" || payload.isFromMe) return NONE;
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
