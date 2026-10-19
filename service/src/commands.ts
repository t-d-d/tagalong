// Setting Claudes and groups up from inside WhatsApp (who-can-use-it.md).
// Only an owner's own number may, only in a message typed in the last ten
// minutes, and only one addressed to @claude. A command is never a request.
// The catalogue is global. Every other command acts on the chat it is sent
// in: a group, or a one-to-one chat with the number, which works the same.
import { isOwner } from "./access.ts";
import type { Bridge, Quote } from "./bridge.ts";
import type { ClaudeApi } from "./claude-api.ts";
import {
  type Claude,
  type ClaudeEntry,
  type Config,
  type Group,
  type GroupsFile,
  type GroupsStore,
  claudeSchema,
  isAccess,
  isName,
  withoutGroup,
} from "./groups.ts";
import { CommandError, errorFields, log } from "./log.ts";
import { type People, userPart } from "./people.ts";
import { type StateStore, threadKey } from "./state.ts";
import { type WhatsAppStore, timeOf } from "./store.ts";

export const VERBS = [
  "help",
  "who",
  "add",
  "remove",
  "define",
  "allow",
  "revoke",
  "fresh",
  "stop",
] as const;
export type Verb = (typeof VERBS)[number];

/** A message that is a command, whoever sent it: "@claude <verb> …" or a mention of the number. */
export const COMMAND =
  /^\s*@(claude|\d{6,})\b[\s,:]*(help|who|add|remove|define|allow|revoke|fresh|stop)\b(.*)$/isu;
export const FRESH_MS = 10 * 60_000;

export interface Command {
  verb: Verb;
  args: string;
}

const isVerb = (word: string): word is Verb =>
  (VERBS as readonly string[]).includes(word);

/** The command in `text`, addressed to tagalong (`self`: its numbers), or null. */
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
  state: StateStore;
  api: ClaudeApi;
  bridge: Bridge;
  now: () => number;
}

/** Whether a command may run: an owner's number, and typed in the last ten minutes. */
export function mayRun(
  message: Incoming,
  deps: Pick<CommandDeps, "groups" | "people" | "store" | "now">,
): boolean {
  if (!isOwner(deps.groups.config, deps.people, message.sender)) return false;
  const row = deps.store.message(message.chat, message.messageId);
  if (row === undefined) return false;
  const sent = timeOf(row.timestamp);
  return Number.isFinite(sent) && deps.now() - sent <= FRESH_MS;
}

/** People a command names: its mentions (not tagalong) and any +44… numbers typed out. */
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

/** The words of a command, a "quoted name" kept whole. */
export const tokens = (args: string): string[] =>
  (args.match(/\w+="[^"]*"|"[^"]*"|\S+/gu) ?? []).map((token) =>
    token.replace(/"/gu, ""),
  );

/** Claude names in a command's words, with or without an @. */
const namesIn = (args: string): string[] => [
  ...new Set(
    tokens(args)
      .map((word) => word.replace(/^@/u, "").toLowerCase())
      .filter(isName),
  ),
];

/** One line about a Claude: its repo, access, environment, ref and model. */
export function line(claude: Claude, api: ClaudeApi): string {
  const extras = [
    claude.access,
    claude.environment === undefined
      ? "default environment"
      : (api.nameOf(claude.environment) ?? claude.environment),
    ...(claude.ref === "main" ? [] : [`from ${claude.ref}`]),
    ...(claude.model === undefined ? [] : [claude.model]),
  ];
  return `*@${claude.name}*: ${claude.repo}, ${extras.join(", ")}`;
}

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
  const here = group.claudes.flatMap((name) => {
    const claude = config.claudes.get(name);
    return claude === undefined ? [] : [line(claude, api)];
  });
  const others = [...config.claudes.keys()].filter(
    (name) => !group.claudes.includes(name),
  );
  return [
    "Claudes here:",
    ...here,
    "",
    `Who can ask them: ${who.join(", ")}`,
    ...(others.length > 0 ? [`Others you can add: ${others.join(", ")}`] : []),
  ].join("\n");
}

const catalogue = (config: Config, api: ClaudeApi): string =>
  config.claudes.size === 0
    ? "No Claudes are defined yet."
    : [
        "Defined Claudes:",
        ...[...config.claudes.values()].map((claude) => line(claude, api)),
      ].join("\n");

/** The catalogue entry `define` asks for, on top of the current one. */
export async function defineEntry(
  args: string,
  current: Claude | undefined,
  defaultEnvironment: string | undefined,
  api: ClaudeApi,
): Promise<ClaudeEntry> {
  const words = tokens(args).slice(1);
  const option = (key: string) =>
    words.find((word) => word.startsWith(`${key}=`))?.slice(key.length + 1);
  const wanted = option("env") ?? words.find((word) => /^env_\w+$/u.test(word));
  const repo =
    words.find((word) => /^[\w.-]+\/[\w.-]+$/u.test(word)) ?? current?.repo;
  if (repo === undefined)
    throw new CommandError(
      "Which repo? `@claude define <name> owner/repo read-only`",
    );
  const environment =
    wanted === undefined
      ? (current?.environment ?? defaultEnvironment)
      : await api.resolve(wanted);
  const model = option("model") ?? current?.model;
  const ref = option("ref") ?? current?.ref;
  return claudeSchema.parse({
    repo,
    ...(environment === undefined ? {} : { environment }),
    access: words.find(isAccess) ?? current?.access ?? "read-only",
    ...(ref === undefined || ref === "main" ? {} : { ref }),
    ...(model === undefined ? {} : { model }),
  });
}

/** The group's entry in the file, kept when it has no Claudes left so its people are remembered. */
const entryOf = (file: GroupsFile, chat: string) => file.groups?.[chat];

const help = async (
  chat: string,
  group: Group | undefined,
  deps: CommandDeps,
  reply: (text: string) => Promise<void>,
) => {
  const { config } = deps.groups;
  const names = [...config.claudes.keys()];
  const environments = (await deps.api.environments().catch(() => []))
    .map((entry) => entry.name)
    .filter((name) => name !== "");
  await reply(
    [
      group === undefined
        ? `No Claudes here yet, so I'm ignoring this chat.\n\n${catalogue(config, deps.api)}`
        : describe(group, config, deps.people, deps.api),
      "",
      `Ask a Claude by name, like @${group?.claudes[0] ?? names[0] ?? "podstow"} what should we build next?`,
      "",
      "Copy one of the next messages, edit it, and send it. Only your number can run them, within 10 minutes of typing.",
      "To let someone ask, type @ and pick them from the list, or put their number, like +447700900123.",
      ...(environments.length > 0
        ? [`Your environments: ${environments.join(", ")}`]
        : []),
    ].join("\n"),
  );
  const unused = names.find(
    (name) => !(group?.claudes.includes(name) ?? false),
  );
  const templates = [
    `@claude add ${unused ?? "podstow"}`,
    "@claude define critic owner/repo read-only",
    "@claude allow @",
    "@claude revoke @",
    `@claude fresh ${group?.claudes[0] ?? "podstow"}`,
    "@claude who",
    "@claude stop",
  ];
  for (const template of templates) await deps.bridge.send(chat, template);
};

/** A group chat's JID ends @g.us; anything else is a one-to-one chat. */
export const isGroupChat = (chat: string): boolean => chat.endsWith("@g.us");
export const DIRECT_LABEL = "direct chat";

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
      case "who":
        await reply(
          group === undefined
            ? catalogue(deps.groups.config, deps.api)
            : describe(group, deps.groups.config, deps.people, deps.api),
        );
        return;
      case "define": {
        const [name] = namesIn(command.args);
        if (name === undefined)
          throw new CommandError(
            "Name it first: `@claude define critic owner/repo read-only`",
          );
        const current = deps.groups.config.claudes.get(name);
        const entry = await defineEntry(
          command.args,
          current,
          deps.groups.config.defaultEnvironment,
          deps.api,
        );
        const config = deps.groups.update((file) => ({
          ...file,
          claudes: { ...file.claudes, [name]: entry },
        }));
        const defined = config.claudes.get(name);
        if (defined === undefined)
          throw new CommandError("the definition did not stick");
        await reply(
          `${current === undefined ? "Defined" : "Updated"}.\n${line(defined, deps.api)}\n\nAdd it to a group with \`@claude add ${name}\` there.`,
        );
        return;
      }
      case "add": {
        const names = namesIn(command.args);
        const unknown = names.filter(
          (name) => !deps.groups.config.claudes.has(name),
        );
        if (names.length === 0 || unknown.length > 0)
          throw new CommandError(
            `${names.length === 0 ? "Which Claude?" : `No Claude called ${unknown.join(", ")}.`} ${catalogue(deps.groups.config, deps.api)}`,
          );
        // A one-to-one chat's name is a person's, so it is never a label (logging.md).
        const label = isGroupChat(chat)
          ? (deps.store.chatName(chat) ?? group?.label ?? chat)
          : DIRECT_LABEL;
        const config = deps.groups.update((file) => {
          const entry = entryOf(file, chat);
          return {
            ...file,
            groups: {
              ...file.groups,
              [chat]: {
                ...entry,
                label,
                claudes: [...new Set([...(entry?.claudes ?? []), ...names])],
              },
            },
          };
        });
        const updated = config.groups.get(chat);
        if (updated === undefined)
          throw new CommandError("the change did not stick");
        await reply(describe(updated, config, deps.people, deps.api));
        return;
      }
      case "remove": {
        const names = namesIn(command.args);
        if (group === undefined || names.length === 0) {
          await reply(
            group === undefined
              ? "No Claudes here."
              : "Which Claude? `@claude remove critic`",
          );
          return;
        }
        const config = deps.groups.update((file) => {
          const entry = entryOf(file, chat);
          return entry === undefined
            ? file
            : {
                ...file,
                groups: {
                  ...file.groups,
                  [chat]: {
                    ...entry,
                    claudes: entry.claudes.filter(
                      (name) => !names.includes(name),
                    ),
                  },
                },
              };
        });
        const updated = config.groups.get(chat);
        await reply(
          updated === undefined
            ? "No Claudes left here, so I'll ignore this group. Its people are remembered for when you add one again."
            : describe(updated, config, deps.people, deps.api),
        );
        return;
      }
      case "fresh": {
        const names = namesIn(command.args).filter(
          (name) => group?.claudes.includes(name) ?? false,
        );
        if (names.length === 0) {
          await reply("Which Claude here? `@claude fresh brainstorm`");
          return;
        }
        for (const name of names) {
          const thread = deps.state.state.threads[threadKey(chat, name)];
          if (thread !== undefined) thread.session = null;
        }
        deps.state.save();
        await reply(
          `Next time, ${names.map((name) => `@${name}`).join(" and ")} starts afresh, with only the last messages here.`,
        );
        return;
      }
      case "stop":
        if (deps.groups.read().groups?.[chat] === undefined) {
          await reply("I'm not set up in this group.");
          return;
        }
        deps.groups.update((file) => withoutGroup(file, chat));
        await reply(
          "Stopped, and forgot who could ask here. I'll ignore this group until a Claude is added again.",
        );
        return;
      case "allow":
      case "revoke": {
        if (group === undefined) {
          await reply("Add a Claude first: `@claude add <name>`");
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
          const entry = entryOf(file, chat);
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
