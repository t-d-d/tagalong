// Starting a Claude Code cloud session and talking to one (cloud-sessions.md).
// A session is started the way podstow's dispatcher starts one: from a bare
// workspace whose origin is the repo, by service/launch.py, which gives
// `claude --cloud` the terminal it needs.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import type { Env } from "./env.ts";
import { lastSession, oneLine, stripAnsi } from "./format.ts";
import { ACCESS, type Group } from "./groups.ts";
import { CommandError } from "./log.ts";
import type { Login } from "./login.ts";
import type { Runner } from "./run.ts";

const sendSchema = z.looseObject({
  ok: z.boolean(),
  error: z.string().optional(),
});

// What a failed launch printed, as a word safe to log: the output itself can
// hold the prompt (logging.md).
const FAILURES: [RegExp, string][] = [
  [/trust this folder|folder-trust prompt/iu, "folder-untrusted"],
  [
    /not logged in|please run \/login|invalid api key|oauth|authenticat|\b401\b/iu,
    "not-logged-in",
  ],
  [/rate.?limit|usage limit|\b429\b/iu, "limit"],
  [/github/iu, "github"],
  [/unknown option|error: option|unexpected argument/iu, "cli-flags"],
];

/** Why the launcher gave no session, in one word. */
export function launchFailure(code: number, out: string): string {
  const text = stripAnsi(out);
  const found = FAILURES.find(([pattern]) => pattern.test(text));
  if (found !== undefined) return found[1];
  // 3: the CLI printed no confirmation in time (service/launch.py).
  return code === 3 ? "no-confirmation" : "unknown";
}

export class Cloud {
  readonly #env: Env;
  readonly #login: Login;
  readonly #run: Runner;

  constructor(env: Env, login: Login, run: Runner) {
    this.#env = env;
    this.#login = login;
    this.#run = run;
  }

  /**
   * A bare workspace for the group's repo and environment: an empty git repo
   * whose origin is the GitHub repo, which `claude --cloud` clones from its
   * side, and the environment in its local settings.
   */
  workspaceFor(group: Group): string {
    const dir = join(
      this.#env.WORKSPACES_DIR,
      `${group.repo.replace("/", "__")}${group.environment === undefined ? "" : `__${group.environment}`}`,
    );
    if (!existsSync(join(dir, ".git"))) {
      mkdirSync(dir, { recursive: true });
      execFileSync("git", ["init", "-q"], { cwd: dir });
      execFileSync(
        "git",
        ["remote", "add", "origin", `https://github.com/${group.repo}.git`],
        { cwd: dir },
      );
    }
    mkdirSync(join(dir, ".claude"), { recursive: true });
    const settings =
      group.environment === undefined
        ? {}
        : { remote: { defaultEnvironmentId: group.environment } };
    writeFileSync(
      join(dir, ".claude", "settings.local.json"),
      `${JSON.stringify(settings, null, 2)}\n`,
    );
    return dir;
  }

  /** Start a session for `group`; returns its id. */
  async start(group: Group, prompt: string, name: string): Promise<string> {
    const cwd = this.workspaceFor(group);
    const dir = mkdtempSync(join(tmpdir(), "tagalong-prompt-"));
    const file = join(dir, "prompt.txt");
    writeFileSync(file, prompt, { mode: 0o600 });
    try {
      const { code, out } = await this.#run(
        this.#env.PYTHON,
        [this.#env.LAUNCHER, file],
        {
          cwd,
          env: this.#login.cliEnv({
            CLAUDE_SESSION_NAME: name,
            CLAUDE_PERMISSION_MODE: ACCESS[group.access],
            CLAUDE_REF: group.ref,
            CLAUDE_MODEL: group.model ?? "",
          }),
          timeoutMs: 300_000,
        },
      );
      const id = lastSession(stripAnsi(out));
      // 0 confirmed; 3 unconfirmed, a session may exist; anything else, nothing started.
      if (id === null)
        throw new CommandError(
          `the launcher exited ${String(code)} without a session (${launchFailure(code, out)})`,
        );
      return id;
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await this.#login.storeIfRefreshed();
    }
  }

  /** Queue a message into a session. A session podstow archived refuses it. */
  async send(id: string, text: string): Promise<"sent" | "gone"> {
    try {
      const { code, out } = await this.#run(
        this.#env.CLAUDE_BIN,
        ["-p", "--cloud", `session_${id}`, "--output-format", "json"],
        { env: this.#login.cliEnv(), input: text, timeoutMs: 120_000 },
      );
      const last = out.trim().split("\n").at(-1) ?? "";
      let parsed: z.infer<typeof sendSchema> | undefined;
      try {
        const result = sendSchema.safeParse(JSON.parse(last));
        parsed = result.success ? result.data : undefined;
      } catch {
        parsed = undefined;
      }
      if (code === 0 && parsed?.ok === true) return "sent";
      const why = parsed?.error ?? oneLine(out);
      if (/archived|not found/iu.test(why)) return "gone";
      throw new CommandError(
        `could not reach the session (exit ${String(code)})`,
      );
    } finally {
      await this.#login.storeIfRefreshed();
    }
  }

  /** Whether the CLI trusts the workspaces folder, or a folder above it. */
  trusted(): boolean {
    const path = join(this.#env.HOME, ".claude.json");
    if (!existsSync(path)) return false;
    const projects =
      z
        .looseObject({
          projects: z
            .record(
              z.string(),
              z.looseObject({ hasTrustDialogAccepted: z.boolean().optional() }),
            )
            .optional(),
        })
        .parse(JSON.parse(readFileSync(path, "utf8"))).projects ?? {};
    for (let dir = resolve(this.#env.WORKSPACES_DIR); ; dir = dirname(dir)) {
      if (projects[dir]?.hasTrustDialogAccepted === true) return true;
      if (dirname(dir) === dir) return false;
    }
  }
}
