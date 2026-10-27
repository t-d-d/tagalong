// The claude.ai sessions and environments endpoints, on loopback
// (cloud-sessions.md). A test adds sessions and their events. Each message
// delivered to a session lands as a user event with a uuid, and a result
// lists the user messages since the one before, as the CLI's results do.
import { z } from "zod";
import { type Served, serve } from "./serve.ts";

export const ACCESS_TOKEN = "access-token-for-tests";

export interface FakeSession {
  status: string;
  environmentId: string;
  events: unknown[];
  /** What the session does after each message delivered to it, in order. */
  replies?: unknown[][];
  /** Called each time the session's status is read, before it is answered. */
  onStatus?: () => void;
}

export interface FakeClaudeApi {
  url: string;
  served: Served;
  sessions: Map<string, FakeSession>;
  environments: { environment_id: string; name: string; kind: string }[];
  /** A message sent into a session, by the launcher or `claude -p --cloud`. */
  deliver(id: string, text: string): void;
  close(): Promise<void>;
}

export const result = (text: string) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  result: text,
});
export const assistant = (text: string) => ({
  type: "assistant",
  message: { content: [{ type: "text", text }] },
});
/** A message given in the session from elsewhere, such as Claude Desktop. */
export const user = (text: string, uuid: string) => ({
  type: "user",
  uuid,
  message: { content: text },
});
/** The result of a turn the session started by itself, when background work finished. */
export const selfStarted = (text: string) => ({
  ...result(text),
  user_message_uuids: [],
  origin: { kind: "task-notification" },
});

const eventShape = z.looseObject({
  type: z.string().optional(),
  uuid: z.string().optional(),
});

/** Each result without its own list gets the user messages since the one before. */
function listed(events: unknown[]): unknown[] {
  let since: string[] = [];
  return events.map((payload) => {
    const event = eventShape.safeParse(payload);
    if (!event.success) return payload;
    if (event.data.type === "user" && event.data.uuid !== undefined)
      since.push(event.data.uuid);
    if (event.data.type !== "result") return payload;
    const filled =
      "user_message_uuids" in event.data
        ? payload
        : { ...event.data, user_message_uuids: since };
    since = [];
    return filled;
  });
}

export async function fakeClaudeApi(): Promise<FakeClaudeApi> {
  const sessions = new Map<string, FakeSession>();
  const environments: FakeClaudeApi["environments"] = [];
  let delivered = 0;
  const served = await serve((request) => {
    if (request.headers.authorization !== `Bearer ${ACCESS_TOKEN}`)
      return { status: 401 };
    if (request.path === "/v1/environment_providers")
      return { body: { environments, has_more: false } };
    const match = /^\/v1\/code\/sessions\/cse_(\w+)(\/events)?$/u.exec(
      request.path,
    );
    const session =
      match?.[1] === undefined ? undefined : sessions.get(match[1]);
    if (match === null || session === undefined)
      return { status: 404, body: { error: "not found" } };
    if (match[2] === undefined) {
      session.onStatus?.();
      return {
        body: {
          response_shape: {
            id: `cse_${match[1] ?? ""}`,
            status: session.status === "archived" ? "archived" : "active",
            worker_status: session.status,
            environment_id: session.environmentId,
            environment_kind: "anthropic_cloud",
          },
        },
      };
    }
    const after = Number(request.query.get("cursor") ?? "0");
    const data = listed(session.events)
      .map((payload, index) => ({ sequence_num: index + 1, payload }))
      .filter((event) => event.sequence_num > after);
    return { body: { data, next_cursor: null } };
  });
  return {
    url: served.url,
    served,
    sessions,
    environments,
    deliver(id, text) {
      const session = sessions.get(id);
      if (session === undefined) return;
      delivered += 1;
      session.events.push(user(text, `u${String(delivered)}`));
      session.events.push(...(session.replies?.shift() ?? []));
    },
    close: () => served.close(),
  };
}
