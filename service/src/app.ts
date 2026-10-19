// The parts wired together. main.ts runs it for real; the integration tier
// runs it against loopback fakes.
import type { Server } from "node:http";
import { allowed } from "./access.ts";
import type { Aws } from "./aws.ts";
import { Bridge, bridgeToken } from "./bridge.ts";
import { ClaudeApi } from "./claude-api.ts";
import { Cloud } from "./cloud.ts";
import { commandIn, mayRun, runCommand } from "./commands.ts";
import { type Env, cliEnv } from "./env.ts";
import { GroupsStore, claudesOf, parseOwners } from "./groups.ts";
import { errorFields, log } from "./log.ts";
import { Login } from "./login.ts";
import { People } from "./people.ts";
import { poll } from "./relay.ts";
import { handleRequest, repliedTo } from "./requests.ts";
import { type Runner, Serial } from "./run.ts";
import { type DeviceState, ensureDevice } from "./seed.ts";
import { StateStore } from "./state.ts";
import { WhatsAppStore } from "./store.ts";
import { type Payload, webhookServer } from "./webhook.ts";
import { addressed } from "./addressing.ts";

export interface AppDeps {
  aws: Aws | undefined;
  run: Runner;
  now: () => number;
  platform: NodeJS.Platform;
}

export function createApp(env: Env, { aws, run, now, platform }: AppDeps) {
  const cli = new Serial(); // one CLI at a time (claude-login.md)
  const requests = new Serial();
  const commands = new Serial(); // commands never wait behind a session launch

  const login = new Login({ env, aws, run, now, platform });
  const store = new WhatsAppStore(env.BRIDGE_STORE);
  const people = new People(store);
  const groups = new GroupsStore(env.GROUPS_FILE, parseOwners(env.OWNERS));
  const state = new StateStore(env.STATE_FILE);
  const api = new ClaudeApi(
    env.CLAUDE_API_BASE,
    () => login.accessToken(),
    () => login.orgUuid(),
  );
  const cloud = new Cloud(env, login, run);
  const token = () => bridgeToken(env.BRIDGE_STORE, env.WHATSAPP_BRIDGE_TOKEN);
  const bridge = new Bridge(env.BRIDGE_URL, token, (user) =>
    people.toJid(user),
  );

  const seen = new Set<string>();
  const recent: number[] = [];
  let device: DeviceState = store.present() ? "present" : "waiting";
  if (device === "present") people.refresh();
  // Work started by a message, for tests to wait on.
  let pending: Promise<unknown> = Promise.resolve();

  function onPayload(payload: Payload): void {
    if (payload.messageId !== "") {
      if (seen.has(payload.messageId)) return;
      seen.add(payload.messageId);
      if (seen.size > 2000) seen.delete(seen.values().next().value ?? "");
    }
    const incoming = {
      chat: payload.chatJID,
      sender: payload.sender,
      messageId: payload.messageId,
      content: payload.content,
      mentioned: payload.mentionedJids ?? [],
    };
    const { config } = groups;
    const group = config.groups.get(payload.chatJID);
    // A command is never a request, whoever sends it (who-can-use-it.md).
    const command =
      payload.isFromMe || payload.eventType === "reaction"
        ? null
        : commandIn(payload.content, people.self);
    if (command !== null) {
      const deps = { groups, people, store, state, api, bridge, now };
      if (mayRun(incoming, deps)) {
        pending = commands
          .run(() => runCommand(incoming, command, deps))
          .catch((error: unknown) => {
            log.error("command-failed", {
              verb: command.verb,
              ...errorFields(error),
            });
          });
      } else if (group !== undefined) {
        log.info("command-ignored", { verb: command.verb, group: group.label });
      }
      return;
    }
    // Nothing is logged about a chat with no Claudes: this account is in other groups too.
    if (group === undefined) return;
    const asked = addressed(
      payload,
      group.claudes,
      new Set(config.claudes.keys()),
      people.self,
      repliedTo(payload, { store, state }),
    );
    log.info("message", {
      group: group.label,
      claudes: asked.claudes.length,
      chars: payload.content.length,
    });
    if (asked.claudes.length === 0 && !asked.bare && asked.missing.length === 0)
      return;
    if (!allowed(config, group, people, payload.sender)) {
      log.info("request-ignored", { why: "not-a-member", group: group.label });
      return;
    }
    const quote = {
      id: payload.messageId,
      sender: payload.sender,
      content: payload.content,
    };
    if (asked.claudes.length === 0) {
      const here = group.claudes.map((name) => `@${name}`).join(", ");
      const text =
        asked.missing.length > 0
          ? `${asked.missing.map((name) => `@${name}`).join(", ")} isn't in this group. Here: ${here}. An owner can add one with @claude add <name>.`
          : `Ask one of us by name: ${here}.`;
      pending = requests
        .run(() => bridge.send(payload.chatJID, text, quote))
        .catch((error: unknown) => {
          log.warn("bridge-unreachable", errorFields(error));
        });
      return;
    }
    const claudes = claudesOf(config, group).filter((claude) =>
      asked.claudes.includes(claude.name),
    );
    const deps = {
      env,
      groups,
      people,
      store,
      bridge,
      cloud,
      api,
      state,
      aws,
      cli,
      now,
      recent,
    };
    pending = requests
      .run(() => handleRequest(payload, claudes, group, deps))
      .catch(async (error: unknown) => {
        log.error("request-failed", {
          group: group.label,
          ...errorFields(error),
        });
        await bridge
          .react(
            payload.chatJID,
            { id: payload.messageId, sender: payload.sender },
            "⚠️",
          )
          .catch(() => undefined);
      });
  }

  async function checkDevice(): Promise<DeviceState> {
    if (device === "present" || device === "seeded") return device;
    device = await ensureDevice({
      storeDir: env.BRIDGE_STORE,
      groupsFile: env.GROUPS_FILE,
      stateFile: env.STATE_FILE,
      aws,
      bucket: env.ATTACHMENTS_BUCKET,
      key: env.SEED_KEY,
      run,
      env: cliEnv(env),
    });
    if (device === "seeded") {
      groups.reload();
      state.reload();
    }
    if (device === "present" || device === "seeded") people.refresh();
    return device;
  }

  /** One line every few minutes; the heartbeat alarm counts the connected ones (alerting.md). */
  async function heartbeat(): Promise<string> {
    let bridgeState =
      device === "present" || device === "seeded"
        ? "unreachable"
        : "waiting-for-device";
    if (bridgeState === "unreachable") {
      try {
        bridgeState = (await bridge.connected()) ? "connected" : "disconnected";
      } catch (error) {
        log.warn("bridge-unreachable", errorFields(error));
      }
    }
    const waiting = Object.values(state.state.sessions).filter(
      (session) => session.waiting,
    ).length;
    log.info("heartbeat", {
      bridge: bridgeState,
      groups: groups.config.groups.size,
      waiting,
    });
    return bridgeState;
  }

  const pollOnce = () =>
    poll({ api, bridge, groups, state, store, giveUpMs: env.GIVE_UP_MS, now });
  const keepFresh = () => cli.run(() => login.keepFresh());

  async function start(): Promise<Server> {
    await cli.run(() => login.restore());
    await checkDevice();
    if (env.ATTACHMENTS_BUCKET === undefined) log.info("attachments-off");
    const server = webhookServer(token, onPayload);
    await new Promise<void>((resolve) =>
      server.listen(env.PORT, "127.0.0.1", resolve),
    );
    log.info("started", {
      port: env.PORT,
      groups: groups.config.groups.size,
      owners: groups.config.owners.length,
      device,
      dryRun: env.DRY_RUN,
    });
    return server;
  }

  return {
    start,
    onPayload,
    heartbeat,
    checkDevice,
    pollOnce,
    keepFresh,
    settled: () => pending,
    refreshPeople: () => people.refresh(),
    parts: { login, store, people, groups, state, api, cloud, bridge },
  };
}

export type App = ReturnType<typeof createApp>;
