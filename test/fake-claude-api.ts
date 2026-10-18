// The claude.ai sessions and environments endpoints, on loopback
// (cloud-sessions.md). A test adds sessions and their events.
import { type Served, serve } from "./serve.ts";

export const ACCESS_TOKEN = "access-token-for-tests";

export interface FakeSession {
  status: string;
  environmentId: string;
  events: unknown[];
}

export interface FakeClaudeApi {
  url: string;
  served: Served;
  sessions: Map<string, FakeSession>;
  environments: { environment_id: string; name: string; kind: string }[];
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

export async function fakeClaudeApi(): Promise<FakeClaudeApi> {
  const sessions = new Map<string, FakeSession>();
  const environments: FakeClaudeApi["environments"] = [];
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
    if (match[2] === undefined)
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
    const after = Number(request.query.get("cursor") ?? "0");
    const data = session.events
      .map((payload, index) => ({ sequence_num: index + 1, payload }))
      .filter((event) => event.sequence_num > after);
    return { body: { data, next_cursor: null } };
  });
  return {
    url: served.url,
    served,
    sessions,
    environments,
    close: () => served.close(),
  };
}
