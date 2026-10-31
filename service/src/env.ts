// The one place the environment is read, through its schema (types-and-lint.md).
import { fileURLToPath } from "node:url";
import { z } from "zod";

const launcher = fileURLToPath(new URL("../launch.py", import.meta.url));

const number = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);
const optional = z
  .string()
  .optional()
  .transform((value) =>
    value === undefined || value === "" ? undefined : value,
  );

export const envSchema = z.object({
  HOME: z.string().min(1),
  PORT: number(8769),
  BRIDGE_URL: z.url().default("http://127.0.0.1:8080/api"),
  BRIDGE_STORE: z.string().default("/data/bridge/store"),
  WHATSAPP_BRIDGE_TOKEN: optional,
  // Where files go for the bridge to send: its WHATSAPP_MEDIA_ROOTS.
  OUTBOX_DIR: z.string().default("/data/bridge/outbox"),
  GROUPS_FILE: z.string().default("/data/groups.json"),
  STATE_FILE: z.string().default("/data/state.json"),
  WORKSPACES_DIR: z.string().default("/data/workspaces"),
  // Phone numbers, digits only, comma separated. Joined to groups.json's own.
  OWNERS: z.string().default(""),
  LAUNCHER: z.string().default(launcher),
  PYTHON: z.string().default("python3"),
  CLAUDE_BIN: z.string().default("claude"),
  CLAUDE_API_BASE: z.url().default("https://api.anthropic.com"),
  // For tests and local runs: a token to use instead of the stored login.
  CLAUDE_OAUTH_TOKEN: optional,
  CLAUDE_CODE_ORGANIZATION_UUID: optional,
  // The Parameter Store SecureString holding the Claude login (claude-login.md).
  LOGIN_PARAMETER: optional,
  // The bucket for attachments and the device seed (attachments.md, one-device.md).
  ATTACHMENTS_BUCKET: optional,
  SEED_KEY: z.string().default("seed/device.tgz"),
  // The upload link's address, up to the session's id: the HTTP API in front
  // of the Lambda (attachments.md). Without it a Claude is given no link.
  UPLOAD_LINK: optional.pipe(z.url().endsWith("/").optional()),
  AWS_REGION: optional,
  POLL_MS: number(15_000),
  HEARTBEAT_MS: number(300_000),
  LOGIN_CHECK_MS: number(600_000),
  GIVE_UP_MS: number(7_200_000),
  HISTORY: number(20),
  MAX_PER_HOUR: number(12),
  DRY_RUN: z
    .enum(["", "0", "1"])
    .default("")
    .transform((value) => value === "1"),
});

export type Env = z.infer<typeof envSchema>;

export function readEnv(
  // eslint-disable-next-line no-restricted-properties -- the one read of the environment
  source: Record<string, string | undefined> = process.env,
): Env {
  return envSchema.parse(source);
}

/** The upload link's Lambda: the bucket it signs for (upload-link.ts). */
export const linkEnvSchema = z.object({
  ATTACHMENTS_BUCKET: z.string().min(1),
  AWS_REGION: optional,
});

export function readLinkEnv(
  // eslint-disable-next-line no-restricted-properties -- the Lambda's one read of the environment
  source: Record<string, string | undefined> = process.env,
): z.infer<typeof linkEnvSchema> {
  return linkEnvSchema.parse(source);
}

/** The environment every CLI call runs under: ours, with the login's org named (claude-login.md). */
export function cliEnv(
  env: Env,
  extra: Record<string, string> = {},
): Record<string, string> {
  const base: Record<string, string> = {};
  // eslint-disable-next-line no-restricted-properties -- passed on whole to the CLI, which reads its own variables
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) base[key] = value;
  }
  return {
    ...base,
    HOME: env.HOME,
    ...(env.CLAUDE_CODE_ORGANIZATION_UUID === undefined
      ? {}
      : { CLAUDE_CODE_ORGANIZATION_UUID: env.CLAUDE_CODE_ORGANIZATION_UUID }),
    ...extra,
  };
}
