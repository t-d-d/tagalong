// Every log line a test causes, parsed, instead of on stdout.
import { z } from "zod";
import { setSink } from "../service/src/log.ts";

const lineSchema = z.looseObject({
  time: z.string(),
  level: z.enum(["info", "warn", "error"]),
  event: z.string(),
});
export type Line = z.infer<typeof lineSchema>;

export function logLines(): { lines: Line[]; raw: string[] } {
  const lines: Line[] = [];
  const raw: string[] = [];
  setSink((text) => {
    raw.push(text);
    lines.push(lineSchema.parse(JSON.parse(text)));
  });
  return { lines, raw };
}

export const eventsOf = (lines: Line[]): string[] =>
  lines.map((line) => line.event);
