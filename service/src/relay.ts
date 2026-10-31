// Reading a Claude's session and posting what it says to its chat
// (cloud-sessions.md). A session is read from its first delivery until it has
// had no delivery and no result for GIVE_UP_MS. Every result is posted unless
// it answers only messages given from elsewhere, such as Claude Desktop.
import type { Aws } from "./aws.ts";
import type { Bridge, Quote } from "./bridge.ts";
import { type ClaudeApi, textOf } from "./claude-api.ts";
import { sessionLink, toWhatsApp } from "./format.ts";
import type { GroupsStore } from "./groups.ts";
import { errorFields, log } from "./log.ts";
import {
  type Reading,
  answering,
  busy,
  heard,
  messageFor,
  readAnswer,
} from "./mailbox.ts";
import { sendUploads } from "./outgoing.ts";
import { answerText } from "./prompts.ts";
import { remember } from "./replies.ts";
import {
  type Delivery,
  type SessionState,
  type StateStore,
  eyesKey,
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

/** Look at one session; post what each turn that ended says. */
export async function check(
  id: string,
  session: SessionState,
  deps: RelayDeps,
): Promise<void> {
  const { events, cursor } = await deps.api.eventsAfter(id, session.cursor);
  session.cursor = cursor;
  const ended: { text: string; uuids: string[]; failed: boolean }[] = [];
  let lastText = session.lastText;
  for (const event of events) {
    const text = textOf(event);
    if (event.type === "user" && event.uuid !== undefined && text !== "")
      heard(session, event.uuid, text);
    if (event.type === "assistant" && text !== "") lastText = text;
    if (event.type === "result") {
      const failed =
        event.is_error === true ||
        (event.subtype !== undefined && event.subtype !== "success");
      ended.push({
        text: failed
          ? `⚠️ The session stopped with an error (${event.subtype ?? "error"}).`
          : text || lastText,
        uuids: event.user_message_uuids ?? [],
        failed,
      });
      lastText = "";
    }
  }
  session.lastText = lastText;
  for (const turn of ended) {
    const answers = answering(session, turn.uuids);
    // Nobody waits on an interjecting delivery, so its failure is not told.
    if (
      answers !== null &&
      turn.failed &&
      answers.length > 0 &&
      answers.every((delivery) => delivery.interjecting)
    ) {
      for (const delivery of answers) delivery.answered = true;
      continue;
    }
    if (answers !== null) {
      await post(id, session, turn.text, answers, deps);
      continue;
    }
    // Suspect while a delivery of ours has not been seen in the session:
    // the result may be its answer, under a uuid tagalong failed to read.
    const unseen = session.deliveries.filter(
      (delivery) => !delivery.answered && delivery.uuid === null,
    ).length;
    if (unseen > 0) log.warn("session-elsewhere", { session: id, unseen });
    else log.info("session-elsewhere", { session: id });
  }
  if (ended.length > 0) session.since = deps.now();
  else if (busy(session)) await waitOn(id, session, deps);
  const now = deps.now();
  if (!busy(session) && now - session.since > deps.giveUpMs)
    session.waiting = false;
  // Every delivery still waiting is kept, and the latest answered ones, so
  // a late answer to one given up on still finds it.
  const answered = session.deliveries.filter((delivery) => delivery.answered);
  const old = new Set(answered.slice(0, -KEPT));
  session.deliveries = session.deliveries.filter(
    (delivery) => !old.has(delivery),
  );
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
  // that result is the answer, read on the next look.
  if (
    (ended || (status === "idle" && session.lastText !== "")) &&
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
  } else if ((ended || status === "idle") && session.lastText !== "") {
    // The turn ended with no result event: its last words.
    const words = session.lastText;
    session.lastText = "";
    session.since = deps.now();
    await post(id, session, words, waiting, deps);
    return;
  } else if (ended && asked.length === 0) {
    for (const delivery of waiting) delivery.answered = true;
    return;
  } else if (ended) {
    await post(
      id,
      session,
      `⚠️ The session ${status === "failed" ? "failed" : "was archived"} without a reply.`,
      waiting,
      deps,
    );
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

/** Post a turn's answer to `answers`, then take the 👀 off what it answered. */
async function post(
  id: string,
  session: SessionState,
  text: string,
  answers: Delivery[],
  deps: RelayDeps,
): Promise<void> {
  for (const delivery of answers) delivery.answered = true;
  const reading = readAnswer(text);
  if (reading.kind === "pass") log.info("session-passed", { session: id });
  else await say(id, session, reading, answers, deps);
  // An answer that could not be posted leaves the 👀: it has none in the chat.
  await lookAway(session.chat, asksOf(answers), deps);
}

/**
 * A reaction for one emoji, otherwise a message. It goes on the line a label
 * at its start names, or else the latest ask it answers; with neither it
 * stands alone. Then the files uploaded with it.
 */
async function say(
  id: string,
  session: SessionState,
  reading: Reading,
  answers: Delivery[],
  deps: RelayDeps,
): Promise<void> {
  const line =
    reading.label === undefined
      ? undefined
      : messageFor(deps.state.state, session.chat, reading.label);
  const target =
    line === undefined
      ? latestAsk(answers)
      : {
          ...line,
          content: deps.store.message(session.chat, line.id)?.content ?? "",
        };
  if (reading.kind === "reaction" && target !== undefined) {
    await deps.bridge.react(session.chat, target, reading.text);
    // It replaces tagalong's 👀, if the message had one.
    unsee(deps.state.state, session.chat, target.id);
    log.info("session-relayed", { session: id, reaction: true });
  } else {
    const words = toWhatsApp(reading.text);
    const message = words === "" ? "" : answerText(session.claude, words);
    if (message !== "") {
      await deps.bridge.send(session.chat, message, target);
      remember(deps.state.state, deps.store, session.chat, message, id);
    }
    log.info("session-relayed", { session: id, chars: message.length });
  }
  if (deps.files === undefined || session.link === null) return;
  // What the session uploaded with its link since its last answer was posted.
  await sendUploads(session.chat, session.link, {
    ...deps.files,
    bridge: deps.bridge,
  });
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
