import { describe, expect, it } from "vitest";
import { listenDue } from "./listening.ts";
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
  ...extra,
});
const base = {
  now: T + 200_000,
  quietMs: 120_000,
  hour: [] as number[],
  perHour: 4,
  mayAsk: (sender: string) => sender === "447700900002",
};

describe("listenDue", () => {
  it("is due once a person who may ask spoke and the chat has been quiet", () => {
    expect(listenDue({ ...base, rows: [row("m1", T)] })).toBe("due");
  });

  it("waits while the chat is still talking, whoever spoke last", () => {
    expect(
      listenDue({
        ...base,
        rows: [row("m1", T), row("a1", T + 150_000, { isFromMe: true })],
      }),
    ).toBe("talking");
  });

  it("is never started by a Claude's answer, a command, or someone who may not ask", () => {
    expect(
      listenDue({
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
      listenDue({ ...base, rows: [row("m1", T)], hour: [1, 2, 3, 4] }),
    ).toBe("capped");
  });
});
