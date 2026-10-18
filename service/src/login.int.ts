import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fakeAws } from "../../test/fake-aws.ts";
import { eventsOf, logLines } from "../../test/log-lines.ts";
import { readEnv } from "./env.ts";
import { Login, SESSION_SCOPE, readRecord, writeRecord } from "./login.ts";
import type { Runner } from "./run.ts";

const NOW = Date.parse("2026-10-18T17:00:00Z");
const PARAMETER = "/tagalong/claude-login";
const account = { accountUuid: "acc-1", organizationUuid: "org-1" };

const credentials = (accessToken: string, expiresAt: number) =>
  JSON.stringify({
    claudeAiOauth: {
      accessToken,
      refreshToken: `refresh-${accessToken}`,
      expiresAt,
      scopes: [SESSION_SCOPE],
    },
  });

function setup(runner: Runner = () => Promise.resolve({ code: 0, out: "" })) {
  const home = mkdtempSync(join(tmpdir(), "tagalong-home-"));
  const env = readEnv({
    HOME: home,
    LOGIN_PARAMETER: PARAMETER,
    CLAUDE_BIN: "fake-claude",
  });
  const aws = fakeAws();
  const login = new Login({
    env,
    aws,
    run: runner,
    now: () => NOW,
    platform: "linux",
  });
  const file = join(home, ".claude", ".credentials.json");
  return { home, env, aws, login, file };
}

describe("restoring the login", () => {
  it("puts the stored login where the CLI reads it, and finishes onboarding", async () => {
    const { aws, login, file, home } = setup();
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("stored", NOW + 3_600_000), account),
    );
    await login.restore();
    expect(readFileSync(file, "utf8")).toBe(
      credentials("stored", NOW + 3_600_000),
    );
    expect(
      JSON.parse(readFileSync(join(home, ".claude.json"), "utf8")),
    ).toMatchObject({
      hasCompletedOnboarding: true,
      oauthAccount: account,
    });
    expect(login.orgUuid()).toBe("org-1");
    expect(login.accessToken()).toBe("stored");
    expect(login.cliEnv()).toMatchObject({
      CLAUDE_CODE_ORGANIZATION_UUID: "org-1",
    });
  });

  it("keeps a newer login from the volume, and writes it back", async () => {
    const { aws, login, file } = setup();
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("stored", NOW + 1000), account),
    );
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, credentials("newer", NOW + 7_200_000));
    await login.restore();
    expect(readFileSync(file, "utf8")).toBe(
      credentials("newer", NOW + 7_200_000),
    );
    expect(readRecord(aws.secrets.get(PARAMETER) ?? "")).toEqual({
      credentials: credentials("newer", NOW + 7_200_000),
      account,
    });
  });

  it("says loudly when there is no stored login", async () => {
    const { lines } = logLines();
    const { login, file } = setup();
    await login.restore();
    expect(existsSync(file)).toBe(false);
    expect(lines).toContainEqual(
      expect.objectContaining({ level: "error", event: "login-missing" }),
    );
  });
});

describe("trusting a workspace", () => {
  it("adds the one folder, keeping everything the CLI wrote", () => {
    const { login, home } = setup();
    const config = join(home, ".claude.json");
    writeFileSync(
      config,
      JSON.stringify({
        numStartups: 3,
        projects: { "/data/workspaces/o__r": { allowedTools: ["Bash"] } },
      }),
    );
    login.trust("/data/workspaces/o__r");
    login.trust("/data/workspaces/o__other/");
    expect(JSON.parse(readFileSync(config, "utf8"))).toEqual({
      numStartups: 3,
      projects: {
        "/data/workspaces/o__r": {
          allowedTools: ["Bash"],
          hasTrustDialogAccepted: true,
        },
        "/data/workspaces/o__other": { hasTrustDialogAccepted: true },
      },
    });
  });
});

describe("keeping the login fresh", () => {
  it("does nothing while the token has time left", async () => {
    const calls: string[][] = [];
    const { aws, login } = setup((_command, args) => {
      calls.push(args);
      return Promise.resolve({ code: 0, out: "" });
    });
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("stored", NOW + 3_600_000), account),
    );
    await login.restore();
    await login.keepFresh();
    expect(calls).toEqual([]);
  });

  it("asks the CLI when it is near expiry, and stores the refresh", async () => {
    const { lines } = logLines();
    const calls: string[][] = [];
    const harness = { file: "" };
    const { aws, login, file } = setup((_command, args) => {
      calls.push(args);
      // auth status does not refresh; the prompt does.
      if (args[0] === "-p")
        writeFileSync(
          harness.file,
          credentials("refreshed", NOW + 8 * 3_600_000),
        );
      return Promise.resolve({ code: 0, out: "" });
    });
    harness.file = file;
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("stored", NOW + 60_000), account),
    );
    await login.restore();
    await login.keepFresh();
    expect(calls.map((args) => args[0])).toEqual(["auth", "-p"]);
    expect(readRecord(aws.secrets.get(PARAMETER) ?? "").credentials).toBe(
      credentials("refreshed", NOW + 8 * 3_600_000),
    );
    expect(eventsOf(lines)).toEqual(
      expect.arrayContaining(["login-refreshed", "login-stored"]),
    );
  });

  it("raises an alert when the CLI cannot refresh it", async () => {
    const { lines } = logLines();
    const { aws, login } = setup();
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("stored", NOW + 60_000), account),
    );
    await login.restore();
    await login.keepFresh();
    expect(lines.at(-1)).toMatchObject({ level: "error", event: "login-dead" });
  });

  it("refuses to store a login the CLI has broken", async () => {
    const { lines } = logLines();
    const { aws, login, file } = setup();
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("stored", NOW + 3_600_000), account),
    );
    await login.restore();
    writeFileSync(
      file,
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "a",
          refreshToken: "",
          scopes: [SESSION_SCOPE],
        },
      }),
    );
    await login.storeIfRefreshed();
    expect(readRecord(aws.secrets.get(PARAMETER) ?? "").credentials).toBe(
      credentials("stored", NOW + 3_600_000),
    );
    expect(lines.at(-1)).toMatchObject({
      level: "error",
      event: "login-dead",
      why: "refresh token refused",
    });
  });
});
