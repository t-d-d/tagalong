// Setting a group up from inside WhatsApp (who-can-use-it.md). Only an
// owner's own number may, only in a message typed in the last ten minutes,
// and only one addressed to Claude. A command is never a request.
import { isOwner } from "./access.ts";
import type { Bridge, Quote } from "./bridge.ts";
import type { ClaudeApi } from "./claude-api.ts";
import {
  type Config,
  type Group,
  type GroupEntry,
  type GroupsStore,
  isAccess,
  withoutGroup,
} from "./groups.ts";
import { CommandError, errorFields, log } from "./log.ts";
import { type People, userPart } from "./people.ts";
import { type WhatsAppStore, timeOf } from "./store.ts";

export const VERBS = [
  "setup",
  "allow",
  "revoke",
  "stop",
  "status",
  "help",
] as const;
export type Verb = (typeof VERBS)[number];

/** A message that is a command, whoever sent it: "@claude <verb> …" or a mention of Claude. */
export const COMMAND =
  /^\s*@(claude|\d{6,})\b[\s,:]*(setup|allow|revoke|stop|status|help)\b(.*)$/isu;
export const FRESH_MS = 10 * 60_000;

export interface Command {
  verb: Verb;
  args: string;
}

const isVerb = (word: string): word is Verb =>
  (VERBS as readonly string[]).includes(word);

/** The command in `text`, addressed to Claude (`self`: its numbers), or null. */
export function commandIn(
  text: string,
  self: ReadonlySet<string>,
): Command | null {
  const match = COMMAND.exec(text);
  const [, to, verb, args] = match ?? [];
  if (to === undefined || verb === undefined) return null;
  if (to.toLowerCase() !== "claude" && !self.has(to)) return null;
  const lower = verb.toLowerCase();
  return isVerb(lower) ? { verb: lower, args: (args ?? "").trim() } : null;
}

export interface Incoming {
  chat: string;
  sender: string;
  messageId: string;
  content: string;
  mentioned: string[];
}

export interface CommandDeps {
  groups: GroupsStore;
  people: People;
  store: WhatsAppStore;
  api: ClaudeApi;
  bridge: Bridge;
  now: () => number;
}

/** Whether a command may run: an owner's number, and typed in the last ten minutes. */
export function mayRun(message: Incoming, deps: CommandDeps): boolean {
  if (!isOwner(deps.groups.config, deps.people, message.sender)) return false;
  const row = deps.store.message(message.chat, message.messageId);
  if (row === undefined) return false;
  const sent = timeOf(row.timestamp);
  return Number.isFinite(sent) && deps.now() - sent <= FRESH_MS;
}

/** People a command names: its mentions (not Claude) and any +44… numbers typed out. */
export function peopleIn(
  message: Incoming,
  args: string,
  people: People,
): string[] {
  const self = people.self;
  const mentioned = message.mentioned
    .map(userPart)
    .filter((user) => !self.has(user));
  const typed = args
    .split(/\s+/u)
    .map((token) => token.replace(/^\+/u, ""))
    .filter((token) => /^\d{8,15}$/u.test(token) && !self.has(token));
  return [
    ...new Set([...mentioned, ...typed].map((user) => people.canonical(user))),
  ];
}

/** The words of a setup command, a "quoted name" kept whole. */
export const tokens = (args: string): string[] =>
  (args.match(/\w+="[^"]*"|"[^"]*"|\S+/gu) ?? []).map((token) =>
    token.replace(/"/gu, ""),
  );

export function describe(
  group: Group,
  config: Config,
  people: People,
  api: ClaudeApi,
): string {
  const who = [
    ...new Set(
      [...config.owners, ...group.members].map((user) => people.nameOf(user)),
    ),
  ];
  return [
    `*${group.repo}* (${group.access}${group.ref === "main" ? "" : `, from ${group.ref}`})`,
    `Environment: ${api.label(group.environment)}`,
    `Answers @claude from: ${who.join(", ")}`,
  ].join("\n");
}

/** The entry `setup` asks for, on top of the group's current one. */
export async function setupEntry(
  args: string,
  current: Group | undefined,
  label: string,
  people: string[],
  defaultEnvironment: string | undefined,
  api: ClaudeApi,
): Promise<GroupEntry> {
  const words = tokens(args);
  const option = (key: string) =>
    words.find((word) => word.startsWith(`${key}=`))?.slice(key.length + 1);
  const wanted = option("env") ?? words.find((word) => /^env_\w+$/u.test(word));
  const repo =
    words.find((word) => /^[\w.-]+\/[\w.-]+$/u.test(word)) ?? current?.repo;
  if (repo === undefined)
    throw new CommandError("Which repo? `@claude setup owner/repo read-write`");
  const environment =
    wanted === undefined
      ? (current?.environment ?? defaultEnvironment)
      : await api.resolve(wanted);
  const model = option("model") ?? current?.model;
  return {
    label,
    repo,
    ...(environment === undefined ? {} : { environment }),
    access: words.find(isAccess) ?? current?.access ?? "read-only",
    ref: option("ref") ?? current?.ref ?? "main",
    ...(model === undefined ? {} : { model }),
    members: [...new Set([...(current?.members ?? []), ...people])],
  };
}

const help = async (
  chat: string,
  group: Group | undefined,
  deps: CommandDeps,
  reply: (text: string) => Promise<void>,
) => {
  const { config } = deps.groups;
  const known = [...config.groups.values()];
  const repo = group?.repo ?? known[0]?.repo ?? "owner/repo";
  const environment =
    group?.environment ??
    config.defaultEnvironment ??
    known.find((entry) => entry.environment)?.environment;
  const repos = [
    ...new Set(
      known.map(
        (entry) =>
          `${entry.repo}${entry.environment === undefined ? "" : ` (${deps.api.nameOf(entry.environment) ?? entry.environment})`}`,
      ),
    ),
  ];
  const environments = (await deps.api.environments().catch(() => []))
    .map((entry) => entry.name)
    .filter((name) => name !== "");
  await reply(
    [
      group === undefined
        ? "I'm not set up in this group, so I'm ignoring it."
        : `Set up here:\n${describe(group, config, deps.people, deps.api)}`,
      "",
      "Copy one of the next messages, edit it, and send it. Only your number can run them, within 10 minutes of typing.",
      "To add someone, type @ and pick them from the list (a pasted name is not a mention), or put their number, like +447700900123.",
      ...(repos.length > 0
        ? ["", `Repos I already work in: ${repos.join(", ")}`]
        : []),
      ...(environments.length > 0
        ? [`Your environments: ${environments.join(", ")}`]
        : []),
    ].join("\n"),
  );
  const templates = [
    `@claude setup ${repo} ${group?.access ?? "read-write"}${environment === undefined ? "" : ` ${deps.api.token(environment)}`}`,
    "@claude allow @",
    "@claude revoke @",
    "@claude status",
    "@claude stop",
  ];
  for (const template of templates) await deps.bridge.send(chat, template);
};

export async function runCommand(
  message: Incoming,
  command: Command,
  deps: CommandDeps,
): Promise<void> {
  const { chat } = message;
  const group = deps.groups.config.groups.get(chat);
  const quote: Quote = {
    id: message.messageId,
    sender: message.sender,
    content: message.content,
  };
  const reply = (text: string) => deps.bridge.send(chat, text, quote);
  log.info("command", {
    verb: command.verb,
    group: group?.label ?? "not set up",
  });
  await deps.api.environments().catch((error: unknown) => {
    log.warn("environments-failed", errorFields(error));
  });
  try {
    switch (command.verb) {
      case "help":
        await help(chat, group, deps, reply);
        return;
      case "status":
        await reply(
          group === undefined
            ? "I'm not set up in this group, so I'm ignoring it."
            : describe(group, deps.groups.config, deps.people, deps.api),
        );
        return;
      case "stop":
        if (group === undefined) {
          await reply("I'm not set up in this group.");
          return;
        }
        deps.groups.update((file) => withoutGroup(file, chat));
        await reply(
          "Stopped. I'll ignore this group until you set me up again.",
        );
        return;
      case "setup": {
        const people = peopleIn(message, command.args, deps.people);
        const label = deps.store.chatName(chat) ?? group?.label ?? chat;
        const entry = await setupEntry(
          command.args,
          group,
          label,
          people,
          deps.groups.config.defaultEnvironment,
          deps.api,
        );
        const config = deps.groups.update((file) => ({
          ...file,
          groups: { ...file.groups, [chat]: entry },
        }));
        const updated = config.groups.get(chat);
        if (updated === undefined)
          throw new CommandError("the setup did not stick");
        await reply(
          `${group === undefined ? "Set up" : "Updated"}.\n${describe(updated, config, deps.people, deps.api)}`,
        );
        return;
      }
      case "allow":
      case "revoke": {
        if (group === undefined) {
          await reply("Set me up first: `@claude setup owner/repo read-write`");
          return;
        }
        const people = peopleIn(message, command.args, deps.people);
        if (people.length === 0) {
          await reply(`Who? Mention them: \`@claude ${command.verb} @Name\``);
          return;
        }
        const members =
          command.verb === "allow"
            ? [...new Set([...group.members, ...people])]
            : group.members.filter(
                (member) =>
                  !people.some((person) =>
                    deps.people.sameUser(member, person),
                  ),
              );
        const config = deps.groups.update((file) => {
          const entry = file.groups?.[chat];
          return entry === undefined
            ? file
            : {
                ...file,
                groups: { ...file.groups, [chat]: { ...entry, members } },
              };
        });
        const updated = config.groups.get(chat);
        await reply(
          updated === undefined
            ? "Done."
            : describe(updated, config, deps.people, deps.api),
        );
        return;
      }
    }
  } catch (error) {
    log.warn("command-failed", { verb: command.verb, ...errorFields(error) });
    await reply(
      error instanceof CommandError
        ? `Couldn't do that: ${error.why.replace(/^groups\.json: /u, "")}`
        : "Couldn't do that: something went wrong on my side.",
    );
  }
}
