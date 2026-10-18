// Which groups tagalong works in, and how (who-can-use-it.md). Lives in
// groups.json beside the device, never in the repo.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { CommandError } from "./log.ts";

/** Each access level and the permission mode its sessions start in. */
export const ACCESS = { "read-write": "auto", "read-only": "dontAsk" } as const;
export type Access = keyof typeof ACCESS;
export const isAccess = (word: string): word is Access =>
  Object.hasOwn(ACCESS, word);

const digits = z
  .string()
  .regex(
    /^\d{6,}$/u,
    "must be a phone number, digits only with the country code",
  );
const envId = z.string().regex(/^env_\w+$/u, 'must be an "env_…" id');
const repo = z.string().regex(/^[\w.-]+\/[\w.-]+$/u, "must be owner/name");

export const groupSchema = z.object({
  label: z.string().optional(),
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
  members: z.array(digits).optional(),
});

export const fileSchema = z.object({
  owners: z.array(digits).optional(),
  defaultEnvironment: envId.optional(),
  groups: z
    .record(
      z.string().regex(/@g\.us$/u, "must be a group JID, ending @g.us"),
      groupSchema,
    )
    .optional(),
});

export type GroupEntry = z.infer<typeof groupSchema>;
export type GroupsFile = z.infer<typeof fileSchema>;

export interface Group {
  jid: string;
  label: string;
  repo: string;
  environment: string | undefined;
  access: Access;
  ref: string;
  model: string | undefined;
  members: string[];
}

export interface Config {
  owners: string[];
  defaultEnvironment: string | undefined;
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

export function parseFile(raw: unknown): GroupsFile {
  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success)
    throw new CommandError(`groups.json: ${reason(parsed.error)}`);
  return parsed.data;
}

export function toConfig(file: GroupsFile, extraOwners: string[]): Config {
  const groups = new Map<string, Group>();
  for (const [jid, entry] of Object.entries(file.groups ?? {})) {
    groups.set(jid, {
      jid,
      label: entry.label ?? jid,
      repo: entry.repo,
      environment: entry.environment,
      access: entry.access,
      ref: entry.ref ?? "main",
      model: entry.model,
      members: entry.members ?? [],
    });
  }
  return {
    owners: [...new Set([...extraOwners, ...(file.owners ?? [])])],
    defaultEnvironment: file.defaultEnvironment,
    groups,
  };
}

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
export const withoutGroup = (file: GroupsFile, jid: string): GroupsFile => ({
  ...file,
  groups: Object.fromEntries(
    Object.entries(file.groups ?? {}).filter(([key]) => key !== jid),
  ),
});

/** One entry checked on its own, with the same rules as the file. */
export function checkEntry(jid: string, entry: GroupEntry): void {
  parseFile({ groups: { [jid]: entry } });
}

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
