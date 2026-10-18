// The claude.ai endpoints the Claude Code CLI itself uses: a cloud session's
// record and events (what `claude --teleport` reads), and the cloud
// environments (what `/remote-env` lists). Not documented, so every answer
// goes through a schema (cloud-sessions.md).
import { z } from "zod";
import { fetchJson } from "./http.ts";
import { CommandError } from "./log.ts";

const recordFields = z.looseObject({
  id: z.string().optional(),
  title: z.string().nullable().optional(),
  status: z.string().optional(),
  worker_status: z.string().optional(),
  session_status: z.string().optional(),
  environment_id: z.string().optional(),
  environment_kind: z.string().optional(),
});
const recordSchema = z.looseObject({
  response_shape: recordFields.optional(),
  session: recordFields.optional(),
});

export interface SessionRecord {
  status: string;
  title: string | undefined;
  environmentId: string | undefined;
  environmentKind: string | undefined;
}

const eventsSchema = z.looseObject({
  data: z
    .array(
      z.looseObject({
        sequence_num: z.union([z.number(), z.string()]).optional(),
        payload: z.unknown(),
      }),
    )
    .default([]),
  next_cursor: z.unknown().optional(),
});

const payloadSchema = z.looseObject({
  type: z.string(),
  subtype: z.string().optional(),
  is_error: z.boolean().optional(),
  result: z.unknown().optional(),
  message: z.looseObject({ content: z.unknown() }).optional(),
});
export type Payload = z.infer<typeof payloadSchema>;

const environmentsSchema = z.looseObject({
  environments: z
    .array(
      z.looseObject({
        environment_id: z.string().optional(),
        name: z.string().optional(),
        kind: z.string().optional(),
      }),
    )
    .default([]),
  has_more: z.boolean().optional(),
  last_id: z.string().optional(),
});

export interface Environment {
  id: string;
  name: string;
  kind: string;
}

const textBlock = z.looseObject({ type: z.literal("text"), text: z.string() });

/** A payload's words: a turn's result, or an assistant message's text. */
export function textOf(payload: Payload): string {
  if (payload.type === "result")
    return typeof payload.result === "string" ? payload.result : "";
  if (payload.type !== "assistant") return "";
  const content = payload.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => textBlock.safeParse(block))
    .flatMap((parsed) => (parsed.success ? [parsed.data.text] : []))
    .join("\n");
}

export class ClaudeApi {
  readonly #base: string;
  readonly #token: () => string;
  readonly #org: () => string | undefined;
  #environments: { at: number; list: Environment[] } = { at: 0, list: [] };

  constructor(
    base: string,
    token: () => string,
    org: () => string | undefined,
  ) {
    this.#base = base;
    this.#token = token;
    this.#org = org;
  }

  #headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${this.#token()}`,
      "anthropic-version": "2023-06-01",
      "User-Agent": "tagalong",
      ...extra,
    };
  }

  /** A session's record, its status derived the way the CLI derives it: archived, else the worker's. */
  async record(id: string): Promise<SessionRecord> {
    const raw = await fetchJson(
      "sessions record",
      `${this.#base}/v1/code/sessions/cse_${id}`,
      { headers: this.#headers(), signal: AbortSignal.timeout(30_000) },
      recordSchema,
    );
    const record = raw.response_shape ?? raw.session ?? recordFields.parse(raw);
    return {
      status:
        record.status === "archived"
          ? "archived"
          : (record.worker_status ?? record.session_status ?? "idle"),
      title: record.title ?? undefined,
      environmentId: record.environment_id,
      environmentKind: record.environment_kind,
    };
  }

  /** Events after `cursor` (a sequence number), oldest first. */
  async eventsAfter(
    id: string,
    cursor: string | null,
  ): Promise<{ events: Payload[]; cursor: string | null }> {
    const events: Payload[] = [];
    let next = cursor;
    for (let page = 0; page < 20; page++) {
      const query = new URLSearchParams({
        sort_order: "asc",
        ...(next === null ? {} : { cursor: next }),
      });
      const result = await fetchJson(
        "sessions events",
        `${this.#base}/v1/code/sessions/cse_${id}/events?${query.toString()}`,
        { headers: this.#headers(), signal: AbortSignal.timeout(30_000) },
        eventsSchema,
      );
      for (const event of result.data) {
        if (event.sequence_num !== undefined) next = String(event.sequence_num);
        const payload = payloadSchema.safeParse(event.payload);
        if (payload.success) events.push(payload.data);
      }
      if (result.next_cursor == null || result.data.length === 0) break;
    }
    return { events, cursor: next };
  }

  /** Your cloud environments, as `/remote-env` lists them. Cached for ten minutes. */
  async environments(fresh = false): Promise<Environment[]> {
    if (!fresh && Date.now() - this.#environments.at < 600_000)
      return this.#environments.list;
    const org = this.#org();
    const list: Environment[] = [];
    let after: string | undefined;
    for (let page = 0; page < 10; page++) {
      const query = new URLSearchParams({
        limit: "100",
        ...(after === undefined ? {} : { after_id: after }),
      });
      const result = await fetchJson(
        "environments",
        `${this.#base}/v1/environment_providers?${query.toString()}`,
        {
          headers: this.#headers(
            org === undefined ? {} : { "x-organization-uuid": org },
          ),
          signal: AbortSignal.timeout(15_000),
        },
        environmentsSchema,
      );
      for (const environment of result.environments) {
        if (environment.environment_id !== undefined) {
          list.push({
            id: environment.environment_id,
            name: environment.name ?? "",
            kind: environment.kind ?? "",
          });
        }
      }
      if (
        result.has_more !== true ||
        result.environments.length === 0 ||
        result.last_id === undefined
      )
        break;
      after = result.last_id;
    }
    this.#environments = { at: Date.now(), list };
    return list;
  }

  /** The names known from the last list, for replies. */
  nameOf(id: string): string | undefined {
    const name = this.#environments.list.find(
      (environment) => environment.id === id,
    )?.name;
    return name === "" ? undefined : name;
  }

  label(id: string | undefined): string {
    if (id === undefined) return "your default";
    const name = this.nameOf(id);
    return name === undefined ? id : `${name} (${id})`;
  }

  /** How to write an environment in a command: env=<name>, quoted when it has spaces. */
  token(id: string): string {
    const name = this.nameOf(id);
    if (name === undefined) return id;
    return /\s/u.test(name) ? `env="${name}"` : `env=${name}`;
  }

  /** An environment's env_… id, from its name (any case) or the id itself. */
  async resolve(nameOrId: string): Promise<string> {
    if (/^env_\w+$/u.test(nameOrId)) return nameOrId;
    const list = await this.environments(true);
    const hits = list.filter(
      (environment) =>
        environment.name.toLowerCase() === nameOrId.toLowerCase(),
    );
    const [hit] = hits;
    if (hits.length === 1 && hit !== undefined) return hit.id;
    if (hits.length > 1)
      throw new CommandError(
        `more than one environment is called "${nameOrId}"; use its env_… id`,
      );
    const names = list
      .map((environment) => environment.name)
      .filter((name) => name !== "");
    throw new CommandError(
      `no environment called "${nameOrId}". Yours: ${names.join(", ") || "none found"}`,
    );
  }
}
