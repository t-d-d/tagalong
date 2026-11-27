// Global setup for every tier: points the temp folder at a fresh folder for
// the run, then fails the run if a test left a tagalong-* folder in it, and
// removes it either way, so a gate run leaves nothing behind.
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default function setup(): () => void {
  const before = process.env.TMPDIR;
  const root = mkdtempSync(join(tmpdir(), "tagalong-run-"));
  // os.tmpdir() reads TMPDIR, and the test workers inherit it.
  process.env.TMPDIR = root;
  return () => {
    // Watch mode runs this setup again in the same process after a config
    // change, so it must not start from the folder removed below.
    if (before === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = before;
    const left = readdirSync(root).filter((name) =>
      name.startsWith("tagalong-"),
    );
    rmSync(root, { recursive: true, force: true });
    if (left.length > 0) {
      throw new Error(
        `Tests left ${String(left.length)} temporary folders behind, such as ${left.slice(0, 5).join(", ")}. Make them with tempDir from test/temp.ts.`,
      );
    }
  };
}
