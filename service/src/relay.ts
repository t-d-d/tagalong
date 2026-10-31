// Reading a Claude's session and posting what it tags for its chat
// (cloud-sessions.md). A session is read from its first delivery until it has
// had no delivery and no result for GIVE_UP_MS. Only text inside <whatsapp>
// tags is posted, from any message the Claude writes, whatever started its
// turn. A result posts nothing: it answers the deliveries it lists.
//
// An interjecting Claude's session is read until it ends, less often the
// longer it is idle.
import type { Aws } from "./aws.ts";
import type { Bridge, Quote } from "./bridge.ts";
import { type ClaudeApi, type Payload, textOf } from "./claude-api.ts";
import { sessionLink, toWhatsApp } from "./format.ts";
import type { GroupsStore } from "./groups.ts";
import { errorFields, log } from "./log.ts";
import {
  type Post,
  answering,
  busy,
  forChat,
  heard,
  messageFor,
} from "./mailbox.ts";
import { sendUploads } from "./outgoing.ts";
import { answerText } from "./prompts.ts";
import { remember } from "./replies.ts";
import {
  type Delivery,
  type SessionState,
  type StateStore,
  eyesKey,
  threadKey,
  unsee,
} from "./state.ts";
import type { WhatsAppStore } from "./store.ts";

export interface RelayDeps {
  api: ClaudeApi;
  bridge: Bridge;
  groups: GroupsStore;
  state: StateStore;
  store: WhatsAppStore;
  giveUpMs: number;
  now: () => number;
  /** Sessions with a message on its way in, left alone until it is. */
  sending: Set<string>;
  /** Requests, by eyesKey, still being delivered to their Claudes: their 👀 stays. */
  asking: Set<string>;
  /** Where a session's uploads are, and where the bridge sends files from; none without a bucket. */
  files?: { aws: Aws; bucket: string; outboxDir: string };
}

/** The asks these deliveries carry. */
const asksOf = (deliveries: Delivery[]): Quote[] =>
  deliveries.flatMap((delivery) =>
    delivery.ask === null ? [] : [delivery.ask],
  );

/** The ask an answer to these deliveries replies to: the latest they carry. */
const latestAsk = (deliveries: Delivery[]): Quote | undefined =>
  deliveries.findLast((delivery) => delivery.ask !== null)?.ask ?? undefined;

/** How many answered deliveries a session keeps. */
const KEPT = 20;

const MINUTE = 60_000;
const GAPS = [1, 2, 5, 10, 30].map((minutes) => minutes * MINUTE);

/** The wait before an idle interjecting session's next read, after `idle` reads that found nothing. */
export const readGap = (idle: number): number =>
  GAPS[Math.min(idle, GAPS.length - 1)] ?? 30 * MINUTE;

/**
 * Whether this is an interjecting Claude's running session in its chat, read
 * until it ends. A session update or fresh replaced is not.
 */
function interjecting(
  id: string,
  session: SessionState,
  deps: Pick<RelayDeps, "groups" | "state">,
): boolean {
  const group = deps.groups.config.groups.get(session.chat);
  return (
    group !== undefined &&
    group.interjecting.includes(session.claude) &&
    deps.state.state.threads[threadKey(session.chat, session.claude)]
      ?.session === id
  );
}

/** Look at one session; post what it tagged for the chat, and end each turn that ended. */
export async function check(
  id: string,
  session: SessionState,
  deps: RelayDeps,
): Promise<void> {
  const own = interjecting(id, session, deps);
  const { events, cursor } = await deps.api.eventsAfter(id, session.cursor);
  session.cursor = cursor;
  let ended = 0;
  for (const event of events) {
    const text = textOf(event);
    if (event.type === "user" && event.uuid !== undefined && text !== "")
      heard(session, event.uuid, text);
    if (event.type === "assistant" && text !== "")
      await postTagged(id, session, text, deps);
    if (event.type === "result") {
      ended += 1;
      await end(id, session, event, deps);
    }
  }
  if (ended > 0) session.since = deps.now();
  else if (busy(session)) await waitOn(id, session, deps);
  const now = deps.now();
  if (own) await schedule(id, session, events.length, ended, deps);
  else if (!busy(session) && now - session.since > deps.giveUpMs)
    session.waiting = false;
  // Every delivery still waiting is kept, and the latest answered ones, so
  // a late answer to one given up on still finds it.
  const answered = session.deliveries.filter((delivery) => delivery.answered);
  const old = new Set(answered.slice(0, -KEPT));
  session.deliveries = session.deliveries.filter(
    (delivery) => !old.has(delivery),
  );
}

/**
 * A result ends a turn. The deliveries it lists are answered and their 👀
 * comes off. Its text repeats the Claude's last message, so it posts
 * nothing; a failed turn that took a request gets tagalong's notice.
 */
async function end(
  id: string,
  session: SessionState,
  event: Payload,
  deps: RelayDeps,
): Promise<void> {
  const answers = answering(session, event.user_message_uuids ?? []) ?? [];
  for (const delivery of answers) delivery.answered = true;
  const failed =
    event.is_error === true ||
    (event.subtype !== undefined && event.subtype !== "success");
  // Nobody waits on an interjecting delivery, so its failure is not told.
  const asked = answers.filter((delivery) => !delivery.interjecting);
  if (failed && asked.length > 0)
    await notice(
      id,
      session,
      `⚠️ The session stopped with an error (${event.subtype ?? "error"}).`,
      asked,
      deps,
    );
  await lookAway(session.chat, asksOf(answers), deps);
}

/** tagalong's own word on these deliveries, under the Claude's name, as a reply to the latest ask. */
async function notice(
  id: string,
  session: SessionState,
  text: string,
  deliveries: Delivery[],
  deps: RelayDeps,
): Promise<void> {
  const message = answerText(session.claude, text);
  await deps.bridge.send(session.chat, message, latestAsk(deliveries));
  remember(deps.state.state, deps.store, session.chat, message, id);
}

/**
 * An interjecting Claude's session after a read: read every POLL_MS while a
 * delivery waits, and once none does, after a gap that grows while nothing
 * happens. Its status is checked when idle, since an archived or failed
 * session takes no more turns.
 */
async function schedule(
  id: string,
  session: SessionState,
  read: number,
  ended: number,
  deps: RelayDeps,
): Promise<void> {
  if (busy(session)) {
    session.idle = 0;
    session.readAt = 0;
    return;
  }
  if (read === 0) {
    const { status } = await deps.api.record(id);
    if (status === "archived" || status === "failed") {
      // Read once more, so a turn that ended since is not lost: the next
      // poll reads it.
      if ((await deps.api.eventsAfter(id, session.cursor)).events.length > 0)
        session.readAt = 0;
      else session.waiting = false;
      return;
    }
  }
  if (ended > 0) session.idle = 0;
  session.readAt = deps.now() + readGap(session.idle);
  session.idle += 1;
}

/** A busy session that ended no turn since the last look. */
async function waitOn(
  id: string,
  session: SessionState,
  deps: RelayDeps,
): Promise<void> {
  const waiting = session.deliveries.filter((delivery) => !delivery.answered);
  // Nobody waits on an interjecting delivery, so it gets no notices.
  const asked = waiting.filter((delivery) => !delivery.interjecting);
  const { status } = await deps.api.record(id);
  // An archived or failed session takes no more turns.
  const ended = status === "archived" || status === "failed";
  // The turn may have ended, with its result, since its events were read:
  // that result answers it, read on the next look.
  if (
    (ended || status === "idle") &&
    (await deps.api.eventsAfter(id, session.cursor)).events.length > 0
  )
    return;
  if (ended) session.waiting = false;
  if (status === "requires_action" && !session.nudged && asked.length > 0) {
    session.nudged = true;
    log.info("session-waiting-approval", { session: id });
    await deps.bridge.send(
      session.chat,
      answerText(
        session.claude,
        `waiting for an approval in the session.\n\n↗ ${sessionLink(id)}`,
      ),
      latestAsk(waiting),
    );
  } else if (ended) {
    for (const delivery of waiting) delivery.answered = true;
    if (asked.length > 0)
      await notice(
        id,
        session,
        `⚠️ The session ${status === "failed" ? "failed" : "was archived"} without a reply.`,
        asked,
        deps,
      );
    await lookAway(session.chat, asksOf(waiting), deps);
    return;
  }
  const overdue = waiting.filter(
    (delivery) => deps.now() - delivery.at > deps.giveUpMs,
  );
  if (overdue.length === 0) return;
  for (const delivery of overdue) delivery.answered = true;
  log.info("session-gave-up", { session: id });
  if (overdue.every((delivery) => delivery.interjecting)) return;
  await deps.bridge.send(
    session.chat,
    answerText(
      session.claude,
      `no reply after ${String(Math.round(deps.giveUpMs / 60_000))} minutes; I may still be working.`,
    ),
    latestAsk(overdue),
  );
  await lookAway(session.chat, asksOf(overdue), deps);
}

/**
 * Take tagalong's 👀 off each of these asks that no delivery, in any
 * session, still waits on, once all its Claudes have their deliveries.
 * One a Claude's reaction replaced is left.
 */
export async function lookAway(
  chat: string,
  asks: { id: string; sender: string }[],
  deps: Pick<RelayDeps, "bridge" | "state" | "asking">,
): Promise<void> {
  const { state } = deps.state;
  for (const ask of asks) {
    const key = eyesKey(chat, ask.id);
    if (!state.eyes.includes(key) || deps.asking.has(key)) continue;
    const waited = Object.values(state.sessions).some(
      (session) =>
        session.chat === chat &&
        session.deliveries.some(
          (delivery) => !delivery.answered && delivery.ask?.id === ask.id,
        ),
    );
    if (waited) continue;
    unsee(state, chat, ask.id);
    try {
      await deps.bridge.react(chat, ask, "");
    } catch (error) {
      log.warn("bridge-unreachable", errorFields(error));
    }
  }
}

/**
 * Post what one message from the Claude tagged for the chat, each pair in
 * turn, then the files uploaded with it. A pair the bridge refuses is lost,
 * and the rest still go, so the turn's result still answers its asks.
 */
async function postTagged(
  id: string,
  session: SessionState,
  text: string,
  deps: RelayDeps,
): Promise<void> {
  const { posts, unclosed } = forChat(text);
  if (unclosed) log.warn("session-unclosed-tag", { session: id });
  let posted = false;
  for (const each of posts) {
    try {
      await say(id, session, each, deps);
      posted = true;
    } catch (error) {
      log.warn("bridge-unreachable", errorFields(error));
    }
  }
  if (!posted || deps.files === undefined || session.link === null) return;
  // What the session uploaded with its link since its last message was posted.
  await sendUploads(session.chat, session.link, {
    ...deps.files,
    bridge: deps.bridge,
  });
}

/**
 * One tagged message: a reaction on the line it replies to for one emoji,
 * otherwise a message, a reply to that line while the chat knows it.
 */
async function say(
  id: string,
  session: SessionState,
  post: Post,
  deps: RelayDeps,
): Promise<void> {
  const line =
    post.reply === undefined
      ? undefined
      : messageFor(deps.state.state, session.chat, post.reply);
  const target =
    line === undefined
      ? undefined
      : {
          ...line,
          content: deps.store.message(session.chat, line.id)?.content ?? "",
        };
  if (post.kind === "reaction" && target !== undefined) {
    await deps.bridge.react(session.chat, target, post.text);
    // It replaces tagalong's 👀, if the message had one.
    unsee(deps.state.state, session.chat, target.id);
    log.info("session-relayed", { session: id, reaction: true });
  } else {
    const words = toWhatsApp(post.text);
    const message = words === "" ? "" : answerText(session.claude, words);
    if (message !== "") {
      await deps.bridge.send(session.chat, message, target);
      remember(deps.state.state, deps.store, session.chat, message, id);
    }
    log.info("session-relayed", { session: id, chars: message.length });
  }
}

let polling = false;

/** One pass over the sessions still read, of groups still set up. */
export async function poll(deps: RelayDeps): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    for (const [id, session] of Object.entries(deps.state.state.sessions)) {
      const group = deps.groups.config.groups.get(session.chat);
      // Sessions of a Claude no longer in the group are left alone.
      if (
        !session.waiting ||
        deps.sending.has(id) ||
        group === undefined ||
        (session.claude !== "" && !group.claudes.includes(session.claude))
      )
        continue;
      // An idle interjecting session waits for its next read.
      if (
        !busy(session) &&
        deps.now() < session.readAt &&
        interjecting(id, session, deps)
      )
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
