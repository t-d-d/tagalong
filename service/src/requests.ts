// A message that asks one or more Claudes. Each Claude keeps one running
// session in the group (cloud-sessions.md): a turn is sent into it with what
// was said since that Claude's last turn, or, when it has none or it is gone,
// a new session starts with the last messages here.
import type { Aws } from "./aws.ts";
import { pickMedia, shareMedia, type Attachment } from "./attachments.ts";
import type { Bridge } from "./bridge.ts";
import type { ClaudeApi } from "./claude-api.ts";
import type { Cloud } from "./cloud.ts";
import type { Env } from "./env.ts";
import { oneLine } from "./format.ts";
import type { Claude, Group, GroupsStore } from "./groups.ts";
import { errorFields, log } from "./log.ts";
import type { People } from "./people.ts";
import {
  type Ask,
  answerBy,
  conversation,
  firstPrompt,
  followUp,
} from "./prompts.ts";
import { sessionFor } from "./replies.ts";
import type { Serial } from "./run.ts";
import { type StateStore, threadKey } from "./state.ts";
import { type WhatsAppStore, timeOf } from "./store.ts";
import type { Payload } from "./webhook.ts";

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
  for (const claude of claudes) {
    recent.push(now);
    await turn(payload, claude, group, deps);
  }
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
  const thread = deps.state.state.threads[key] ?? { session: null, heard: 0 };
  const row = deps.store.message(chat, payload.messageId);
  const at = row === undefined ? now : timeOf(row.timestamp);
  const request = {
    id: payload.messageId,
    sender: payload.sender,
    content: payload.content,
  };
  const lines = {
    store: deps.store,
    people: deps.people,
    config: deps.groups.config,
    group,
    claude: claude.name,
    except: payload.messageId,
  };
  const ask: Ask = {
    from: deps.people.nameOf(payload.sender),
    text: deps.people.readable(payload.content).trim(),
    quoted: quotedOf(payload, deps),
    files: await files(payload, group, claude.name, deps),
  };
  const waitFor = (session: string) => {
    const state = deps.state.state.sessions[session];
    if (state !== undefined)
      Object.assign(state, {
        request,
        waiting: true,
        since: now,
        nudged: false,
      });
    deps.state.state.threads[key] = { session, heard: at };
    deps.state.save();
  };

  const existing =
    thread.session === null
      ? undefined
      : deps.state.state.sessions[thread.session];
  if (thread.session !== null && existing !== undefined) {
    const id = thread.session;
    // Everything said since this Claude's last turn, not only the last few.
    const said = conversation(lines, thread.heard, deps.env.HISTORY * 3);
    const sent = await deps.cli.run(() =>
      deps.cloud.send(id, followUp(claude.name, said, ask)),
    );
    if (sent === "sent") {
      waitFor(id);
      log.info("session-followup", {
        session: id,
        group: group.label,
        claude: claude.name,
        files: ask.files.length,
      });
      return;
    }
    // podstow archives a session that signs off; carry on in a fresh one.
    log.info("session-gone", { session: id, claude: claude.name });
    existing.waiting = false;
  }

  const prompt = firstPrompt({
    claude,
    chatName: deps.store.chatName(chat) ?? group.label,
    others: group.claudes.filter((other) => other !== claude.name),
    conversation: conversation(lines, 0, deps.env.HISTORY),
    ask,
  });
  const name = `WhatsApp ${claude.name}: ${oneLine(ask.text.replace(/@[a-z][a-z0-9-]*\b/giu, "")).slice(0, 50)}`;
  const id = await deps.cli.run(() => deps.cloud.start(claude, prompt, name));
  deps.state.state.sessions[id] = {
    chat,
    claude: claude.name,
    request,
    cursor: null,
    waiting: true,
    since: now,
    nudged: false,
    lastText: "",
  };
  waitFor(id);
  log.info("session-started", {
    session: id,
    group: group.label,
    claude: claude.name,
    access: claude.access,
    files: ask.files.length,
  });
  await verify(id, claude, deps.api);
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
