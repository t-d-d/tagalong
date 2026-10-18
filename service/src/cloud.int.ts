import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { serviceEnv } from "../../test/service-env.ts";
import { Cloud } from "./cloud.ts";
import { Login } from "./login.ts";
import { run } from "./run.ts";

function setup() {
  const env = serviceEnv("/nonexistent");
  const login = new Login({
    env,
    aws: undefined,
    run,
    now: () => 0,
    platform: "linux",
  });
  return { env, cloud: new Cloud(env, login, run) };
}

describe("workspaces", () => {
  it("are trusted when the CLI trusts their folder or one above it", () => {
    const { env, cloud } = setup();
    expect(cloud.trusted()).toBe(false);
    writeFileSync(
      join(env.HOME, ".claude.json"),
      JSON.stringify({
        projects: {
          [join(env.WORKSPACES_DIR, "..")]: { hasTrustDialogAccepted: true },
        },
      }),
    );
    expect(cloud.trusted()).toBe(true);
  });

  it("drops the environment setting when a group no longer names one", () => {
    const { cloud } = setup();
    const group = {
      jid: "g@g.us",
      label: "g",
      repo: "o/r",
      environment: undefined,
      access: "read-only" as const,
      ref: "main",
      model: undefined,
      members: [],
    };
    const dir = cloud.workspaceFor(group);
    expect(dir.endsWith("o__r")).toBe(true);
    expect(cloud.workspaceFor(group)).toBe(dir);
  });
});
