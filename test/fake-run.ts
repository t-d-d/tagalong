// A Runner that stands in for the launcher and the Claude CLI, and runs
// anything else (git, tar) for real. Each call is recorded.
import { readFileSync } from "node:fs";
import {
  type RunOptions,
  type RunResult,
  type Runner,
  run,
} from "../service/src/run.ts";

export interface Call {
  command: string;
  args: string[];
  options: RunOptions;
  /** The launcher's prompt, read from its file while the call ran. */
  prompt?: string;
}

export interface FakeRun {
  run: Runner;
  calls: Call[];
  /** Session ids the launcher hands out, in order. */
  launches: string[];
  /** What `claude -p --cloud session_<id>` answers, by id: sent, or the session is gone. */
  followUps: Map<string, "sent" | "archived">;
  /** Anything else the CLI is asked, such as a login refresh. */
  onClaude: (args: string[], options: RunOptions) => RunResult;
  /** Each message that reaches a session: a launch's prompt, or a follow-up's input. */
  onDeliver: (session: string, text: string) => void;
  /** Work that happens while a follow-up is on its way, such as a poll. */
  during: (() => Promise<void>) | undefined;
  /** Work that happens while a session is being started, such as a poll. */
  duringLaunch: (() => Promise<void>) | undefined;
}

export function fakeRun(names: { python: string; claude: string }): FakeRun {
  const fake: FakeRun = {
    calls: [],
    launches: [],
    followUps: new Map(),
    onClaude: () => ({ code: 0, out: "{}" }),
    onDeliver: () => undefined,
    during: undefined,
    duringLaunch: undefined,
    run: (command, args, options) => {
      const call: Call = { command, args, options };
      fake.calls.push(call);
      if (command === names.python) {
        call.prompt = readFileSync(args[1] ?? "", "utf8");
        const id = fake.launches.shift();
        if (id !== undefined) fake.onDeliver(id, call.prompt);
        const done = fake.duringLaunch?.() ?? Promise.resolve();
        return done.then(() =>
          id === undefined
            ? { code: 1, out: "Error: could not start a session\n" }
            : {
                code: 0,
                out: `\u001b[2mCreated session\u001b[0m https://claude.ai/code/session_${id}\nResume with: claude --teleport session_${id}\n`,
              },
        );
      }
      if (command === names.claude) {
        const target =
          args[0] === "-p" && args[1] === "--cloud" ? args[2] : undefined;
        if (target !== undefined) {
          const id = target.replace(/^session_/u, "");
          const answer = fake.followUps.get(id) ?? "sent";
          if (answer === "sent") fake.onDeliver(id, options.input ?? "");
          const done = fake.during?.() ?? Promise.resolve();
          return done.then(() =>
            answer === "sent"
              ? {
                  code: 0,
                  out: JSON.stringify({
                    ok: true,
                    session_id: target,
                    url: `https://claude.ai/code/${target}`,
                  }),
                }
              : {
                  code: 1,
                  out: JSON.stringify({
                    ok: false,
                    error: "Session is archived",
                  }),
                },
          );
        }
        return Promise.resolve(fake.onClaude(args, options));
      }
      return run(command, args, options);
    },
  };
  return fake;
}
