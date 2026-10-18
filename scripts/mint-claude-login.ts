// Mint the claude.ai login tagalong starts sessions with, and store it in
// Parameter Store at /tagalong/claude-login (claude-login.md). A port of
// podstow's operator-mint-claude-login.mjs.
//
//   node scripts/mint-claude-login.ts [--profile <aws profile>]
//
// Run it from a checkout after npm ci, on a laptop or in CloudShell. It
// needs claude, aws and, on a Mac, security. It signs in under a throwaway
// CLAUDE_CONFIG_DIR, so the login this machine already holds in ~/.claude is
// never read or written, and that directory and its keychain item are
// removed at the end. Sign in with the account tagalong should use: a login
// of its own, shared with nothing else.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { parseCredentials, writeRecord } from "../service/src/login.ts";

const PARAMETER = "/tagalong/claude-login";
const KEYCHAIN_SERVICE = "Claude Code-credentials";

/** The keychain item the CLI uses for a CLAUDE_CONFIG_DIR: the service name with eight hex digits of the dir's hash. */
export const keychainServiceName = (configDir: string): string =>
  `${KEYCHAIN_SERVICE}-${createHash("sha256").update(configDir.normalize("NFC")).digest("hex").slice(0, 8)}`;

/** The keychain account the CLI stores under: USER when it is a plain name. */
export const keychainAccount = (user: string | undefined): string =>
  /^[a-zA-Z0-9._-]+$/u.test(user ?? "") ? (user ?? "") : "claude-code-user";

const configSchema = z.looseObject({
  oauthAccount: z
    .looseObject({
      accountUuid: z.string().min(1),
      organizationUuid: z.string().min(1),
    })
    .optional(),
});

function main(): number {
  const { values } = parseArgs({ options: { profile: { type: "string" } } });
  const aws = (args: string[]) => [
    ...args,
    ...(values.profile === undefined ? [] : ["--profile", values.profile]),
  ];
  const say = (line: string) => {
    process.stderr.write(`${line}\n`);
  };

  const who = spawnSync(
    "aws",
    aws(["sts", "get-caller-identity", "--query", "Arn", "--output", "text"]),
    { encoding: "utf8" },
  );
  if (who.status !== 0) {
    say(
      `aws sts get-caller-identity failed: ${who.stderr.trim()}. Nothing was minted.`,
    );
    return 1;
  }
  say(`Storing as ${who.stdout.trim()}.`);

  const configDir = join(
    homedir(),
    `.tagalong-mint-login-${String(process.pid)}`,
  );
  const onMac = process.platform === "darwin";
  const service = keychainServiceName(configDir);
  const account = keychainAccount(process.env.USER ?? userInfo().username);
  let inKeychain = false;
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  try {
    say(
      `Signing in under ${configDir}. The login in ~/.claude is not touched.`,
    );
    const env: Record<string, string | undefined> = {
      ...process.env,
      CLAUDE_CONFIG_DIR: configDir,
    };
    // A claude session exports this to its children, and it would win over CLAUDE_CONFIG_DIR.
    delete env.CLAUDE_SECURESTORAGE_CONFIG_DIR;
    const signIn = spawnSync("claude", ["auth", "login"], {
      stdio: "inherit",
      env,
    });
    if (signIn.status !== 0) {
      say("claude auth login did not finish. Nothing was stored.");
      return 1;
    }

    let text: string | undefined;
    if (onMac) {
      const item = spawnSync(
        "security",
        ["find-generic-password", "-s", service, "-a", account, "-w"],
        { encoding: "utf8" },
      );
      if (item.status === 0) {
        text = item.stdout.trim();
        inKeychain = true;
      }
    }
    try {
      text ??= readFileSync(join(configDir, ".credentials.json"), "utf8");
    } catch {
      say("The sign-in wrote no login. Nothing was stored.");
      return 1;
    }
    const parsed = parseCredentials(text);
    if (!parsed.ok) {
      say(`Refusing to store what was minted: ${parsed.reason}.`);
      return 1;
    }
    let ids: { accountUuid: string; organizationUuid: string } | undefined;
    try {
      const found = configSchema.parse(
        JSON.parse(readFileSync(join(configDir, ".claude.json"), "utf8")),
      ).oauthAccount;
      ids =
        found === undefined
          ? undefined
          : {
              accountUuid: found.accountUuid,
              organizationUuid: found.organizationUuid,
            };
    } catch {
      ids = undefined;
    }

    // The value goes in a file, so the login never sits in an argument list.
    const file = join(configDir, "login.json");
    writeFileSync(file, writeRecord(text, ids), { mode: 0o600 });
    const put = spawnSync(
      "aws",
      aws([
        "ssm",
        "put-parameter",
        "--name",
        PARAMETER,
        "--type",
        "SecureString",
        "--overwrite",
        "--value",
        `file://${file}`,
      ]),
      { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] },
    );
    if (put.status !== 0) {
      say(`aws ssm put-parameter failed: ${put.stderr.trim()}`);
      return 1;
    }
    process.stdout.write(
      `${PARAMETER} set${ids === undefined ? ", without the account's ids: the CLI will look the org up" : ", with the account's ids"}. Restart the task to use it.\n`,
    );
    return 0;
  } finally {
    rmSync(configDir, { recursive: true, force: true });
    if (
      inKeychain &&
      spawnSync(
        "security",
        ["delete-generic-password", "-s", service, "-a", account],
        { stdio: "ignore" },
      ).status !== 0
    ) {
      say(
        `Could not delete the keychain item "${service}"; remove it in Keychain Access. It is a live login.`,
      );
    }
  }
}

process.exitCode = main();
