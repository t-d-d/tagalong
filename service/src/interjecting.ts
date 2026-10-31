// A Claude an owner set to interject in a chat (who-can-use-it.md). Once one
// of the people who may ask it has spoken and the chat has been quiet for
// INTERJECT_QUIET_MS, it is given what everyone said since it last heard,
// with no request, and posts only when it has something to add. Nothing its
// session does by itself starts one.
//
// Nothing waits in memory: what is waiting is read from the bridge's store,
// after the time the Claude last heard, so a restart loses no delivery. Only
// the hourly count is in memory, like MAX_PER_HOUR's.
import { allowed } from "./access.ts";
import { COMMAND } from "./commands.ts";
import { errorFields, log } from "./log.ts";
import { busy } from "./mailbox.ts";
import { type RequestDeps, interjectingTurn } from "./requests.ts";
import { threadKey } from "./state.ts";
import { type MessageRow, timeOf } from "./store.ts";

export interface DueInput {
  /** The chat's messages after the Claude last heard, oldest first. */
  rows: MessageRow[];
  now: number;
  quietMs: number;
  /** When each interjecting delivery to this Claude here in the last hour went. */
  hour: number[];
  perHour: number;
  /** Whether someone may ask this Claude here. */
  mayAsk: (sender: string) => boolean;
}

const HOUR = 3_600_000;

/** When interjecting deliveries went to a Claude in its chat in the last hour, the older times dropped. */
function lastHour(
  interjected: Map<string, number[]>,
  key: string,
  now: number,
): number[] {
  const hour = (interjected.get(key) ?? []).filter((at) => now - at < HOUR);
  interjected.set(key, hour);
  return hour;
}

/**
 * Whether an interjecting delivery is due. Only a person who may ask the
 * Claude starts one: never a Claude's answer, a command, or its session's
 * own turn. It waits until the chat has been quiet.
 */
export function interjectDue(
  input: DueInput,
): "nothing" | "talking" | "capped" | "due" {
  const starts = input.rows.some(
    (row) =>
      !row.isFromMe && !COMMAND.test(row.content) && input.mayAsk(row.sender),
  );
  if (!starts) return "nothing";
  const last = input.rows.at(-1);
  const latest = last === undefined ? 0 : timeOf(last.timestamp);
  if (input.now - latest < input.quietMs) return "talking";
  return input.hour.length >= input.perHour ? "capped" : "due";
}

export interface InterjectDeps extends RequestDeps {
  /** Interjecting deliveries in the last hour, by threadKey. */
  interjected: Map<string, number[]>;
  /** The threads at their hourly limit, logged once each time. */
  capped: Set<string>;
}

/** One look at every interjecting Claude, delivering to each one that is due. */
export async function interject(deps: InterjectDeps): Promise<void> {
  if (deps.env.DRY_RUN) return;
  const { config } = deps.groups;
  const { state } = deps.state;
  for (const group of config.groups.values()) {
    for (const name of group.interjecting) {
      const claude = config.claudes.get(name);
      if (claude === undefined) continue;
      const key = threadKey(group.jid, name);
      const thread = state.threads[key];
      const session =
        thread?.session == null ? undefined : state.sessions[thread.session];
      // What waits goes in with the next delivery, once this one is answered.
      if (session !== undefined && busy(session)) continue;
      const now = deps.now();
      const hour = lastHour(deps.interjected, key, now);
      const on = state.interjecting[key] ?? 0;
      const from = Math.max(thread?.heard ?? 0, on);
      const { rows } = deps.store.since(group.jid, from, 200);
      const due = interjectDue({
        rows,
        now,
        quietMs: deps.env.INTERJECT_QUIET_MS,
        hour,
        perHour: deps.env.INTERJECT_PER_HOUR,
        mayAsk: (sender) => allowed(config, group, name, deps.people, sender),
      });
      if (due === "capped" && !deps.capped.has(key)) {
        deps.capped.add(key);
        log.info("interject-capped", {
          group: group.label,
          claude: name,
          cap: deps.env.INTERJECT_PER_HOUR,
        });
      }
      if (due !== "due") continue;
      deps.capped.delete(key);
      // Counted before it goes, so one that fails is not tried every poll.
      hour.push(now);
      const last = rows.at(-1);
      const at = last === undefined ? now : timeOf(last.timestamp);
      try {
        await interjectingTurn(group.jid, claude, group, at, deps);
      } catch (error) {
        log.warn("interject-failed", {
          group: group.label,
          claude: name,
          ...errorFields(error),
        });
      }
    }
  }
}
