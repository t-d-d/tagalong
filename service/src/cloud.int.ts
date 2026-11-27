import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fakeAws } from "../../test/fake-aws.ts";
import { fakeRun } from "../../test/fake-run.ts";
import { logLines } from "../../test/log-lines.ts";
import { serviceEnv } from "../../test/service-env.ts";
import { Cloud } from "./cloud.ts";
import { CommandError, HttpError } from "./log.ts";
import { Login, SESSION_SCOPE, readRecord, writeRecord } from "./login.ts";
import { type Runner, run } from "./run.ts";

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

const NOW = Date.parse("2026-10-18T17:00:00Z");
const PARAMETER = "/tagalong/claude-login";
const claude = {
  name: "critic",
  repo: "o/r",
  environment: undefined,
  access: "read-only" as const,
  ref: "main",
  model: undefined,
  role: undefined,
};

const credentials = (accessToken: string, expiresAt: number) =>
  JSON.stringify({
    claudeAiOauth: {
      accessToken,
      refreshToken: `refresh-${accessToken}`,
      expiresAt,
      scopes: [SESSION_SCOPE],
    },
  });

/**
 * A Cloud whose every CLI run refreshes the login, beside a Parameter Store
 * that refuses the write-back.
 */
async function refusedWriteBack() {
  const env = serviceEnv("/nonexistent", { LOGIN_PARAMETER: PARAMETER });
  const aws = fakeAws();
  const fake = fakeRun({ python: env.PYTHON, claude: env.CLAUDE_BIN });
  const file = join(env.HOME, ".claude", ".credentials.json");
  let refreshes = 0;
  const runner: Runner = (command, args, options) => {
    if (command === env.PYTHON || command === env.CLAUDE_BIN) {
      refreshes += 1;
      writeFileSync(
        file,
        credentials(`refreshed-${String(refreshes)}`, NOW + 8 * 3_600_000),
      );
    }
    return fake.run(command, args, options);
  };
  const login = new Login({
    env,
    aws,
    run: runner,
    now: () => NOW,
    platform: "linux",
  });
  aws.secrets.set(
    PARAMETER,
    writeRecord(credentials("stored", NOW + 3_600_000), {
      accountUuid: "acc-1",
      organizationUuid: "org-1",
    }),
  );
  await login.restore();
  let refusing = true;
  const put = (name: string, value: string) => {
    aws.secrets.set(name, value);
    return Promise.resolve();
  };
  aws.putSecret = (name, value) =>
    refusing ? Promise.reject(new HttpError("ssm", 400)) : put(name, value);
  const restorePut = () => {
    refusing = false;
  };
  return { cloud: new Cloud(env, login, runner), fake, aws, login, restorePut };
}

const storedCredentials = (aws: { secrets: Map<string, string> }) =>
  readRecord(aws.secrets.get(PARAMETER) ?? "").credentials;

describe("a refused login write-back after a CLI run (#135)", () => {
  it("still returns the id of the session that started, and warns", async () => {
    const { lines } = logLines();
    const { cloud, fake } = await refusedWriteBack();
    fake.launches.push("01SessionAaaaaaaaaaaaaaa");
    await expect(cloud.start(claude, "a prompt", "name")).resolves.toBe(
      "01SessionAaaaaaaaaaaaaaa",
    );
    expect(lines.at(-1)).toMatchObject({
      level: "warn",
      event: "login-stored",
      ok: false,
      error: "HttpError",
      status: 400,
    });
  });

  it("still throws start's own error when no session started", async () => {
    const { lines } = logLines();
    const { cloud } = await refusedWriteBack();
    await expect(cloud.start(claude, "a prompt", "name")).rejects.toThrow(
      CommandError,
    );
    expect(lines.at(-1)).toMatchObject({
      level: "warn",
      event: "login-stored",
      error: "HttpError",
    });
  });

  it("still returns what send got, and warns", async () => {
    const { lines } = logLines();
    const { cloud, fake } = await refusedWriteBack();
    await expect(
      cloud.send("01SessionAaaaaaaaaaaaaaa", "a message"),
    ).resolves.toBe("sent");
    expect(lines.at(-1)).toMatchObject({
      level: "warn",
      event: "login-stored",
      error: "HttpError",
    });
    fake.followUps.set("01SessionBbbbbbbbbbbbbbb", "archived");
    const before = lines.length;
    await expect(
      cloud.send("01SessionBbbbbbbbbbbbbbb", "a message"),
    ).resolves.toBe("gone");
    expect(lines.length).toBeGreaterThan(before);
    expect(lines.at(-1)).toMatchObject({
      level: "warn",
      event: "login-stored",
      error: "HttpError",
    });
  });

  it("still throws send's own error when the session cannot be reached", async () => {
    const { lines } = logLines();
    const { cloud, fake } = await refusedWriteBack();
    fake.during = () => Promise.reject(new CommandError("no reply"));
    await expect(
      cloud.send("01SessionAaaaaaaaaaaaaaa", "a message"),
    ).rejects.toThrow("no reply");
    expect(lines.at(-1)).toMatchObject({
      level: "warn",
      event: "login-stored",
      error: "HttpError",
    });
  });

  it("writes the login back at the next check", async () => {
    const { cloud, fake, aws, login, restorePut } = await refusedWriteBack();
    fake.launches.push("01SessionAaaaaaaaaaaaaaa");
    await cloud.start(claude, "a prompt", "name");
    expect(storedCredentials(aws)).toBe(credentials("stored", NOW + 3_600_000));
    restorePut();
    await login.keepFresh();
    expect(storedCredentials(aws)).toBe(
      credentials("refreshed-1", NOW + 8 * 3_600_000),
    );
  });
});
