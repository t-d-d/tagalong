// What a session is told: the request, recent chat from people who may use
// the group, any files, and how its answer reaches WhatsApp.
import { allowed } from "./access.ts";
import type { Attachment } from "./attachments.ts";
import { COMMAND } from "./commands.ts";
import type { Config, Group } from "./groups.ts";
import type { People } from "./people.ts";
import type { WhatsAppStore } from "./store.ts";

/** Recent messages from Claude, the owners and the members; nobody else's reach a session. */
export function transcript(
  store: WhatsAppStore,
  people: People,
  config: Config,
  group: Group,
  history: number,
): string {
  return store
    .recent(group.jid, history * 3)
    .filter(
      (row) =>
        (row.isFromMe || allowed(config, group, people, row.sender)) &&
        !COMMAND.test(row.content),
    )
    .slice(-history)
    .map((row) => {
      const who = row.isFromMe ? "Claude" : people.nameOf(row.sender);
      const body =
        row.content.trim() ||
        (row.mediaType === "" ? "" : `[${row.mediaType}]`);
      return `[${row.timestamp.slice(5, 16)}] ${who}: ${people.readable(body).slice(0, 600)}`;
    })
    .join("\n");
}

export function filesSection(files: Attachment[]): string {
  if (files.length === 0) return "";
  const lines = files.map(
    (file) =>
      `- ${file.name} (${file.type}, ${String(Math.ceil(file.bytes / 1024))} KB): ${file.url}`,
  );
  return `\nFiles sent with this, each a link that works for an hour. Download one with curl -fsSL -o <name> '<link>', then read it:\n${lines.join("\n")}\n`;
}

const ACCESS_NOTE: Record<Group["access"], string> = {
  "read-write":
    "If the request needs code changes, make them on a branch and open a PR as you normally would, and put the PR link in your final message.",
  "read-only":
    "This group is read-only: read, search and investigate, then answer. Do not edit files, commit, push, or open PRs; if someone asks for a change, describe it instead. Anything that would need approval is denied automatically.",
};

export interface First {
  group: Group;
  chatName: string;
  from: string;
  text: string;
  transcript: string;
  files: Attachment[];
}

export const firstPrompt = (first: First): string =>
  `You have been asked something in the WhatsApp group "${first.chatName}", where a few people talk about their side projects. You are working in ${first.group.repo}.

Request from ${first.from}:
${first.text}
${filesSection(first.files)}
Recent messages in the group, oldest first:
${first.transcript}

How this works: the final message of each of your turns is posted back to the group verbatim, as a WhatsApp message from you. Write it for a phone: lead with the answer, keep it short, plain text with at most bold and bullets, no tables or headings. Nobody answers questions while you work, so decide and act. ${ACCESS_NOTE[first.group.access]} Later messages from the group arrive in this session as new turns.`;

export const followUp = (
  from: string,
  text: string,
  files: Attachment[],
): string => `${from} on WhatsApp:\n${text}\n${filesSection(files)}`;
