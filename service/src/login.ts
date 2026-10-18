// The claude.ai login sessions are started with (claude-login.md). In the
// task it lives in Parameter Store and is restored to the CLI's credentials
// file; every refresh the CLI makes is written back. On a laptop the CLI's
// own login is read and nothing is written.
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import type { Aws } from "./aws.ts";
import { type Env, cliEnv } from "./env.ts";
import { errorFields, log } from "./log.ts";
import type { Runner } from "./run.ts";

const oauthSchema = z.looseObject({
  claudeAiOauth: z.looseObject({
    accessToken: z.string(),
    refreshToken: z.string(),
    expiresAt: z.number().optional(),
    scopes: z.array(z.string()).default([]),
  }),
});

const accountSchema = z.object({
  accountUuid: z.string().min(1),
  organizationUuid: z.string().min(1),
});
const recordSchema = z.object({
  credentials: z.string(),
  account: accountSchema.optional(),
});
const configSchema = z.looseObject({
  oauthAccount: z
    .looseObject({ organizationUuid: z.string().optional() })
    .optional(),
});
const cliConfigSchema = z.looseObject({
  projects: z.record(z.string(), z.looseObject({})).optional(),
});
type Config = z.infer<typeof cliConfigSchema>;

export type Account = z.infer<typeof accountSchema>;

export const SESSION_SCOPE = "user:sessions:claude_code";
/** Refresh when the access token has less than this left. */
const MARGIN_MS = 30 * 60_000;

/** A stored login: the credentials text verbatim, beside its account (podstow's record). */
export function readRecord(text: string): {
  credentials: string;
  account: Account | undefined;
} {
  try {
    const parsed = recordSchema.safeParse(JSON.parse(text));
    if (parsed.success)
      return {
        credentials: parsed.data.credentials,
        account: parsed.data.account,
      };
  } catch {
    // Not JSON at all: not a login either, which parseCredentials says.
  }
  return { credentials: text, account: undefined };
}

export const writeRecord = (
  credentials: string,
  account: Account | undefined,
): string =>
  account === undefined
    ? credentials
    : JSON.stringify({ credentials, account });

/** Whether credentials text is a usable login, and when its access token expires. */
export function parseCredentials(
  text: string,
):
  | { ok: true; accessToken: string; expiresAt: number | undefined }
  | { ok: false; reason: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not JSON" };
  }
  const parsed = oauthSchema.safeParse(data);
  if (!parsed.success) return { ok: false, reason: "no claudeAiOauth entry" };
  const oauth = parsed.data.claudeAiOauth;
  if (oauth.accessToken === "") return { ok: false, reason: "no access token" };
  // The CLI writes "" for a refresh token the server refused.
  if (oauth.refreshToken === "")
    return { ok: false, reason: "refresh token refused" };
  if (!oauth.scopes.includes(SESSION_SCOPE))
    return {
      ok: false,
      reason: `lacks ${SESSION_SCOPE}: a setup-token, not a login`,
    };
  return {
    ok: true,
    accessToken: oauth.accessToken,
    expiresAt: oauth.expiresAt,
  };
}

export interface LoginDeps {
  env: Env;
  aws: Aws | undefined;
  run: Runner;
  now: () => number;
  platform: NodeJS.Platform;
}

export class Login {
  readonly #deps: LoginDeps;
  #account: Account | undefined;
  #stored: string | undefined;

  constructor(deps: LoginDeps) {
    this.#deps = deps;
  }

  get #file(): string {
    return join(this.#deps.env.HOME, ".claude", ".credentials.json");
  }

  get #parameter(): string | undefined {
    return this.#deps.env.LOGIN_PARAMETER;
  }

  #read(): string | undefined {
    return existsSync(this.#file)
      ? readFileSync(this.#file, "utf8")
      : undefined;
  }

  #write(text: string): void {
    mkdirSync(dirname(this.#file), { recursive: true, mode: 0o700 });
    writeFileSync(this.#file, text, { mode: 0o600 });
    chmodSync(this.#file, 0o600);
  }

  /**
   * In the task: put the stored login where the CLI reads it, unless the
   * file already holds a newer one (a refresh not yet written back), and
   * mark onboarding done (cloud-sessions.md).
   */
  async restore(): Promise<void> {
    const name = this.#parameter;
    const aws = this.#deps.aws;
    if (name === undefined || aws === undefined) return;
    const value = await aws.getSecret(name);
    if (value === undefined) {
      log.error("login-missing", { parameter: name });
      return;
    }
    const record = readRecord(value);
    this.#account = record.account;
    const stored = parseCredentials(record.credentials);
    const local = this.#read();
    const onDisk = local === undefined ? undefined : parseCredentials(local);
    const keepDisk =
      onDisk?.ok === true &&
      stored.ok &&
      (onDisk.expiresAt ?? 0) > (stored.expiresAt ?? 0);
    if (!keepDisk) this.#write(record.credentials);
    this.#stored = keepDisk ? undefined : record.credentials;
    this.#configure();
    log.info("login-restored", {
      from: keepDisk ? "volume" : "parameter",
      usable: stored.ok,
    });
    if (keepDisk) await this.storeIfRefreshed();
  }

  get #configPath(): string {
    return join(this.#deps.env.HOME, ".claude.json");
  }

  /** Change ~/.claude.json, keeping what the CLI wrote, in one rename. */
  #editConfig(edit: (config: Config) => Config): void {
    const path = this.#configPath;
    const current: unknown = existsSync(path)
      ? JSON.parse(readFileSync(path, "utf8"))
      : {};
    const tmp = `${path}.tagalong`;
    writeFileSync(tmp, JSON.stringify(edit(cliConfigSchema.parse(current))), {
      mode: 0o600,
    });
    renameSync(tmp, path);
  }

  /** ~/.claude.json: onboarding done, and the account. */
  #configure(): void {
    this.#editConfig((config) => ({
      ...config,
      hasCompletedOnboarding: true,
      ...(this.#account === undefined ? {} : { oauthAccount: this.#account }),
    }));
  }

  /**
   * Trust one workspace, in the task only, where tagalong owns HOME. The
   * CLI carries a folder's trust down only as far as a git repo's root, and
   * each workspace is a repo of its own, so each needs its own entry
   * (cloud-sessions.md). Called from the CLI queue, so no CLI writes the
   * file at the same time.
   */
  trust(dir: string): void {
    if (this.#parameter === undefined) return;
    const key = resolve(dir);
    this.#editConfig((config) => ({
      ...config,
      projects: {
        ...config.projects,
        [key]: { ...config.projects?.[key], hasTrustDialogAccepted: true },
      },
    }));
  }

  /** The org the login belongs to, for the environments list and the CLI. */
  orgUuid(): string | undefined {
    const env = this.#deps.env;
    if (env.CLAUDE_CODE_ORGANIZATION_UUID !== undefined)
      return env.CLAUDE_CODE_ORGANIZATION_UUID;
    if (this.#account !== undefined) return this.#account.organizationUuid;
    const path = join(env.HOME, ".claude.json");
    if (!existsSync(path)) return undefined;
    return configSchema.parse(JSON.parse(readFileSync(path, "utf8")))
      .oauthAccount?.organizationUuid;
  }

  /** The CLI's environment, with the org named so it skips its profile lookup. */
  cliEnv(extra: Record<string, string> = {}): Record<string, string> {
    const org = this.orgUuid();
    return cliEnv(this.#deps.env, {
      ...(org === undefined ? {} : { CLAUDE_CODE_ORGANIZATION_UUID: org }),
      ...extra,
    });
  }

  #loginText(): string | undefined {
    const file = this.#read();
    if (file !== undefined) return file;
    if (this.#deps.platform !== "darwin") return undefined;
    // On a Mac the CLI keeps its own login in the Keychain.
    try {
      return execFileSync(
        "security",
        ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
        {
          encoding: "utf8",
        },
      );
    } catch {
      return undefined;
    }
  }

  accessToken(): string {
    const given = this.#deps.env.CLAUDE_OAUTH_TOKEN;
    if (given !== undefined) return given;
    const text = this.#loginText();
    const parsed = text === undefined ? undefined : parseCredentials(text);
    if (parsed?.ok !== true) throw new Error("no usable claude.ai login");
    return parsed.accessToken;
  }

  #expiresAt(): number | undefined {
    const text = this.#read();
    const parsed = text === undefined ? undefined : parseCredentials(text);
    return parsed?.ok === true ? parsed.expiresAt : undefined;
  }

  /** After any CLI run: a login the CLI refreshed goes back to Parameter Store. */
  async storeIfRefreshed(): Promise<void> {
    const name = this.#parameter;
    const aws = this.#deps.aws;
    const text = this.#read();
    if (
      name === undefined ||
      aws === undefined ||
      text === undefined ||
      text === this.#stored
    )
      return;
    const parsed = parseCredentials(text);
    if (!parsed.ok) {
      log.error("login-dead", { why: parsed.reason });
      return;
    }
    await aws.putSecret(name, writeRecord(text, this.#account));
    this.#stored = text;
    log.info("login-stored", {
      expiresInMinutes: Math.round(
        ((parsed.expiresAt ?? 0) - this.#deps.now()) / 60_000,
      ),
    });
  }

  /**
   * Keep the access token usable while nothing else runs the CLI: the
   * sessions API needs it to read answers. `claude auth status` first; if
   * that does not refresh it, a one-line prompt, which must.
   */
  async keepFresh(): Promise<void> {
    if (this.#parameter === undefined) return;
    const expires = this.#expiresAt();
    if (expires !== undefined && expires - this.#deps.now() > MARGIN_MS) return;
    const attempts: string[][] = [
      ["auth", "status", "--json"],
      [
        "-p",
        "Reply with the word ok.",
        "--model",
        "haiku",
        "--output-format",
        "json",
      ],
    ];
    for (const args of attempts) {
      const dir = mkdtempSync(join(tmpdir(), "tagalong-refresh-"));
      try {
        await this.#deps.run(this.#deps.env.CLAUDE_BIN, args, {
          cwd: dir,
          env: this.cliEnv(),
          timeoutMs: 120_000,
        });
      } catch (error) {
        log.warn("login-refreshed", { ok: false, ...errorFields(error) });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      const after = this.#expiresAt();
      if (after !== undefined && after - this.#deps.now() > MARGIN_MS) {
        log.info("login-refreshed", {
          by: args[0] === "auth" ? "auth-status" : "prompt",
        });
        await this.storeIfRefreshed();
        return;
      }
    }
    log.error("login-dead", {
      why: "the CLI did not refresh the access token",
    });
  }
}
