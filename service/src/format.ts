// Pure text helpers: session ids, and Markdown made readable in WhatsApp.

export const oneLine = (text: string | null | undefined): string =>
  (text ?? "").replace(/\s+/gu, " ").trim();

// session_X (links, the CLI) and cse_X (the sessions API) name one session.
const SESSION = /\b(?:session|cse)_([A-Za-z0-9]{8,128})\b/gu;

/** The last session id in `text`, without its prefix, or null. */
export function lastSession(text: string | undefined): string | null {
  const matches = [...(text ?? "").matchAll(SESSION)];
  return matches.at(-1)?.[1] ?? null;
}

export const sessionLink = (id: string): string =>
  `claude.ai/code/session_${id}`;

export const stripAnsi = (text: string): string =>
  // eslint-disable-next-line no-control-regex -- terminal escapes are control characters
  text.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-_]/gu, "");

const LIMIT = 3500;

/** A session's Markdown, made readable in WhatsApp. */
export function toWhatsApp(markdown: string): string {
  let text = markdown
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/^\s*Signing off\.\s*$/gmu, "")
    // A line ending in the session's link: the session's own sign-off.
    .replace(/^.*\bclaude\.ai\/code\/session_\w+\)?\s*$/gmu, "")
    .replace(/^(\s*)[*+] /gmu, "$1- ")
    .replace(/^#{1,6}\s+(.+)$/gmu, "*$1*")
    .replace(/\*\*(.+?)\*\*/gu, "*$1*")
    .replace(/__(.+?)__/gu, "_$1_")
    .replace(/!\[[^\]]*\]\(([^)]+)\)/gu, "$1")
    .replace(
      /\[([^\]]+)\]\(([^)\s]+)\)/gu,
      (_match, label: string, url: string) =>
        label === url ? url : `${label} (${url})`,
    )
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  if (text.length > LIMIT)
    text = `${text.slice(0, LIMIT)}…\n(rest in the session)`;
  return text;
}
