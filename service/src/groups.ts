// Which Claudes there are, which groups each is in, and who may ask them
// (who-can-use-it.md). Lives in groups.json beside the device, never in the
// repo. A Claude is a name for a context: a repo, an environment, an access
// level and a model. The catalogue defines each once; a group lists the ones
// an owner added to it.
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
});

export const groupSchema = z.object({
  label: z.string().optional(),
  claudes: z.array(name),
  members: z.array(digits).optional(),
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

const storedSchema = z.object({
  owners: z.array(digits).optional(),
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
}

export interface Group {
  jid: string;
  label: string;
  /** The Claudes added here that the catalogue defines, in the order added. */
  claudes: string[];
  members: string[];
}

export interface Config {
  owners: string[];
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
    if ("claudes" in entry) {
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
      claudes: [claude],
      ...(members === undefined ? {} : { members }),
    };
  }
  return {
    ...(parsed.data.owners === undefined ? {} : { owners: parsed.data.owners }),
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
    });
  }
  const groups = new Map<string, Group>();
  for (const [key, entry] of Object.entries(file.groups ?? {})) {
    const here = entry.claudes.filter((claude) => claudes.has(claude));
    if (here.length === 0) continue;
    groups.set(key, {
      jid: key,
      // A one-to-one chat's JID is a phone number: never a label (logging.md).
      label: entry.label ?? (key.endsWith("@g.us") ? key : "direct chat"),
      claudes: here,
      members: entry.members ?? [],
    });
  }
  return {
    owners: [...new Set([...extraOwners, ...(file.owners ?? [])])],
    defaultEnvironment: file.defaultEnvironment,
    claudes,
    groups,
  };
}

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
