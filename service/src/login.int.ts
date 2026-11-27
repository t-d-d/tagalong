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
import { z } from "zod";
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

function setup(
  runner: Runner = () => Promise.resolve({ code: 0, out: "" }),
  home = mkdtempSync(join(tmpdir(), "tagalong-home-")),
) {
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

  it("forgets the previous org when the restored login has no ids", async () => {
    const first = setup();
    first.aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("stored", NOW + 3_600_000), account),
    );
    await first.login.restore();
    first.login.trust("/data/workspaces/o__r");
    // A restart, with a login minted without the account's ids.
    const { aws, login, home } = setup(undefined, first.home);
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("minted", NOW + 7_200_000), undefined),
    );
    await login.restore();
    const config: unknown = JSON.parse(
      readFileSync(join(home, ".claude.json"), "utf8"),
    );
    expect(config).not.toHaveProperty("oauthAccount");
    expect(config).toMatchObject({
      hasCompletedOnboarding: true,
      projects: { "/data/workspaces/o__r": { hasTrustDialogAccepted: true } },
    });
    expect(login.orgUuid()).toBeUndefined();
  });

  it("forgets the previous org when it keeps a newer login from the volume", async () => {
    const { aws, login, file, home } = setup();
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ oauthAccount: account, hasCompletedOnboarding: true }),
    );
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("stored", NOW + 1000), undefined),
    );
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, credentials("newer", NOW + 7_200_000));
    await login.restore();
    expect(readFileSync(file, "utf8")).toBe(
      credentials("newer", NOW + 7_200_000),
    );
    const config: unknown = JSON.parse(
      readFileSync(join(home, ".claude.json"), "utf8"),
    );
    expect(config).not.toHaveProperty("oauthAccount");
    expect(login.orgUuid()).toBeUndefined();
  });

  it("names a local failure after the read, not a missing login (#137)", async () => {
    const { lines } = logLines();
    const { aws, login, home } = setup();
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("stored", NOW + 3_600_000), account),
    );
    // Half written: the CLI was stopped mid-write.
    writeFileSync(join(home, ".claude.json"), '{"projects":');
    await login.restore();
    expect(lines).toContainEqual(
      expect.objectContaining({
        level: "error",
        event: "login-restored",
        ok: false,
        error: "SyntaxError",
      }),
    );
    expect(eventsOf(lines)).not.toContain("login-missing");
  });

  it("keeps the volume's newer login after a local failure, and writes it back at the next check (#137)", async () => {
    const first = setup();
    first.aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("old", NOW + 20 * 60_000), account),
    );
    await first.login.restore();
    // The CLI refreshed it, and the task stopped before writing it back.
    writeFileSync(first.file, credentials("old-2", NOW + 8 * 3_600_000));
    writeFileSync(join(first.home, ".claude.json"), '{"projects":');
    const { lines } = logLines();
    const { aws, login, file } = setup(undefined, first.home);
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("old", NOW + 20 * 60_000), account),
    );
    await login.restore();
    expect(lines).toContainEqual(
      expect.objectContaining({ level: "error", event: "login-restored" }),
    );
    expect(readFileSync(file, "utf8")).toBe(
      credentials("old-2", NOW + 8 * 3_600_000),
    );
    await login.storeIfRefreshed();
    expect(readRecord(aws.secrets.get(PARAMETER) ?? "").credentials).toBe(
      credentials("old-2", NOW + 8 * 3_600_000),
    );
  });

  it("still rejects when the parameter cannot be read, for the start-up catch (#137)", async () => {
    const { aws, login } = setup();
    aws.getSecret = () => Promise.reject(new Error("AccessDeniedException"));
    await expect(login.restore()).rejects.toThrow("AccessDeniedException");
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

describe("a login minted while the old one still works (#118)", () => {
  const minted = { accountUuid: "acc-2", organizationUuid: "org-2" };

  it("takes the new login before the old one's refresh can replace it", async () => {
    const harness = { file: "" };
    const { aws, login, file } = setup((_command, args) => {
      if (args[0] === "-p")
        writeFileSync(harness.file, credentials("old-2", NOW + 8 * 3_600_000));
      return Promise.resolve({ code: 0, out: "" });
    });
    harness.file = file;
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("old", NOW + 20 * 60_000), account),
    );
    await login.restore();
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("minted", NOW + 2 * 3_600_000), minted),
    );
    await login.keepFresh();
    expect(readFileSync(file, "utf8")).toBe(
      credentials("minted", NOW + 2 * 3_600_000),
    );
    expect(readRecord(aws.secrets.get(PARAMETER) ?? "")).toEqual({
      credentials: credentials("minted", NOW + 2 * 3_600_000),
      account: minted,
    });
    expect(login.orgUuid()).toBe("org-2");
  });

  it("takes it within one check, though the old login has hours left", async () => {
    const { lines } = logLines();
    const { aws, login, file } = setup();
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("old", NOW + 8 * 3_600_000), account),
    );
    await login.restore();
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("minted", NOW + 3_600_000), minted),
    );
    await login.keepFresh();
    expect(readFileSync(file, "utf8")).toBe(
      credentials("minted", NOW + 3_600_000),
    );
    expect(lines.at(-1)).toMatchObject({
      level: "info",
      event: "login-restored",
      from: "parameter",
    });
  });

  it("does not write the old login's refresh over it after a CLI run", async () => {
    const { aws, login, file } = setup();
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("old", NOW + 20 * 60_000), account),
    );
    await login.restore();
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("minted", NOW + 3_600_000), minted),
    );
    // A session's CLI run refreshed the old login.
    writeFileSync(file, credentials("old-2", NOW + 8 * 3_600_000));
    await login.storeIfRefreshed();
    expect(readFileSync(file, "utf8")).toBe(
      credentials("minted", NOW + 3_600_000),
    );
    expect(readRecord(aws.secrets.get(PARAMETER) ?? "").credentials).toBe(
      credentials("minted", NOW + 3_600_000),
    );
    expect(login.orgUuid()).toBe("org-2");
  });

  it("holds the refresh back when Parameter Store cannot be read", async () => {
    const { lines } = logLines();
    const { aws, login, file } = setup();
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("old", NOW + 20 * 60_000), account),
    );
    await login.restore();
    writeFileSync(file, credentials("old-2", NOW + 8 * 3_600_000));
    aws.getSecret = () => Promise.reject(new Error("throttled"));
    await login.storeIfRefreshed();
    expect(readRecord(aws.secrets.get(PARAMETER) ?? "").credentials).toBe(
      credentials("old", NOW + 20 * 60_000),
    );
    expect(lines.at(-1)).toMatchObject({
      level: "warn",
      event: "login-stored",
    });
    // The next write-back stores it.
    aws.getSecret = (name) => Promise.resolve(aws.secrets.get(name));
    await login.storeIfRefreshed();
    expect(readRecord(aws.secrets.get(PARAMETER) ?? "").credentials).toBe(
      credentials("old-2", NOW + 8 * 3_600_000),
    );
  });

  it("writes a held refresh back at the next check", async () => {
    const { aws, login, file } = setup();
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("old", NOW + 20 * 60_000), account),
    );
    await login.restore();
    writeFileSync(file, credentials("old-2", NOW + 8 * 3_600_000));
    aws.getSecret = () => Promise.reject(new Error("throttled"));
    await login.storeIfRefreshed();
    aws.getSecret = (name) => Promise.resolve(aws.secrets.get(name));
    await login.keepFresh();
    expect(readRecord(aws.secrets.get(PARAMETER) ?? "").credentials).toBe(
      credentials("old-2", NOW + 8 * 3_600_000),
    );
  });

  it("refreshes a new login that is close to expiry in the same check", async () => {
    const harness = { file: "" };
    const { aws, login, file } = setup((_command, args) => {
      if (args[0] === "auth")
        writeFileSync(
          harness.file,
          credentials("minted-2", NOW + 8 * 3_600_000),
        );
      return Promise.resolve({ code: 0, out: "" });
    });
    harness.file = file;
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("old", NOW + 8 * 3_600_000), account),
    );
    await login.restore();
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("minted", NOW + 10 * 60_000), minted),
    );
    await login.keepFresh();
    expect(readFileSync(file, "utf8")).toBe(
      credentials("minted-2", NOW + 8 * 3_600_000),
    );
    expect(readRecord(aws.secrets.get(PARAMETER) ?? "")).toEqual({
      credentials: credentials("minted-2", NOW + 8 * 3_600_000),
      account: minted,
    });
  });

  it("names a failed parameter read at write-back as a write-back", async () => {
    const { lines } = logLines();
    const { aws, login, file } = setup();
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("old", NOW + 20 * 60_000), account),
    );
    await login.restore();
    writeFileSync(file, credentials("old-2", NOW + 8 * 3_600_000));
    const before = lines.length;
    aws.getSecret = () => Promise.reject(new Error("throttled"));
    await login.storeIfRefreshed();
    expect(lines.slice(before).map((line) => line.event)).toEqual([
      "login-stored",
    ]);
  });

  it("takes the new login at a restart, though the volume's expires later", async () => {
    const first = setup();
    first.aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("old", NOW + 20 * 60_000), account),
    );
    await first.login.restore();
    // The CLI refreshed the old login, and it was written back.
    writeFileSync(first.file, credentials("old-2", NOW + 8 * 3_600_000));
    await first.login.storeIfRefreshed();
    // A restart, after a new login was minted.
    const { aws, login, file } = setup(undefined, first.home);
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("minted", NOW + 3_600_000), minted),
    );
    await login.restore();
    expect(readFileSync(file, "utf8")).toBe(
      credentials("minted", NOW + 3_600_000),
    );
    expect(aws.puts).toEqual([]);
    expect(login.orgUuid()).toBe("org-2");
  });

  it("takes the new login at write-back when the restore at a restart failed", async () => {
    const first = setup();
    first.aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("old", NOW + 20 * 60_000), account),
    );
    await first.login.restore();
    const { aws, login, file } = setup(undefined, first.home);
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("minted", NOW + 3_600_000), minted),
    );
    aws.getSecret = () => Promise.reject(new Error("throttled"));
    await expect(login.restore()).rejects.toThrow("throttled");
    aws.getSecret = (name) => Promise.resolve(aws.secrets.get(name));
    // A session's CLI run refreshed the old login on the volume.
    writeFileSync(file, credentials("old-2", NOW + 8 * 3_600_000));
    await login.storeIfRefreshed();
    expect(readFileSync(file, "utf8")).toBe(
      credentials("minted", NOW + 3_600_000),
    );
    expect(aws.puts).toEqual([]);
  });

  it("still keeps the volume's refresh of the login it last stored, at a restart", async () => {
    const first = setup();
    first.aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("old", NOW + 20 * 60_000), account),
    );
    await first.login.restore();
    // The CLI refreshed it, and the task stopped before writing it back.
    writeFileSync(first.file, credentials("old-2", NOW + 8 * 3_600_000));
    const { aws, login, file } = setup(undefined, first.home);
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("old", NOW + 20 * 60_000), account),
    );
    await login.restore();
    expect(readFileSync(file, "utf8")).toBe(
      credentials("old-2", NOW + 8 * 3_600_000),
    );
    expect(readRecord(aws.secrets.get(PARAMETER) ?? "").credentials).toBe(
      credentials("old-2", NOW + 8 * 3_600_000),
    );
  });
});

describe("a stored value that is not a login, at a restart (#123)", () => {
  const setupToken = JSON.stringify({
    claudeAiOauth: {
      accessToken: "setup",
      refreshToken: "refresh-setup",
      expiresAt: NOW + 365 * 24 * 3_600_000,
      scopes: ["user:inference"],
    },
  });

  it("keeps the volume's login, writes it back, and says the parameter was not usable", async () => {
    const first = setup();
    first.aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("old", NOW + 20 * 60_000), account),
    );
    await first.login.restore();
    // The CLI refreshed it, and the task stopped before writing it back.
    writeFileSync(first.file, credentials("old-2", NOW + 8 * 3_600_000));
    const { lines } = logLines();
    const { aws, login, file } = setup(undefined, first.home);
    aws.secrets.set(PARAMETER, setupToken);
    await login.restore();
    expect(readFileSync(file, "utf8")).toBe(
      credentials("old-2", NOW + 8 * 3_600_000),
    );
    expect(readRecord(aws.secrets.get(PARAMETER) ?? "")).toEqual({
      credentials: credentials("old-2", NOW + 8 * 3_600_000),
      account,
    });
    expect(login.orgUuid()).toBe("org-1");
    expect(lines).toContainEqual(
      expect.objectContaining({
        event: "login-restored",
        from: "volume",
        usable: false,
      }),
    );
  });

  it("writes back the login it last stored when the parameter is broken", async () => {
    const first = setup();
    first.aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("old", NOW + 3_600_000), account),
    );
    await first.login.restore();
    const { aws, login, file } = setup(undefined, first.home);
    aws.secrets.set(PARAMETER, "{not json");
    await login.restore();
    expect(readFileSync(file, "utf8")).toBe(
      credentials("old", NOW + 3_600_000),
    );
    expect(readRecord(aws.secrets.get(PARAMETER) ?? "")).toEqual({
      credentials: credentials("old", NOW + 3_600_000),
      account,
    });
  });

  it("writes the value out as before when the volume has no usable login either", async () => {
    const { lines } = logLines();
    const { aws, login, file } = setup();
    aws.secrets.set(PARAMETER, setupToken);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, "{broken");
    await login.restore();
    expect(readFileSync(file, "utf8")).toBe(setupToken);
    expect(aws.puts).toEqual([]);
    expect(lines).toContainEqual(
      expect.objectContaining({
        event: "login-restored",
        from: "parameter",
        usable: false,
      }),
    );
  });
});

describe("a failed write-back of the login at start (#127)", () => {
  const throttled = (): Promise<void> => {
    const error = new Error("rate exceeded");
    error.name = "ThrottlingException";
    return Promise.reject(error);
  };

  it("is a warn under login-stored, and the next check writes the login back", async () => {
    const first = setup();
    first.aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("old", NOW + 20 * 60_000), account),
    );
    await first.login.restore();
    // The CLI refreshed it, and the task stopped before writing it back.
    writeFileSync(first.file, credentials("old-2", NOW + 8 * 3_600_000));
    const { lines } = logLines();
    const { aws, login, file } = setup(undefined, first.home);
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("old", NOW + 20 * 60_000), account),
    );
    const putSecret = aws.putSecret.bind(aws);
    aws.putSecret = throttled;
    await login.restore();
    expect(readFileSync(file, "utf8")).toBe(
      credentials("old-2", NOW + 8 * 3_600_000),
    );
    expect(lines).toContainEqual(
      expect.objectContaining({
        level: "warn",
        event: "login-stored",
        error: "ThrottlingException",
      }),
    );
    expect(eventsOf(lines)).not.toContain("login-missing");
    expect(lines.filter((line) => line.level === "error")).toEqual([]);
    aws.putSecret = putSecret;
    await login.keepFresh();
    expect(readRecord(aws.secrets.get(PARAMETER) ?? "")).toEqual({
      credentials: credentials("old-2", NOW + 8 * 3_600_000),
      account,
    });
  });

  it("is a warn too when the parameter holds no usable login (#123)", async () => {
    const first = setup();
    first.aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("old", NOW + 3_600_000), account),
    );
    await first.login.restore();
    const { lines } = logLines();
    const { aws, login, file } = setup(undefined, first.home);
    aws.secrets.set(PARAMETER, "{not json");
    const putSecret = aws.putSecret.bind(aws);
    aws.putSecret = throttled;
    await login.restore();
    expect(readFileSync(file, "utf8")).toBe(
      credentials("old", NOW + 3_600_000),
    );
    expect(lines).toContainEqual(
      expect.objectContaining({
        level: "warn",
        event: "login-stored",
        error: "ThrottlingException",
      }),
    );
    expect(lines.filter((line) => line.level === "error")).toEqual([]);
    aws.putSecret = putSecret;
    await login.keepFresh();
    expect(readRecord(aws.secrets.get(PARAMETER) ?? "")).toEqual({
      credentials: credentials("old", NOW + 3_600_000),
      account,
    });
  });
});

describe("a write-back Parameter Store keeps refusing at the login check (#141)", () => {
  const denied = (): Promise<void> => {
    const error = new Error("not authorized");
    error.name = "AccessDeniedException";
    return Promise.reject(error);
  };
  const refusals = (lines: { level: string; event: string }[]) =>
    lines
      .filter((line) => line.event === "login-stored" && line.level !== "info")
      .map((line) => line.level);

  /** A login close to expiry that a CLI run refreshed, and a stand-in CLI whose auth status refreshes it again. */
  async function refusing() {
    const harness = { file: "", runs: [] as string[] };
    const { aws, login, file } = setup((_command, args) => {
      harness.runs.push(args[0] ?? "");
      if (args[0] === "auth")
        writeFileSync(
          harness.file,
          credentials(
            `fresh-${String(harness.runs.length)}`,
            NOW + 8 * 3_600_000,
          ),
        );
      return Promise.resolve({ code: 0, out: "" });
    });
    harness.file = file;
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("old", NOW + 20 * 60_000), account),
    );
    await login.restore();
    // A CLI run refreshed it, still close to expiry.
    writeFileSync(file, credentials("old-2", NOW + 25 * 60_000));
    const putSecret = aws.putSecret.bind(aws);
    aws.putSecret = denied;
    return { aws, login, file, harness, putSecret };
  }

  it("still checks the expiry and refreshes the login, and the first refusal is a warn", async () => {
    const { lines } = logLines();
    const { login, file, harness } = await refusing();
    await login.keepFresh();
    expect(harness.runs).toEqual(["auth"]);
    expect(readFileSync(file, "utf8")).toBe(
      credentials("fresh-1", NOW + 8 * 3_600_000),
    );
    expect(eventsOf(lines)).toContain("login-refreshed");
    expect(lines).toContainEqual(
      expect.objectContaining({
        level: "warn",
        event: "login-stored",
        error: "AccessDeniedException",
      }),
    );
    expect(lines.filter((line) => line.level === "error")).toEqual([]);
  });

  it("is an error line when the write-back is still refused at the next check", async () => {
    const { lines } = logLines();
    const { aws, login, file, putSecret } = await refusing();
    await login.keepFresh();
    const before = lines.length;
    await login.keepFresh();
    expect(refusals(lines.slice(before))).toEqual(["error"]);
    expect(lines.slice(before)).toContainEqual(
      expect.objectContaining({
        level: "error",
        event: "login-stored",
        error: "AccessDeniedException",
      }),
    );
    // Once a write-back goes through, the next refusal is a warn again.
    aws.putSecret = putSecret;
    await login.keepFresh();
    expect(readRecord(aws.secrets.get(PARAMETER) ?? "").credentials).toBe(
      readFileSync(file, "utf8"),
    );
    aws.putSecret = denied;
    writeFileSync(file, credentials("later", NOW + 7 * 3_600_000));
    const after = lines.length;
    await login.keepFresh();
    expect(refusals(lines.slice(after))).toEqual(["warn"]);
  });

  it("is a warn when a write-back went through earlier in the same check", async () => {
    const { lines } = logLines();
    const { aws, login, file, putSecret } = await refusing();
    await login.keepFresh();
    // Close to expiry again; the first write-back at this check goes
    // through, and the one after the refresh is refused.
    writeFileSync(file, credentials("old-4", NOW + 25 * 60_000));
    let puts = 0;
    aws.putSecret = (name, value) =>
      puts++ === 0 ? putSecret(name, value) : denied();
    const before = lines.length;
    await login.keepFresh();
    expect(puts).toBe(2);
    expect(refusals(lines.slice(before))).toEqual(["warn"]);
  });

  it("is an error line at the check after a refused write-back from a CLI run", async () => {
    const { lines } = logLines();
    const { login, file } = await refusing();
    // The write-back after the CLI run is refused; its caller warns (#135).
    await expect(login.storeIfRefreshed()).rejects.toThrow();
    writeFileSync(file, credentials("old-3", NOW + 7 * 3_600_000));
    await login.keepFresh();
    expect(refusals(lines)).toEqual(["error"]);
  });
});

describe("ids the CLI looks up for a login stored without them (#120)", () => {
  const cliAccount = { accountUuid: "acc-3", organizationUuid: "org-3" };

  /** A stand-in CLI that refreshes the login and writes what it looked up. */
  function lookingUp(written: Record<string, unknown> | undefined) {
    const harness = { home: "" };
    const runner: Runner = () => {
      const credentialsFile = join(
        harness.home,
        ".claude",
        ".credentials.json",
      );
      writeFileSync(
        credentialsFile,
        credentials("refreshed", NOW + 8 * 3_600_000),
      );
      if (written !== undefined) {
        const configFile = join(harness.home, ".claude.json");
        // Add the account, keeping the rest. restore() removed any earlier one.
        const config = z
          .looseObject({})
          .parse(JSON.parse(readFileSync(configFile, "utf8")));
        writeFileSync(
          configFile,
          JSON.stringify({ ...config, oauthAccount: written }),
        );
      }
      return Promise.resolve({ code: 0, out: "" });
    };
    return { harness, runner };
  }

  it("stores the ids with the refresh, so a restart names the org from the start", async () => {
    const { harness, runner } = lookingUp({
      ...cliAccount,
      emailAddress: "someone@example.com",
    });
    const { aws, login, home } = setup(runner);
    harness.home = home;
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("stored", NOW + 60_000), undefined),
    );
    await login.restore();
    expect(login.orgUuid()).toBeUndefined();
    await login.keepFresh();
    expect(readRecord(aws.secrets.get(PARAMETER) ?? "")).toEqual({
      credentials: credentials("refreshed", NOW + 8 * 3_600_000),
      account: cliAccount,
    });
    // A restart: a fresh Login on the same volume.
    const next = setup(undefined, home);
    next.aws.secrets.set(PARAMETER, aws.secrets.get(PARAMETER) ?? "");
    await next.login.restore();
    expect(next.login.orgUuid()).toBe("org-3");
    expect(next.login.cliEnv()).toMatchObject({
      CLAUDE_CODE_ORGANIZATION_UUID: "org-3",
    });
  });

  it("never stores the account an earlier login left", async () => {
    const { harness, runner } = lookingUp(undefined);
    const { aws, login, home } = setup(runner);
    harness.home = home;
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ oauthAccount: account, hasCompletedOnboarding: true }),
    );
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("stored", NOW + 60_000), undefined),
    );
    await login.restore();
    await login.keepFresh();
    expect(readRecord(aws.secrets.get(PARAMETER) ?? "")).toEqual({
      credentials: credentials("refreshed", NOW + 8 * 3_600_000),
      account: undefined,
    });
  });

  it("stores no account when the CLI wrote only the org", async () => {
    const { harness, runner } = lookingUp({ organizationUuid: "org-3" });
    const { aws, login, home } = setup(runner);
    harness.home = home;
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("stored", NOW + 60_000), undefined),
    );
    await login.restore();
    await login.keepFresh();
    expect(
      readRecord(aws.secrets.get(PARAMETER) ?? "").account,
    ).toBeUndefined();
  });

  it("still writes the refresh back when the CLI's config cannot be read", async () => {
    const { aws, login, file, home } = setup();
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("stored", NOW + 60_000), undefined),
    );
    await login.restore();
    writeFileSync(file, credentials("refreshed", NOW + 8 * 3_600_000));
    // Half written.
    writeFileSync(join(home, ".claude.json"), '{"oauthAccount":{"acc');
    await login.storeIfRefreshed();
    expect(readRecord(aws.secrets.get(PARAMETER) ?? "")).toEqual({
      credentials: credentials("refreshed", NOW + 8 * 3_600_000),
      account: undefined,
    });
  });

  it("names the org when the CLI wrote an account id of another shape", async () => {
    const { aws, login, home } = setup();
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("stored", NOW + 3_600_000), undefined),
    );
    await login.restore();
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({
        oauthAccount: { accountUuid: null, organizationUuid: "org-3" },
      }),
    );
    expect(login.orgUuid()).toBe("org-3");
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
      writeRecord(credentials("stored", NOW - 60_000), account),
    );
    await login.restore();
    await login.keepFresh();
    expect(lines.at(-1)).toMatchObject({ level: "error", event: "login-dead" });
  });

  it("says so at info when the CLI leaves an unexpired token alone", async () => {
    const { lines } = logLines();
    const calls: string[][] = [];
    const { aws, login } = setup((_command, args) => {
      calls.push(args);
      return Promise.resolve({ code: 0, out: "" });
    });
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("stored", NOW + 20 * 60_000), account),
    );
    await login.restore();
    await login.keepFresh();
    expect(calls.map((args) => args[0])).toEqual(["auth", "-p"]);
    expect(lines.at(-1)).toMatchObject({
      level: "info",
      event: "login-unrefreshed",
      expiresInMinutes: 20,
    });
    expect(lines.filter((line) => line.level === "error")).toEqual([]);
  });

  it("writes back a login the CLI changed but left near expiry", async () => {
    const harness = { file: "" };
    const { aws, login, file } = setup((_command, args) => {
      if (args[0] === "-p")
        writeFileSync(harness.file, credentials("rotated", NOW + 20 * 60_000));
      return Promise.resolve({ code: 0, out: "" });
    });
    harness.file = file;
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("stored", NOW + 20 * 60_000), account),
    );
    await login.restore();
    await login.keepFresh();
    expect(readRecord(aws.secrets.get(PARAMETER) ?? "").credentials).toBe(
      credentials("rotated", NOW + 20 * 60_000),
    );
  });

  it("raises an alert when the CLI fails on an unexpired token", async () => {
    const { lines } = logLines();
    const { aws, login } = setup(() => Promise.resolve({ code: 1, out: "" }));
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("stored", NOW + 20 * 60_000), account),
    );
    await login.restore();
    await login.keepFresh();
    expect(lines.at(-1)).toMatchObject({ level: "error", event: "login-dead" });
  });

  it("picks up a newer login from Parameter Store instead of alerting", async () => {
    const { lines } = logLines();
    const { aws, login, file, home } = setup();
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("stored", NOW - 60_000), account),
    );
    await login.restore();
    const minted = { accountUuid: "acc-2", organizationUuid: "org-2" };
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("minted", NOW + 8 * 3_600_000), minted),
    );
    await login.keepFresh();
    expect(readFileSync(file, "utf8")).toBe(
      credentials("minted", NOW + 8 * 3_600_000),
    );
    expect(login.orgUuid()).toBe("org-2");
    expect(
      JSON.parse(readFileSync(join(home, ".claude.json"), "utf8")),
    ).toMatchObject({ oauthAccount: minted });
    expect(lines.at(-1)).toMatchObject({
      level: "info",
      event: "login-restored",
      from: "parameter",
    });
    expect(lines.filter((line) => line.level === "error")).toEqual([]);
    // The picked-up login is already stored, so nothing is written back.
    aws.puts.length = 0;
    await login.storeIfRefreshed();
    expect(aws.puts).toEqual([]);
  });

  it("forgets the previous org when the picked-up login has no ids", async () => {
    const { aws, login, home } = setup();
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("stored", NOW - 60_000), account),
    );
    await login.restore();
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("minted", NOW + 8 * 3_600_000), undefined),
    );
    await login.keepFresh();
    const config: unknown = JSON.parse(
      readFileSync(join(home, ".claude.json"), "utf8"),
    );
    expect(config).not.toHaveProperty("oauthAccount");
    expect(config).toMatchObject({ hasCompletedOnboarding: true });
    expect(login.orgUuid()).toBeUndefined();
  });

  it("still alerts when Parameter Store holds the same dead login", async () => {
    const { lines } = logLines();
    const { aws, login } = setup();
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("stored", NOW - 60_000), account),
    );
    await login.restore();
    await login.keepFresh();
    expect(lines.at(-1)).toMatchObject({ level: "error", event: "login-dead" });
    expect(eventsOf(lines).filter((e) => e === "login-restored")).toHaveLength(
      1,
    );
  });

  it("still alerts when the CLI broke the file and Parameter Store holds the old login", async () => {
    const { lines } = logLines();
    const harness = { file: "" };
    const { aws, login, file } = setup((_command, args) => {
      // The server refused the refresh token, and the CLI wrote "".
      if (args[0] === "-p")
        writeFileSync(
          harness.file,
          JSON.stringify({
            claudeAiOauth: {
              accessToken: "stored",
              refreshToken: "",
              expiresAt: NOW - 60_000,
              scopes: [SESSION_SCOPE],
            },
          }),
        );
      return Promise.resolve({ code: 1, out: "" });
    });
    harness.file = file;
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("stored", NOW - 60_000), account),
    );
    await login.restore();
    await login.keepFresh();
    expect(lines.at(-1)).toMatchObject({ level: "error", event: "login-dead" });
    expect(eventsOf(lines).filter((e) => e === "login-restored")).toHaveLength(
      1,
    );
  });

  it("still alerts when Parameter Store cannot be read", async () => {
    const { lines } = logLines();
    const { aws, login } = setup();
    aws.secrets.set(
      PARAMETER,
      writeRecord(credentials("stored", NOW - 60_000), account),
    );
    await login.restore();
    aws.getSecret = () => Promise.reject(new Error("throttled"));
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
