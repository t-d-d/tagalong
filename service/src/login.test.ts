import { describe, expect, it } from "vitest";
import {
  SESSION_SCOPE,
  parseCredentials,
  readRecord,
  writeRecord,
} from "./login.ts";

const credentials = (oauth: Record<string, unknown>) =>
  JSON.stringify({
    claudeAiOauth: {
      accessToken: "a",
      refreshToken: "r",
      expiresAt: 1000,
      scopes: ["user:inference", SESSION_SCOPE],
      ...oauth,
    },
  });

describe("parseCredentials", () => {
  it("takes a login with the sessions scope", () => {
    expect(parseCredentials(credentials({}))).toEqual({
      ok: true,
      accessToken: "a",
      expiresAt: 1000,
    });
  });

  it("refuses a setup-token, a refused refresh token and anything else", () => {
    const setupToken = parseCredentials(
      credentials({ scopes: ["user:inference"] }),
    );
    expect(setupToken.ok).toBe(false);
    expect(setupToken.ok ? "" : setupToken.reason).toContain("setup-token");
    expect(parseCredentials(credentials({ refreshToken: "" }))).toEqual({
      ok: false,
      reason: "refresh token refused",
    });
    expect(parseCredentials("{}")).toEqual({
      ok: false,
      reason: "no claudeAiOauth entry",
    });
    expect(parseCredentials("not json")).toEqual({
      ok: false,
      reason: "not JSON",
    });
  });
});

describe("the stored record", () => {
  const account = { accountUuid: "acc", organizationUuid: "org" };

  it("keeps the credentials verbatim beside the account", () => {
    const text = credentials({});
    expect(readRecord(writeRecord(text, account))).toEqual({
      credentials: text,
      account,
    });
  });

  it("reads bare credentials as a record without an account", () => {
    const text = credentials({});
    expect(writeRecord(text, undefined)).toBe(text);
    expect(readRecord(text)).toEqual({ credentials: text, account: undefined });
    expect(readRecord("garbage")).toEqual({
      credentials: "garbage",
      account: undefined,
    });
  });
});
