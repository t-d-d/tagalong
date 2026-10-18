// The whole service, wired by createApp, against loopback fakes: the
// bridge's databases in a temporary folder, the bridge's API, the sessions
// API, the launcher and CLI, and AWS in memory.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { type App, createApp } from "../service/src/app.ts";
import type { Env } from "../service/src/env.ts";
import { type GroupsFile, fileSchema } from "../service/src/groups.ts";
import { type Payload, payloadSchema } from "../service/src/webhook.ts";
import {
  type BridgeDb,
  CLAUDE,
  GROUP,
  MEMBER,
  OWNER,
  standardDb,
} from "./bridge-db.ts";
import { type FakeAws, fakeAws } from "./fake-aws.ts";
import { type FakeBridge, fakeBridge } from "./fake-bridge.ts";
import { type FakeClaudeApi, fakeClaudeApi } from "./fake-claude-api.ts";
import { type FakeRun, fakeRun } from "./fake-run.ts";
import { type Line, logLines } from "./log-lines.ts";
import { serviceEnv } from "./service-env.ts";

export const NOW = Date.parse("2026-10-18T17:00:00Z");

export const standardGroups: GroupsFile = {
  groups: {
    [GROUP]: {
      label: "Side projects",
      repo: "o/r",
      environment: "env_fake1",
      access: "read-write",
      members: [MEMBER],
    },
  },
};

export interface Harness {
  app: App;
  env: Env;
  db: BridgeDb;
  bridge: FakeBridge;
  api: FakeClaudeApi;
  aws: FakeAws;
  fake: FakeRun;
  lines: Line[];
  raw: string[];
  clock: { now: number };
  /** Hand the app a message the way the bridge's webhook would, and wait for what it starts. */
  deliver(fields: Record<string, unknown>): Promise<void>;
  groupsFile(): GroupsFile;
  stateFile(): unknown;
  close(): Promise<void>;
}

export async function harness(
  options: {
    env?: Record<string, string>;
    groups?: GroupsFile;
    db?: (db: BridgeDb) => void;
  } = {},
): Promise<Harness> {
  const { lines, raw } = logLines();
  const clock = { now: NOW };
  const db = standardDb(NOW);
  options.db?.(db);
  // The bridge stores what it sends, with the id WhatsApp gave it.
  let sentCount = 0;
  const bridge = await fakeBridge(db.store, ({ recipient, message }) => {
    sentCount += 1;
    const id = `sent-${String(sentCount)}`;
    db.message({
      id,
      chat: recipient,
      sender: CLAUDE,
      content: message,
      at: clock.now,
      fromMe: true,
    });
    return id;
  });
  const api = await fakeClaudeApi();
  api.environments.push(
    {
      environment_id: "env_fake1",
      name: "Default Full",
      kind: "anthropic_cloud",
    },
    { environment_id: "env_fake2", name: "spare", kind: "anthropic_cloud" },
  );
  const aws = fakeAws();
  const env = serviceEnv(db.store, {
    BRIDGE_URL: bridge.url,
    CLAUDE_API_BASE: api.url,
    OWNERS: OWNER,
    ...options.env,
  });
  writeFileSync(
    env.GROUPS_FILE,
    JSON.stringify(options.groups ?? standardGroups),
  );
  const fake = fakeRun({ python: env.PYTHON, claude: env.CLAUDE_BIN });
  const app = createApp(env, {
    aws,
    run: fake.run,
    now: () => clock.now,
    platform: "linux",
  });
  return {
    app,
    env,
    db,
    bridge,
    api,
    aws,
    fake,
    lines,
    raw,
    clock,
    async deliver(fields) {
      const payload: Payload = payloadSchema.parse({
        chatJID: GROUP,
        ...fields,
      });
      app.onPayload(payload);
      await app.settled();
    },
    groupsFile: () =>
      fileSchema.parse(JSON.parse(readFileSync(env.GROUPS_FILE, "utf8"))),
    stateFile: () =>
      existsSync(env.STATE_FILE)
        ? z.unknown().parse(JSON.parse(readFileSync(env.STATE_FILE, "utf8")))
        : undefined,
    async close() {
      db.close();
      await bridge.close();
      await api.close();
    },
  };
}
