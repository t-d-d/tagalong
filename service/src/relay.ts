// Reading a session's answer and posting it to its group.
import type { Bridge } from "./bridge.ts";
import { type ClaudeApi, textOf } from "./claude-api.ts";
import { sessionLink, toWhatsApp } from "./format.ts";
import type { GroupsStore } from "./groups.ts";
import { errorFields, log } from "./log.ts";
import { remember } from "./replies.ts";
import type { SessionState, StateStore } from "./state.ts";
import type { WhatsAppStore } from "./store.ts";

export interface RelayDeps {
  api: ClaudeApi;
  bridge: Bridge;
  groups: GroupsStore;
  state: StateStore;
  store: WhatsAppStore;
  giveUpMs: number;
  now: () => number;
}

/** Look at one waiting session; post its answer when a turn has ended. */
export async function check(
  id: string,
  session: SessionState,
  deps: RelayDeps,
): Promise<void> {
  const { events, cursor } = await deps.api.eventsAfter(id, session.cursor);
  session.cursor = cursor;
  let answer: string | null = null;
  let lastText = session.lastText;
  for (const event of events) {
    const text = textOf(event);
    if (event.type === "assistant" && text !== "") lastText = text;
    if (event.type === "result") {
      const failed =
        event.is_error === true ||
        (event.subtype !== undefined && event.subtype !== "success");
      answer = failed
        ? `⚠️ The session stopped with an error (${event.subtype ?? "error"}).`
        : text || lastText;
      lastText = "";
    }
  }
  session.lastText = lastText;
  if (answer === null) {
    const { status } = await deps.api.record(id);
    if (status === "requires_action" && !session.nudged) {
      session.nudged = true;
      log.info("session-waiting-approval", { session: id });
      await deps.bridge.send(
        session.chat,
        `Claude is waiting for an approval in the session.\n\n↗ ${sessionLink(id)}`,
        session.request,
      );
    } else if (
      ["idle", "archived", "failed"].includes(status) &&
      lastText !== ""
    ) {
      answer = lastText; // the turn ended with no result event: its last words
    } else if (status === "archived" || status === "failed") {
      answer = `⚠️ The session ${status === "failed" ? "failed" : "was archived"} without a reply.`;
    }
    if (answer === null) {
      if (deps.now() - session.since > deps.giveUpMs) {
        session.waiting = false;
        log.info("session-gave-up", { session: id });
        await deps.bridge.send(
          session.chat,
          `No reply from Claude after ${String(Math.round(deps.giveUpMs / 60_000))} minutes; it may still be working.`,
          session.request,
        );
      }
      return;
    }
  }
  session.waiting = false;
  session.lastText = "";
  const text = toWhatsApp(answer);
  if (text !== "") {
    await deps.bridge.send(session.chat, text, session.request);
    remember(deps.state.state, deps.store, session.chat, text, id);
  }
  log.info("session-relayed", { session: id, chars: text.length });
}

let polling = false;

/** One pass over the waiting sessions of groups still set up. */
export async function poll(deps: RelayDeps): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    for (const [id, session] of Object.entries(deps.state.state.sessions)) {
      if (!session.waiting || !deps.groups.config.groups.has(session.chat))
        continue;
      try {
        await check(id, session, deps);
      } catch (error) {
        log.warn("session-poll-failed", { session: id, ...errorFields(error) });
      }
    }
    deps.state.save();
  } finally {
    polling = false;
  }
}
