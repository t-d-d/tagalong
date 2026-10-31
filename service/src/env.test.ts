import { describe, expect, it } from "vitest";
import { cliEnv, readEnv, readLinkEnv } from "./env.ts";

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

  it("takes an upload link that ends where the session's id goes", () => {
    const link = "https://abc.execute-api.example.test/up/";
    expect(readEnv({ HOME: "/h", UPLOAD_LINK: link }).UPLOAD_LINK).toBe(link);
    expect(
      readEnv({ HOME: "/h", UPLOAD_LINK: "" }).UPLOAD_LINK,
    ).toBeUndefined();
    expect(() =>
      readEnv({ HOME: "/h", UPLOAD_LINK: link.slice(0, -1) }),
    ).toThrow();
    expect(() => readEnv({ HOME: "/h", UPLOAD_LINK: "not a link/" })).toThrow();
  });

  it("gives the upload link's Lambda its bucket, and nothing without one", () => {
    expect(readLinkEnv({ ATTACHMENTS_BUCKET: "files" })).toEqual({
      ATTACHMENTS_BUCKET: "files",
      AWS_REGION: undefined,
    });
    expect(() => readLinkEnv({})).toThrow();
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
