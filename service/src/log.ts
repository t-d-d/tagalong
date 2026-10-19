// The one logger (logging.md). Every line is JSON and names an event from the
// list below. No message text, phone number or contact name goes in a line.

export const events = [
  "started",
  "heartbeat",
  "webhook-rejected",
  "webhook-unreadable",
  "payload-failed",
  "message",
  "request-ignored",
  "request-capped",
  "request-failed",
  "command",
  "command-ignored",
  "command-failed",
  "session-started",
  "session-environment-mismatch",
  "session-followup",
  "session-relayed",
  "session-waiting-approval",
  "session-gave-up",
  "session-poll-failed",
  "session-gone",
  "launcher-failed",
  "attachments-sent",
  "attachment-skipped",
  "attachment-transcribed",
  "attachment-untranscribed",
  "attachments-off",
  "environments-failed",
  "bridge-unreachable",
  "login-restored",
  "login-refreshed",
  "login-stored",
  "login-dead",
  "login-missing",
  "device-present",
  "device-waiting",
  "device-seeded",
  "device-seed-failed",
  "loop-failed",
] as const;

export type Event = (typeof events)[number];
export type Level = "info" | "warn" | "error";
export type Fields = Record<string, string | number | boolean | undefined>;

export type Sink = (line: string) => void;

// eslint-disable-next-line no-restricted-properties -- the one writer of log lines
let sink: Sink = (line) => process.stdout.write(`${line}\n`);

/** For tests: where lines go. */
export function setSink(next: Sink): void {
  sink = next;
}

function write(level: Level, event: Event, fields: Fields): void {
  sink(
    JSON.stringify({ time: new Date().toISOString(), level, event, ...fields }),
  );
}

export const log = {
  info: (event: Event, fields: Fields = {}) => {
    write("info", event, fields);
  },
  warn: (event: Event, fields: Fields = {}) => {
    write("warn", event, fields);
  },
  error: (event: Event, fields: Fields = {}) => {
    write("error", event, fields);
  },
};

/** A dependency's error, by class and status only, never its message (logging.md). */
export function errorFields(error: unknown): Fields {
  if (error instanceof HttpError)
    return { error: "HttpError", status: error.status, where: error.where };
  if (error instanceof Error)
    return {
      error: error.name,
      ...(error instanceof CommandError ? { why: error.why } : {}),
    };
  return { error: typeof error };
}

export class HttpError extends Error {
  readonly status: number;
  readonly where: string;
  constructor(where: string, status: number) {
    super(`${where}: HTTP ${String(status)}`);
    this.name = "HttpError";
    this.status = status;
    this.where = where;
  }
}

/** A failure whose reason is ours to write, safe to log and to tell the owner. */
export class CommandError extends Error {
  readonly why: string;
  constructor(why: string) {
    super(why);
    this.name = "CommandError";
    this.why = why;
  }
}
