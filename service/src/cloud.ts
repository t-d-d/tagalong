// Starting a Claude Code cloud session and talking to one (cloud-sessions.md).
// A session is started the way podstow's dispatcher starts one: from a bare
// workspace whose origin is the repo, by service/launch.py, which gives
// `claude --cloud` the terminal it needs.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { Env } from "./env.ts";
import { lastSession, oneLine, stripAnsi } from "./format.ts";
import { ACCESS, type Claude } from "./groups.ts";
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
   * A bare workspace for the Claude's repo and environment: an empty git repo
   * whose origin is the GitHub repo, which `claude --cloud` clones from its
   * side, and the environment in its local settings.
   */
  workspaceFor(claude: Claude): string {
    const dir = join(
      this.#env.WORKSPACES_DIR,
      `${claude.repo.replace("/", "__")}${claude.environment === undefined ? "" : `__${claude.environment}`}`,
    );
    if (!existsSync(join(dir, ".git"))) {
      mkdirSync(dir, { recursive: true });
      execFileSync("git", ["init", "-q"], { cwd: dir });
      execFileSync(
        "git",
        ["remote", "add", "origin", `https://github.com/${claude.repo}.git`],
        { cwd: dir },
      );
    }
    mkdirSync(join(dir, ".claude"), { recursive: true });
    const settings =
      claude.environment === undefined
        ? {}
        : { remote: { defaultEnvironmentId: claude.environment } };
    writeFileSync(
      join(dir, ".claude", "settings.local.json"),
      `${JSON.stringify(settings, null, 2)}\n`,
    );
    this.#login.trust(dir);
    return dir;
  }

  /** Start a session for `claude`; returns its id. */
  async start(claude: Claude, prompt: string, name: string): Promise<string> {
    const cwd = this.workspaceFor(claude);
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
            CLAUDE_PERMISSION_MODE: ACCESS[claude.access],
            CLAUDE_REF: claude.ref,
            CLAUDE_MODEL: claude.model ?? "",
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
}
