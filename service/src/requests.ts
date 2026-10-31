// A message that asks one or more Claudes. Each Claude keeps one running
// session in the group (cloud-sessions.md): a message goes into it straight
// away, working or not, with what was said since that Claude's last one, or,
// when it has none or it is gone, a new session starts with the last messages
// here.
import type { Aws } from "./aws.ts";
import { pickMedia, shareMedia, type Attachment } from "./attachments.ts";
import type { Bridge } from "./bridge.ts";
import type { ClaudeApi } from "./claude-api.ts";
import type { Cloud } from "./cloud.ts";
import type { Env } from "./env.ts";
import { oneLine } from "./format.ts";
import {
  type Claude,
  type Group,
  type GroupsStore,
  versionOf,
} from "./groups.ts";
import { errorFields, log } from "./log.ts";
import { deliveryOf, labelFor } from "./mailbox.ts";
import type { People } from "./people.ts";
import {
  type Ask,
  answerBy,
  bodyOf,
  conversation,
  firstPrompt,
  followUp,
} from "./prompts.ts";
import { OUTGOING, keepLink, newLinkId } from "./outgoing.ts";
import { lookAway } from "./relay.ts";
import { sessionFor } from "./replies.ts";
import type { Serial } from "./run.ts";
import {
  type Link,
  type SessionState,
  type StateStore,
  eyesKey,
  threadKey,
} from "./state.ts";
import { type WhatsAppStore, timeOf } from "./store.ts";
import type { Payload } from "./webhook.ts";

/** The most of an old session's dialogue a new one is given, in characters. */
export const CARRY_LIMIT = 60_000;

export interface RequestDeps {
  env: Env;
  groups: GroupsStore;
  people: People;
  store: WhatsAppStore;
  bridge: Bridge;
  cloud: Cloud;
  api: ClaudeApi;
  state: StateStore;
  aws: Aws | undefined;
  cli: Serial;
  now: () => number;
  /** When each turn in the last hour started, for the hourly cap. */
  recent: number[];
  /** Sessions with a message on its way in, which the relay leaves alone. */
  sending: Set<string>;
  /** Requests, by eyesKey, still being delivered to their Claudes. */
  asking: Set<string>;
}

/** The Claude whose answer `payload` replies to, if it replies to one in this chat. */
export function repliedTo(
  payload: Payload,
  deps: Pick<RequestDeps, "store" | "state">,
): string | undefined {
  if (payload.quotedIsFromMe !== true) return undefined;
  const quoted =
    payload.quotedContent ??
    deps.store.message(payload.chatJID, payload.quotedMessageId)?.content;
  const id = sessionFor(deps.state.state, payload.quotedMessageId, quoted);
  const session = id === null ? undefined : deps.state.state.sessions[id];
  if (
    session !== undefined &&
    session.chat === payload.chatJID &&
    session.claude !== ""
  )
    return session.claude;
  return quoted === undefined ? undefined : answerBy(quoted);
}

async function files(
  payload: Payload,
  group: Group,
  claude: string,
  deps: RequestDeps,
): Promise<Attachment[]> {
  const bucket = deps.env.ATTACHMENTS_BUCKET;
  if (bucket === undefined || deps.aws === undefined) return [];
  // A file goes once to each Claude.
  const key = (id: string) => `${claude}:${id}`;
  const given = new Set(deps.state.state.sentMedia);
  const rows = pickMedia({
    config: deps.groups.config,
    group,
    claude,
    people: deps.people,
    store: deps.store,
    chat: payload.chatJID,
    messageId: payload.messageId,
    quotedMessageId: payload.quotedMessageId,
    sent: { has: (id: string) => given.has(key(id)) },
    now: deps.now(),
  });
  if (rows.length === 0) return [];
  deps.state.state.sentMedia.push(...rows.map((row) => key(row.id)));
  return shareMedia(rows, {
    bridge: deps.bridge,
    aws: deps.aws,
    bucket,
    chat: payload.chatJID,
  });
}

/**
 * A session's upload link, made if it has none, kept working for the next
 * OUTGOING.linkSeconds (outgoing.ts). Null without a bucket or a link to
 * give, or when its marker cannot be written.
 */
async function keptLink(
  link: Link | null,
  deps: RequestDeps,
): Promise<Link | null> {
  const bucket = deps.env.ATTACHMENTS_BUCKET;
  if (
    bucket === undefined ||
    deps.aws === undefined ||
    deps.env.UPLOAD_LINK === undefined
  )
    return null;
  const kept = link ?? { id: newLinkId(), given: 0, sent: [] };
  try {
    await keepLink(deps.aws, bucket, kept.id);
    return kept;
  } catch (error) {
    log.warn("file-skipped", { why: "no-upload", ...errorFields(error) });
    return null;
  }
}

/** The ask with the session's link, if the session has not been given it for a while. */
function withLink(
  ask: Ask,
  link: Link | null,
  now: number,
  deps: RequestDeps,
): Ask {
  if (
    link === null ||
    deps.env.UPLOAD_LINK === undefined ||
    now - link.given <= OUTGOING.linkSeconds * 1000
  )
    return ask;
  return { ...ask, upload: `${deps.env.UPLOAD_LINK}${link.id}/` };
}

/** What the request quotes, as the Claude will read it. */
function quotedOf(payload: Payload, deps: RequestDeps): Ask["quoted"] {
  if (
    payload.quotedMessageId === undefined &&
    payload.quotedContent === undefined
  )
    return undefined;
  const row = deps.store.message(payload.chatJID, payload.quotedMessageId);
  const text = payload.quotedContent ?? row?.content ?? "";
  if (text === "") return undefined;
  const by = answerBy(text);
  const who =
    payload.quotedIsFromMe === true
      ? by === undefined
        ? "tagalong"
        : `@${by}`
      : deps.people.nameOf(payload.quotedSender ?? row?.sender ?? "");
  return {
    who,
    text: deps.people.readable(text.replace(/^\*[a-z0-9-]+:\*\s?/u, "")),
  };
}

export async function handleRequest(
  payload: Payload,
  claudes: Claude[],
  group: Group,
  deps: RequestDeps,
): Promise<void> {
  const now = deps.now();
  const { recent } = deps;
  while (recent.length > 0 && now - (recent[0] ?? 0) > 3_600_000)
    recent.shift();
  const message = { id: payload.messageId, sender: payload.sender };
  const room = deps.env.MAX_PER_HOUR - recent.length;
  if (room < claudes.length) {
    log.info("request-capped", {
      group: group.label,
      cap: deps.env.MAX_PER_HOUR,
    });
    await deps.bridge.react(payload.chatJID, message, "⏳");
    return;
  }
  if (deps.env.DRY_RUN) {
    log.info("request-ignored", { why: "dry-run", claudes: claudes.length });
    return;
  }
  await deps.bridge.react(payload.chatJID, message, "👀");
  const eyes = eyesKey(payload.chatJID, message.id);
  deps.state.state.eyes.push(eyes);
  // An answer that comes before every Claude has its delivery leaves the 👀.
  deps.asking.add(eyes);
  try {
    for (const claude of claudes) {
      recent.push(now);
      await turn(payload, claude, group, deps);
    }
  } finally {
    deps.asking.delete(eyes);
  }
  // Each Claude may have answered already.
  await lookAway(payload.chatJID, [message], deps);
}

/** One Claude's turn: into its running session, or a new one. */
async function turn(
  payload: Payload,
  claude: Claude,
  group: Group,
  deps: RequestDeps,
): Promise<void> {
  const chat = payload.chatJID;
  const now = deps.now();
  const key = threadKey(chat, claude.name);
  const thread = deps.state.state.threads[key] ?? {
    session: null,
    heard: 0,
    version: "",
    carry: null,
  };
  const row = deps.store.message(chat, payload.messageId);
  const at = row === undefined ? now : timeOf(row.timestamp);
  const request = {
    id: payload.messageId,
    sender: payload.sender,
    content: payload.content,
  };
  // The CLI starts a session whose environment is not in the list in another
  // one, so a Claude whose environment is gone starts nothing (#22).
  const environmentGone = async (): Promise<boolean> => {
    if (claude.environment === undefined) return false;
    if (await deps.api.exists(claude.environment)) return false;
    log.warn("session-environment-gone", {
      group: group.label,
      claude: claude.name,
    });
    await deps.bridge.send(
      chat,
      `@${claude.name}'s environment is gone, so it can't start. An owner must define it again: \`@claude define ${claude.name} env=<name>\``,
      request,
    );
    return true;
  };
  const existing =
    thread.session === null
      ? undefined
      : deps.state.state.sessions[thread.session];
  // Checked before its files are taken, so they wait for the session that
  // starts once it is defined again.
  if (existing === undefined && (await environmentGone())) return;
  const label = (message: { id: string; sender: string }) =>
    labelFor(deps.state.state, chat, message);
  const lines = {
    store: deps.store,
    people: deps.people,
    config: deps.groups.config,
    group,
    claude: claude.name,
    except: payload.messageId,
    label,
  };
  // Labelled once the lines before it are, so labels run in order.
  const ask: Ask = {
    label: "",
    from: deps.people.nameOf(payload.sender),
    // A voice note with no text reads as its type, as in the conversation.
    text: bodyOf(
      deps.people.readable(payload.content),
      payload.mediaType ?? "",
    ),
    quoted: quotedOf(payload, deps),
    files: await files(payload, group, claude.name, deps),
  };
  const delivered = (
    session: SessionState,
    id: string,
    version: string,
    link: { kept: Link | null; given: boolean },
  ) => {
    Object.assign(session, { waiting: true, since: now, nudged: false });
    if (link.kept !== null) {
      session.link = link.kept;
      if (link.given) link.kept.given = now;
    }
    deps.state.state.threads[key] = {
      session: id,
      heard: at,
      version,
      carry: null,
    };
    deps.state.save();
  };

  if (thread.session !== null && existing !== undefined) {
    const id = thread.session;
    // Everything said since this Claude's last message, not only the last few.
    const said = conversation(lines, thread.heard, deps.env.HISTORY * 3);
    ask.label = label(request);
    const kept = await keptLink(existing.link, deps);
    const told = withLink(ask, kept, now, deps);
    const text = followUp(claude.name, said, told);
    // Noted before it goes, so its user event is known however soon it is read.
    const delivery = deliveryOf(text, request, now);
    const drop = () => {
      existing.deliveries = existing.deliveries.filter(
        (each) => each !== delivery,
      );
    };
    existing.deliveries.push(delivery);
    deps.state.save();
    // Until the CLI says it is in, the session may read as archived because
    // it is: the message then goes to a new session, not a warning.
    deps.sending.add(id);
    let sent: "sent" | "gone";
    try {
      sent = await deps.cli.run(() => deps.cloud.send(id, text));
    } catch (error) {
      drop();
      throw error;
    } finally {
      deps.sending.delete(id);
    }
    if (sent === "sent") {
      delivered(existing, id, thread.version, {
        kept,
        given: told.upload !== undefined,
      });
      log.info("session-followup", {
        session: id,
        group: group.label,
        claude: claude.name,
        files: ask.files.length,
      });
      return;
    }
    // podstow archives a session that signs off; carry on in a fresh one,
    // with the conversation carried over.
    log.info("session-gone", { session: id, claude: claude.name });
    drop();
    existing.waiting = false;
    thread.carry = id;
    // Kept, so the session that starts once it is defined again carries it.
    deps.state.save();
    if (await environmentGone()) return;
  }

  // A new session: after an update or a gone one, with the old session's
  // dialogue and everything said since; otherwise the last messages here.
  const carried =
    thread.carry === null ? "" : await dialogueOf(thread.carry, deps.api);
  const said =
    carried === ""
      ? conversation(lines, 0, deps.env.HISTORY)
      : conversation(lines, thread.heard, deps.env.HISTORY * 3);
  ask.label = label(request);
  // A session that carries on a conversation keeps its link, which the
  // carried dialogue shows; either way the first prompt gives it.
  const before =
    thread.carry === null
      ? undefined
      : deps.state.state.sessions[thread.carry]?.link;
  const kept = await keptLink(
    before === undefined || before === null
      ? null
      : { id: before.id, given: 0, sent: [...before.sent] },
    deps,
  );
  const told = withLink(ask, kept, now, deps);
  const prompt = firstPrompt({
    claude,
    chatName: deps.store.chatName(chat) ?? group.label,
    others: group.claudes.filter((other) => other !== claude.name),
    carried,
    conversation: said,
    ask: told,
  });
  const name = `WhatsApp ${claude.name}: ${oneLine(ask.text.replace(/@[a-z][a-z0-9-]*\b/giu, "")).slice(0, 50)}`;
  const id = await deps.cli.run(() => deps.cloud.start(claude, prompt, name));
  const session: SessionState = {
    chat,
    claude: claude.name,
    cursor: null,
    waiting: true,
    since: now,
    nudged: false,
    lastText: "",
    deliveries: [deliveryOf(prompt, request, now)],
    link: null,
  };
  deps.state.state.sessions[id] = session;
  delivered(session, id, versionOf(claude), {
    kept,
    given: told.upload !== undefined,
  });
  log.info("session-started", {
    session: id,
    group: group.label,
    claude: claude.name,
    access: claude.access,
    carried: carried !== "",
    files: ask.files.length,
  });
  await verify(id, claude, deps.api);
}

/** The dialogue of a session being replaced; empty, and logged, if it cannot be read. */
async function dialogueOf(id: string, api: ClaudeApi): Promise<string> {
  try {
    return await api.dialogue(id, CARRY_LIMIT);
  } catch (error) {
    log.warn("session-poll-failed", { session: id, ...errorFields(error) });
    return "";
  }
}

/** Say loudly when a session landed in another environment than its Claude's. */
async function verify(
  id: string,
  claude: Claude,
  api: ClaudeApi,
): Promise<void> {
  if (claude.environment === undefined) return;
  try {
    const record = await api.record(id);
    if (record.environmentId !== claude.environment) {
      log.warn("session-environment-mismatch", {
        session: id,
        expected: claude.environment,
        actual: record.environmentId ?? "unknown",
      });
    }
  } catch (error) {
    log.warn("session-poll-failed", { session: id, ...errorFields(error) });
  }
}
