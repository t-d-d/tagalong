import { describe, expect, it } from "vitest";
import { interjectDue } from "./interjecting.ts";
import type { MessageRow } from "./store.ts";

const T = Date.parse("2026-10-18T17:00:00Z");
const stamp = (ms: number) =>
  new Date(ms).toISOString().replace("T", " ").replace("Z", "+00:00");
const row = (
  id: string,
  at: number,
  extra: Partial<MessageRow> = {},
): MessageRow => ({
  id,
  chatJid: "120363000000000001@g.us",
  sender: "447700900002",
  content: "an idea",
  timestamp: stamp(at),
  isFromMe: false,
  mediaType: "",
  fileLength: undefined,
  ...extra,
});
const base = {
  now: T + 200_000,
  quietMs: 120_000,
  hour: [] as number[],
  perHour: 4,
  mayAsk: (sender: string) => sender === "447700900002",
};

describe("interjectDue", () => {
  it("is due once a person who may ask spoke and the chat has been quiet", () => {
    expect(interjectDue({ ...base, rows: [row("m1", T)] })).toBe("due");
  });

  it("waits while the chat is still talking, whoever spoke last", () => {
    expect(
      interjectDue({
        ...base,
        rows: [row("m1", T), row("a1", T + 150_000, { isFromMe: true })],
      }),
    ).toBe("talking");
  });

  it("is never started by a Claude's answer, a command, or someone who may not ask", () => {
    expect(
      interjectDue({
        ...base,
        rows: [
          row("a1", T, { isFromMe: true, content: "*podstow:* hi" }),
          row("c1", T, { content: "@claude who" }),
          row("s1", T, { sender: "447700900003" }),
        ],
      }),
    ).toBe("nothing");
  });

  it("stops at the hourly limit", () => {
    expect(
      interjectDue({ ...base, rows: [row("m1", T)], hour: [1, 2, 3, 4] }),
    ).toBe("capped");
  });

  it("is due once the session woke by itself and both have been quiet", () => {
    expect(interjectDue({ ...base, rows: [], woke: T })).toBe("due");
  });

  it("waits while the session's own turn is recent, though the chat is quiet", () => {
    expect(
      interjectDue({ ...base, rows: [row("m1", T)], woke: T + 150_000 }),
    ).toBe("talking");
  });

  it("counts a wake toward the hourly limit", () => {
    expect(
      interjectDue({ ...base, rows: [], woke: T, hour: [1, 2, 3, 4] }),
    ).toBe("capped");
  });
});
