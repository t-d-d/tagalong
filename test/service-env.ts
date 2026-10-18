// An Env for the int tier: every folder in a temporary directory, every
// service on loopback.
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Env, readEnv } from "../service/src/env.ts";

export function serviceEnv(
  store: string,
  extra: Record<string, string> = {},
): Env {
  const root = mkdtempSync(join(tmpdir(), "tagalong-data-"));
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  return readEnv({
    HOME: home,
    PORT: "1",
    BRIDGE_URL: "http://127.0.0.1:1/api",
    BRIDGE_STORE: store,
    GROUPS_FILE: join(root, "groups.json"),
    STATE_FILE: join(root, "state.json"),
    WORKSPACES_DIR: join(root, "workspaces"),
    PYTHON: "fake-python",
    CLAUDE_BIN: "fake-claude",
    CLAUDE_API_BASE: "http://127.0.0.1:1",
    CLAUDE_OAUTH_TOKEN: "access-token-for-tests",
    CLAUDE_CODE_ORGANIZATION_UUID: "00000000-0000-4000-8000-000000000000",
    ...extra,
  });
}
