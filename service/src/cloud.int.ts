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
  it("is one per repo and environment, shared by Claudes that share them", () => {
    const { cloud } = setup();
    const claude = {
      name: "critic",
      repo: "o/r",
      environment: undefined,
      access: "read-only" as const,
      ref: "main",
      model: undefined,
      role: undefined,
    };
    const dir = cloud.workspaceFor(claude);
    expect(dir.endsWith("o__r")).toBe(true);
    expect(cloud.workspaceFor({ ...claude, name: "other" })).toBe(dir);
  });
});
