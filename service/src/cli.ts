// The operator's commands, run with `npm run cli -- <command>` on a laptop, or
// in the task through ECS Exec (docs/setup.md). They print their answers.
import { realAws } from "./aws.ts";
import { ClaudeApi, textOf } from "./claude-api.ts";
import { readEnv } from "./env.ts";
import { lastSession, oneLine } from "./format.ts";
import { line } from "./commands.ts";
import { GroupsStore, parseOwners } from "./groups.ts";
import { CommandError } from "./log.ts";
import { Login } from "./login.ts";
import { run } from "./run.ts";
import { WhatsAppStore } from "./store.ts";

const env = readEnv();
const aws =
  env.LOGIN_PARAMETER === undefined ? undefined : realAws(env.AWS_REGION);
const login = new Login({
  env,
  aws,
  run,
  now: () => Date.now(),
  platform: process.platform,
});
const api = new ClaudeApi(
  env.CLAUDE_API_BASE,
  () => login.accessToken(),
  () => login.orgUuid(),
);
const store = new WhatsAppStore(env.BRIDGE_STORE);
const groups = () => new GroupsStore(env.GROUPS_FILE, parseOwners(env.OWNERS));

const say = (line: string) => {
  // eslint-disable-next-line no-console -- the operator's commands print their answers
  console.log(line);
};

const commands: Record<string, (args: string[]) => Promise<void>> = {
  async probe([target]) {
    const id = lastSession(target);
    if (id === null)
      throw new CommandError(
        "give a session id (session_… or cse_…) or its claude.ai/code link",
      );
    const record = await api.record(id);
    await api.environments();
    say(`status: ${record.status}`);
    say(`title: ${record.title ?? ""}`);
    say(
      `environment: ${api.label(record.environmentId)}${record.environmentKind === undefined ? "" : ` (${record.environmentKind})`}`,
    );
    const { events } = await api.eventsAfter(id, null);
    say(`${String(events.length)} events; the last 8:`);
    for (const event of events.slice(-8))
      say(
        `- ${event.type}${event.subtype === undefined ? "" : `/${event.subtype}`}: ${oneLine(textOf(event)).slice(0, 120)}`,
      );
  },

  async "list-groups"() {
    const configured = groups().config.groups;
    for (const row of store.groupChats()) {
      const group = configured.get(row.jid);
      say(
        `${group === undefined ? " " : "✓"} ${row.jid}  ${row.name}${group === undefined ? "" : `  (${group.claudes.map((name) => `@${name}`).join(" ")})`}`,
      );
    }
    say("\n✓ = has Claudes. Set groups up with @claude add in the group.");
    await Promise.resolve();
  },

  async "list-environments"() {
    for (const environment of await api.environments(true))
      say(`${environment.id}  ${environment.name}  (${environment.kind})`);
  },

  async "list-claudes"() {
    await api.environments().catch(() => []);
    const config = groups().config;
    for (const claude of config.claudes.values()) {
      const where = [...config.groups.values()]
        .filter((group) => group.claudes.includes(claude.name))
        .map((group) => group.label);
      say(
        `${line(claude, api).replace(/\*/gu, "")}  in: ${where.join(", ") || "no group"}`,
      );
    }
  },
};

const [name, ...args] = process.argv.slice(2);
const command =
  name === undefined ? undefined : commands[name.replace(/^--/u, "")];
if (command === undefined) {
  say(`commands: ${Object.keys(commands).join(", ")}`);
  process.exitCode = 1;
} else {
  try {
    await command(args);
  } catch (error) {
    say(
      error instanceof CommandError
        ? error.why
        : error instanceof Error
          ? error.message
          : String(error),
    );
    process.exitCode = 1;
  }
}
