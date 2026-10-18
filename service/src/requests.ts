// A request from a group: start a session, or carry on the one a reply names.
import type { Aws } from "./aws.ts";
import { pickMedia, shareMedia, type Attachment } from "./attachments.ts";
import type { Bridge } from "./bridge.ts";
import type { ClaudeApi } from "./claude-api.ts";
import type { Cloud } from "./cloud.ts";
import type { Env } from "./env.ts";
import { oneLine } from "./format.ts";
import type { Group, GroupsStore } from "./groups.ts";
import { errorFields, log } from "./log.ts";
import type { People } from "./people.ts";
import { firstPrompt, followUp, transcript } from "./prompts.ts";
import { sessionFor } from "./replies.ts";
import type { Serial } from "./run.ts";
import type { StateStore } from "./state.ts";
import type { WhatsAppStore } from "./store.ts";
import type { Payload, Trigger } from "./webhook.ts";

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
  /** When each request in the last hour arrived, for the hourly cap. */
  recent: number[];
}

/** The session a reply belongs to: the one linked in the Claude message it quotes, in this chat. */
export function sessionOf(
  payload: Payload,
  deps: Pick<RequestDeps, "store" | "state">,
): string | null {
  if (payload.quotedIsFromMe === false) return null;
  const quoted =
    payload.quotedContent ??
    deps.store.message(payload.chatJID, payload.quotedMessageId)?.content;
  const id = sessionFor(deps.state.state, payload.quotedMessageId, quoted);
  return id !== null && deps.state.state.sessions[id]?.chat === payload.chatJID
    ? id
    : null;
}

async function files(
  payload: Payload,
  group: Group,
  deps: RequestDeps,
): Promise<Attachment[]> {
  const bucket = deps.env.ATTACHMENTS_BUCKET;
  if (bucket === undefined || deps.aws === undefined) return [];
  const rows = pickMedia({
    config: deps.groups.config,
    group,
    people: deps.people,
    store: deps.store,
    chat: payload.chatJID,
    messageId: payload.messageId,
    quotedMessageId: payload.quotedMessageId,
    sent: new Set(deps.state.state.sentMedia),
    now: deps.now(),
  });
  if (rows.length === 0) return [];
  deps.state.state.sentMedia.push(...rows.map((row) => row.id));
  return shareMedia(rows, {
    bridge: deps.bridge,
    aws: deps.aws,
    bucket,
    chat: payload.chatJID,
  });
}

export async function handleRequest(
  payload: Payload,
  why: Trigger,
  group: Group,
  deps: RequestDeps,
): Promise<void> {
  const now = deps.now();
  const { recent } = deps;
  while (recent.length > 0 && now - (recent[0] ?? 0) > 3_600_000)
    recent.shift();
  const message = { id: payload.messageId, sender: payload.sender };
  const request = { ...message, content: payload.content };
  if (recent.length >= deps.env.MAX_PER_HOUR) {
    log.info("request-capped", {
      group: group.label,
      cap: deps.env.MAX_PER_HOUR,
    });
    await deps.bridge.react(payload.chatJID, message, "⏳");
    return;
  }
  recent.push(now);

  const text = deps.people.readable(payload.content).trim();
  const existing = sessionOf(payload, deps);
  if (deps.env.DRY_RUN) {
    log.info("request-ignored", {
      why: "dry-run",
      trigger: why,
      followUp: existing !== null,
    });
    return;
  }

  await deps.bridge.react(payload.chatJID, message, "👀");
  const attached = await files(payload, group, deps);
  const from = deps.people.nameOf(payload.sender);

  if (existing !== null) {
    const sent = await deps.cli.run(() =>
      deps.cloud.send(existing, followUp(from, text, attached)),
    );
    const session = deps.state.state.sessions[existing];
    if (sent === "sent" && session !== undefined) {
      Object.assign(session, {
        request,
        waiting: true,
        since: now,
        nudged: false,
      });
      deps.state.save();
      log.info("session-followup", {
        session: existing,
        group: group.label,
        files: attached.length,
      });
      return;
    }
    // podstow archives a session that signs off; carry on in a fresh one.
    log.info("session-gone", { session: existing });
    if (session !== undefined) session.waiting = false;
  }

  const prompt = firstPrompt({
    group,
    chatName: deps.store.chatName(payload.chatJID) ?? group.label,
    from,
    text,
    transcript: transcript(
      deps.store,
      deps.people,
      deps.groups.config,
      group,
      deps.env.HISTORY,
    ),
    files: attached,
  });
  const name = `WhatsApp: ${oneLine(text.replace(/@claude\b/giu, "")).slice(0, 60)}`;
  const id = await deps.cli.run(() => deps.cloud.start(group, prompt, name));
  deps.state.state.sessions[id] = {
    chat: payload.chatJID,
    request,
    cursor: null,
    waiting: true,
    since: now,
    nudged: false,
    lastText: "",
  };
  deps.state.save();
  log.info("session-started", {
    session: id,
    group: group.label,
    access: group.access,
    files: attached.length,
  });
  await verify(id, group, deps.api);
}

/** Say loudly when a session landed in another environment than the group's. */
async function verify(id: string, group: Group, api: ClaudeApi): Promise<void> {
  if (group.environment === undefined) return;
  try {
    const record = await api.record(id);
    if (record.environmentId !== group.environment) {
      log.warn("session-environment-mismatch", {
        session: id,
        expected: group.environment,
        actual: record.environmentId ?? "unknown",
      });
    }
  } catch (error) {
    log.warn("session-poll-failed", { session: id, ...errorFields(error) });
  }
}
