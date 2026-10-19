// Running other programs, and keeping CLI runs one at a time: a login refresh
// rotates the refresh token, so two CLIs refreshing at once would kill one
// of them (claude-login.md).
import { spawn } from "node:child_process";

export interface RunResult {
  code: number;
  out: string;
}

export interface RunOptions {
  cwd?: string;
  input?: string;
  env: Record<string, string>;
  timeoutMs?: number;
}

export type Runner = (
  command: string,
  args: string[],
  options: RunOptions,
) => Promise<RunResult>;

export const run: Runner = (command, args, options) =>
  new Promise((resolve) => {
    // A child given no input gets no stdin pipe at all (issue #2).
    const child = spawn(command, args, {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      env: options.env,
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let out = "";
    const timer = setTimeout(
      () => child.kill("SIGKILL"),
      options.timeoutMs ?? 300_000,
    );
    child.stdout?.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, out: `${out}\n${error.name}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, out });
    });
    // A child may exit without reading all of its input. The broken pipe
    // is its business; its exit code says how it went.
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(options.input);
  });

/** One task at a time, in order. */
export class Serial {
  #tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.#tail.then(task, task);
    this.#tail = next.catch(() => undefined);
    return next;
  }
}
