import { describe, expect, it } from "vitest";
import { cliEnv, readEnv } from "./env.ts";

describe("readEnv", () => {
  it("gives the container's defaults", () => {
    const env = readEnv({ HOME: "/data/home" });
    expect(env.BRIDGE_STORE).toBe("/data/bridge/store");
    expect(env.PORT).toBe(8769);
    expect(env.DRY_RUN).toBe(false);
    expect(env.LOGIN_PARAMETER).toBeUndefined();
    expect(env.LAUNCHER.endsWith("service/launch.py")).toBe(true);
  });

  it("reads an empty value as unset, and numbers as numbers", () => {
    const env = readEnv({
      HOME: "/h",
      LOGIN_PARAMETER: "",
      POLL_MS: "500",
      DRY_RUN: "1",
    });
    expect(env.LOGIN_PARAMETER).toBeUndefined();
    expect(env.POLL_MS).toBe(500);
    expect(env.DRY_RUN).toBe(true);
  });

  it("refuses what it cannot use", () => {
    expect(() => readEnv({})).toThrow();
    expect(() => readEnv({ HOME: "/h", POLL_MS: "soon" })).toThrow();
    expect(() => readEnv({ HOME: "/h", DRY_RUN: "yes" })).toThrow();
  });

  it("names the org to the CLI when it is known", () => {
    const env = readEnv({ HOME: "/h", CLAUDE_CODE_ORGANIZATION_UUID: "org" });
    expect(cliEnv(env, { EXTRA: "1" })).toMatchObject({
      HOME: "/h",
      CLAUDE_CODE_ORGANIZATION_UUID: "org",
      EXTRA: "1",
    });
  });
});
