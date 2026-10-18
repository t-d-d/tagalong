// service/launch.py for real, in a pseudo-terminal, with a stand-in `claude`
// on PATH that prints what the real one prints (cloud-sessions.md).
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { run } from "./src/run.ts";

const launcher = fileURLToPath(new URL("launch.py", import.meta.url));

function stand(script: string) {
  const bin = mkdtempSync(join(tmpdir(), "tagalong-bin-"));
  const claude = join(bin, "claude");
  writeFileSync(claude, `#!/bin/sh\n${script}\n`);
  chmodSync(claude, 0o755);
  const prompt = join(bin, "prompt.txt");
  writeFileSync(prompt, "Fix the build.\nThanks");
  const record = join(bin, "args.txt");
  return { bin, prompt, record };
}

const launch = (
  where: ReturnType<typeof stand>,
  env: Record<string, string> = {},
) =>
  run("python3", [launcher, where.prompt], {
    cwd: where.bin,
    env: {
      PATH: `${where.bin}:/usr/bin:/bin`,
      HOME: where.bin,
      RECORD: where.record,
      ...env,
    },
    timeoutMs: 20_000,
  });

describe("the launcher", () => {
  it("runs claude --cloud in a terminal with the group's mode and ref, and stops at the marker", async () => {
    const where = stand(
      '[ -t 1 ] && echo tty > "$RECORD.tty"; printf "%s\\n" "$@" > "$RECORD"; echo "$DISABLE_GROWTHBOOK" > "$RECORD.gb"; echo "Created https://claude.ai/code/session_01Abcdefghij"; echo "Resume with: claude --teleport session_01Abcdefghij"; sleep 30',
    );
    const started = Date.now();
    const { code, out } = await launch(where, {
      CLAUDE_PERMISSION_MODE: "dontAsk",
      CLAUDE_REF: "dev",
      CLAUDE_SESSION_NAME: "WhatsApp: fix",
      CLAUDE_MODEL: "opus",
    });
    expect(code).toBe(0);
    expect(out).toContain("session_01Abcdefghij");
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(readFileSync(where.record, "utf8").split("\n").slice(0, -1)).toEqual(
      [
        "--permission-mode",
        "dontAsk",
        "--ref",
        "dev",
        "--model",
        "opus",
        "--name",
        "WhatsApp: fix",
        "--cloud",
        "Fix the build.",
        "Thanks",
      ],
    );
    expect(readFileSync(`${where.record}.tty`, "utf8").trim()).toBe("tty");
    expect(readFileSync(`${where.record}.gb`, "utf8").trim()).toBe("1");
  });

  it("gives up at the folder-trust prompt and says where", async () => {
    const where = stand(
      'echo "Do you trust the files in this folder?"; echo "1. Yes, I trust this folder"; sleep 30',
    );
    const { code, out } = await launch(where);
    expect(code).not.toBe(0);
    expect(out).toContain("folder-trust prompt");
  });

  it("fails when claude exits without a session", async () => {
    const where = stand('echo "Error: not logged in"; exit 1');
    const { code, out } = await launch(where);
    expect(code).toBe(1);
    expect(out).toContain("not logged in");
  });
});
