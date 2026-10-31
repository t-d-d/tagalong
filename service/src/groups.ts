// Which Claudes there are, which groups each is in, and who may ask them
// (who-can-use-it.md). Lives in groups.json beside the device, never in the
// repo. A Claude is a name for a context: a repo, an environment, an access
// level and a model. The catalogue defines each once; a group lists the ones
// an owner added to it.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { CommandError } from "./log.ts";

/** Each access level and the permission mode its sessions start in. */
export const ACCESS = { "read-write": "auto", "read-only": "dontAsk" } as const;
export type Access = keyof typeof ACCESS;
export const isAccess = (word: string): word is Access =>
  Object.hasOwn(ACCESS, word);

/** "claude" addresses tagalong itself, for commands. */
export const RESERVED = ["claude"];
const NAME = /^[a-z][a-z0-9-]{1,23}$/u;
export const isName = (word: string): boolean =>
  NAME.test(word) && !RESERVED.includes(word);

const digits = z
  .string()
  .regex(
    /^\d{6,}$/u,
    "must be a phone number, digits only with the country code",
  );
const envId = z.string().regex(/^env_\w+$/u, 'must be an "env_…" id');
const repo = z.string().regex(/^[\w.-]+\/[\w.-]+$/u, "must be owner/name");
const name = z
  .string()
  .refine(
    isName,
    'must be 2 to 24 lowercase letters, digits or dashes, starting with a letter, and not "claude"',
  );

export const claudeSchema = z.object({
  repo,
  environment: envId.optional(),
  access: z.enum(["read-write", "read-only"]),
  ref: z
    .string()
    .regex(/^[\w./-]+$/u, "must be a branch or tag name")
    .optional(),
  model: z
    .string()
    .regex(/^[\w.-]+$/u, "must be a model name")
    .optional(),
  // A brief sent at the start of each session: who it is, how it works,
  // and any skill from the repo it should use.
  role: z
    .string()
    .trim()
    .min(1)
    .max(2000, "must be at most 2000 characters")
    .optional(),
});

// Each Claude in a chat, with the people who may ask it there, besides the
// owners: named ones, or everyone in the chat (read-only Claudes only). A
// interjecting Claude is given what they say without being asked; off unless
// an owner turns it on.
export const askersSchema = z.object({
  members: z.array(digits).default([]),
  everyone: z.boolean().optional(),
  interjecting: z.boolean().optional(),
});
export const groupSchema = z.object({
  label: z.string().optional(),
  claudes: z.record(name, askersSchema),
});

// A group from before named Claudes: one repo of its own. Read, and written
// back as a Claude named after the repo.
const legacyGroupSchema = claudeSchema.extend({
  label: z.string().optional(),
  members: z.array(digits).optional(),
});

// A group, or a one-to-one chat with the number (who-can-use-it.md).
const jid = z
  .string()
  .regex(
    /@(g\.us|s\.whatsapp\.net|lid)$/u,
    "must be a chat JID, ending @g.us, @s.whatsapp.net or @lid",
  );

/** Which Claudes may interject anywhere: any an owner sets, or read-only ones only. */
export const INTERJECTING = ["all", "read-only"] as const;
export type Interjecting = (typeof INTERJECTING)[number];
export const isInterjecting = (word: string): word is Interjecting =>
  (INTERJECTING as readonly string[]).includes(word);

const storedSchema = z.object({
  owners: z.array(digits).optional(),
  // Left out, any Claude may interject.
  interjecting: z.enum(INTERJECTING).optional(),
  defaultEnvironment: envId.optional(),
  claudes: z.record(name, claudeSchema).optional(),
  groups: z.record(jid, z.union([groupSchema, legacyGroupSchema])).optional(),
});

export const fileSchema = storedSchema.extend({
  groups: z.record(jid, groupSchema).optional(),
});

export type ClaudeEntry = z.infer<typeof claudeSchema>;
export type GroupEntry = z.infer<typeof groupSchema>;
export type GroupsFile = z.infer<typeof fileSchema>;

export interface Claude {
  name: string;
  repo: string;
  environment: string | undefined;
  access: Access;
  ref: string;
  model: string | undefined;
  role: string | undefined;
}

export interface Group {
  jid: string;
  label: string;
  /** The Claudes added here that the catalogue defines, in the order added. */
  claudes: string[];
  /** Who may ask each Claude here, besides the owners. */
  members: Record<string, string[]>;
  /** The Claudes here that anyone in the chat may ask. */
  everyone: string[];
  /** The Claudes here set to interject. */
  interjecting: string[];
}

/** Who may ask `claude` in `group`, by name, besides the owners. */
export const membersOf = (group: Group, claude: string): string[] =>
  group.members[claude] ?? [];

/** Whether anyone in `group` may ask `claude`: only ever a read-only one. */
export const openTo = (config: Config, group: Group, claude: string): boolean =>
  group.everyone.includes(claude) &&
  config.claudes.get(claude)?.access === "read-only";

export interface Config {
  owners: string[];
  /** Which Claudes may interject, in every chat. */
  interjecting: Interjecting;
  defaultEnvironment: string | undefined;
  claudes: Map<string, Claude>;
  /** Groups with at least one Claude. Any other chat is ignored. */
  groups: Map<string, Group>;
}

/** A readable reason from a schema's first complaint. */
function reason(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) return "not valid";
  const where =
    issue.path.length > 0 ? `"${issue.path.map(String).join(".")}" ` : "";
  // A bad key reports its own complaint one level down.
  const message =
    issue.code === "invalid_key"
      ? (issue.issues[0]?.message ?? issue.message)
      : issue.message;
  return `${where}${message}`;
}

/** A Claude's name from a repo's: "podstow/podstow" gives "podstow". */
export function nameFor(repoName: string, taken: (name: string) => boolean) {
  const base =
    (repoName.split("/")[1] ?? repoName)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/gu, "-")
      .replace(/^[^a-z]+/u, "")
      .slice(0, 20) || "repo";
  const stem = isName(base) ? base : `c-${base}`.slice(0, 20);
  let candidate = stem;
  for (let n = 2; taken(candidate); n++) candidate = `${stem}-${String(n)}`;
  return candidate;
}

/** groups.json read and checked, with any group from before named Claudes converted. */
export function parseFile(raw: unknown): GroupsFile {
  const parsed = storedSchema.safeParse(raw);
  if (!parsed.success)
    throw new CommandError(`groups.json: ${reason(parsed.error)}`);
  const claudes = { ...parsed.data.claudes };
  const groups: Record<string, GroupEntry> = {};
  for (const [key, entry] of Object.entries(parsed.data.groups ?? {})) {
    if (!("repo" in entry)) {
      groups[key] = entry;
      continue;
    }
    const { label, members, ...context } = entry;
    const same = Object.entries(claudes).find(
      ([, claude]) => JSON.stringify(claude) === JSON.stringify(context),
    )?.[0];
    const claude =
      same ?? nameFor(context.repo, (taken) => Object.hasOwn(claudes, taken));
    claudes[claude] = context;
    groups[key] = {
      ...(label === undefined ? {} : { label }),
      claudes: { [claude]: { members: members ?? [] } },
    };
  }
  return {
    ...(parsed.data.owners === undefined ? {} : { owners: parsed.data.owners }),
    ...(parsed.data.interjecting === undefined
      ? {}
      : { interjecting: parsed.data.interjecting }),
    ...(parsed.data.defaultEnvironment === undefined
      ? {}
      : { defaultEnvironment: parsed.data.defaultEnvironment }),
    claudes,
    groups,
  };
}

export function toConfig(file: GroupsFile, extraOwners: string[]): Config {
  const claudes = new Map<string, Claude>();
  for (const [key, entry] of Object.entries(file.claudes ?? {})) {
    claudes.set(key, {
      name: key,
      repo: entry.repo,
      environment: entry.environment,
      access: entry.access,
      ref: entry.ref ?? "main",
      model: entry.model,
      role: entry.role,
    });
  }
  const interjecting = file.interjecting ?? "all";
  // Kept to read-only Claudes, a read-write one never interjects, whatever a chat says.
  const mayInterject = (claude: string) =>
    interjecting === "all" || claudes.get(claude)?.access === "read-only";
  const groups = new Map<string, Group>();
  for (const [key, entry] of Object.entries(file.groups ?? {})) {
    const here = Object.entries(entry.claudes).filter(([claude]) =>
      claudes.has(claude),
    );
    if (here.length === 0) continue;
    groups.set(key, {
      jid: key,
      // A one-to-one chat's JID is a phone number: never a label (logging.md).
      label: entry.label ?? (key.endsWith("@g.us") ? key : "direct chat"),
      claudes: here.map(([claude]) => claude),
      members: Object.fromEntries(
        here.map(([claude, { members }]) => [claude, members]),
      ),
      everyone: here
        .filter(([, askers]) => askers.everyone === true)
        .map(([claude]) => claude),
      interjecting: here
        .filter(
          ([claude, askers]) =>
            askers.interjecting === true && mayInterject(claude),
        )
        .map(([claude]) => claude),
    });
  }
  return {
    owners: [...new Set([...extraOwners, ...(file.owners ?? [])])],
    interjecting,
    defaultEnvironment: file.defaultEnvironment,
    claudes,
    groups,
  };
}

/** A short fingerprint of a Claude's definition, to tell an older one. */
export const versionOf = (claude: Claude): string =>
  createHash("sha256")
    .update(
      JSON.stringify([
        claude.repo,
        claude.environment,
        claude.access,
        claude.ref,
        claude.model,
        claude.role,
      ]),
    )
    .digest("hex")
    .slice(0, 12);

/** The group's Claudes, as the catalogue defines them. */
export const claudesOf = (config: Config, group: Group): Claude[] =>
  group.claudes.flatMap((claude) => {
    const found = config.claudes.get(claude);
    return found === undefined ? [] : [found];
  });

/** Owners from a comma-separated list of numbers (the OWNERS variable). */
export function parseOwners(list: string): string[] {
  const owners = list
    .split(",")
    .map((owner) => owner.trim().replace(/^\+/u, ""))
    .filter((owner) => owner !== "");
  for (const owner of owners) digits.parse(owner);
  return owners;
}

/** Who may ask a Claude in a chat, with interjecting turned off. */
export const withoutInterjecting = (
  askers: GroupEntry["claudes"][string],
): GroupEntry["claudes"][string] => ({
  members: askers.members,
  ...(askers.everyone === true ? { everyone: true } : {}),
});

/**
 * The file with interjecting turned off for every read-write Claude, in every
 * chat, when only read-only Claudes may interject. Returns the chats and
 * Claudes it stopped, by threadKey's parts.
 */
export function withoutReadWriteInterjecting(file: GroupsFile): {
  file: GroupsFile;
  stopped: { chat: string; claude: string }[];
} {
  if (file.interjecting !== "read-only") return { file, stopped: [] };
  const stopped: { chat: string; claude: string }[] = [];
  const groups = Object.fromEntries(
    Object.entries(file.groups ?? {}).map(([chat, entry]) => [
      chat,
      {
        ...entry,
        claudes: Object.fromEntries(
          Object.entries(entry.claudes).map(([claude, askers]) => {
            if (
              askers.interjecting !== true ||
              file.claudes?.[claude]?.access !== "read-write"
            )
              return [claude, askers];
            stopped.push({ chat, claude });
            return [claude, withoutInterjecting(askers)];
          }),
        ),
      },
    ]),
  );
  return { file: { ...file, groups }, stopped };
}

/** The file without one group. */
export const withoutGroup = (file: GroupsFile, key: string): GroupsFile => ({
  ...file,
  groups: Object.fromEntries(
    Object.entries(file.groups ?? {}).filter(([other]) => other !== key),
  ),
});

/** groups.json and the config it gives, read and written together. */
export class GroupsStore {
  readonly #path: string;
  readonly #extraOwners: string[];
  #config: Config;

  constructor(path: string, extraOwners: string[]) {
    this.#path = path;
    this.#extraOwners = extraOwners;
    this.#config = toConfig(this.read(), extraOwners);
  }

  get config(): Config {
    return this.#config;
  }

  read(): GroupsFile {
    if (!existsSync(this.#path)) return {};
    return parseFile(JSON.parse(readFileSync(this.#path, "utf8")));
  }

  /** Reload from disk, for a file that changed underneath (the device seed). */
  reload(): Config {
    this.#config = toConfig(this.read(), this.#extraOwners);
    return this.#config;
  }

  /** Change the file and the live config together. Nothing is written if the result is not valid. */
  update(mutate: (file: GroupsFile) => GroupsFile): Config {
    const next = parseFile(mutate(structuredClone(this.read())));
    const config = toConfig(next, this.#extraOwners);
    const tmp = `${this.#path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.#path);
    this.#config = config;
    return config;
  }
}
