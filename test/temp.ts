// Temporary folders for tests. Each one is removed when its test file ends,
// by the afterAll in test/temp-cleanup.ts.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const made: string[] = [];

/** A new empty folder under the temp folder, named from the prefix. */
export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

/** Removes every folder tempDir made in this test file. */
export function removeTempDirs(): void {
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}
