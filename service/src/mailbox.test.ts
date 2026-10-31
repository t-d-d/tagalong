import { describe, expect, it } from "vitest";
import {
  PASS,
  answering,
  busy,
  deliveryOf,
  give,
  heard,
  labelFor,
  messageFor,
  readAnswer,
} from "./mailbox.ts";
import { type SessionState, emptyState } from "./state.ts";

const CHAT = "120363000000000001@g.us";
const OTHER = "120363000000000002@g.us";
const ask = { id: "r1", sender: "447700900002", content: "@podstow why?" };

const session = (): SessionState => ({
  chat: CHAT,
  claude: "podstow",
  cursor: null,
  waiting: true,
  since: 0,
  nudged: false,
  lastText: "",
  deliveries: [],
  link: null,
  woke: null,
  given: [],
  idle: 0,
  readAt: 0,
});

describe("labels", () => {
  it("gives each chat line a short label, the same one each time", () => {
    const state = emptyState();
    expect(labelFor(state, CHAT, { id: "a", sender: "1" })).toBe("m1");
    expect(labelFor(state, CHAT, { id: "b", sender: "2" })).toBe("m2");
    expect(labelFor(state, CHAT, { id: "a", sender: "1" })).toBe("m1");
    expect(labelFor(state, OTHER, { id: "c", sender: "3" })).toBe("m1");
    expect(messageFor(state, CHAT, "m2")).toEqual({ id: "b", sender: "2" });
    expect(messageFor(state, OTHER, "m2")).toBeUndefined();
  });

  it("forgets the oldest labels in a busy chat", () => {
    const state = emptyState();
    for (let n = 0; n < 600; n++)
      labelFor(state, CHAT, { id: `x${String(n)}`, sender: "1" });
    expect(messageFor(state, CHAT, "m1")).toBeUndefined();
    expect(messageFor(state, CHAT, "m600")).toEqual({
      id: "x599",
      sender: "1",
    });
  });
});

describe("labels given to a session", () => {
  it("notes each line's label in what it is given, the latest kept", () => {
    const one = session();
    give(one, "[m1] 10-18 18:00 Sam: hm\n[m2] 10-18 18:01 Ollie: yes");
    give(one, "[m1] again, and [m3]");
    expect(one.given).toEqual(["m2", "m1", "m3"]);
    for (let each = 4; each < 600; each += 1) give(one, `[m${String(each)}]`);
    expect(one.given).toHaveLength(500);
    expect(one.given.at(-1)).toBe("m599");
  });
});

describe("deliveries", () => {
  it("knows its own message in the session by its text, whitespace aside", () => {
    const s = session();
    s.deliveries.push(deliveryOf("Ollie asks you:\nwhy?\n", ask, 1));
    heard(s, "u9", "someone else's message");
    expect(s.deliveries[0]?.uuid).toBeNull();
    heard(s, "u1", "Ollie asks you: why?");
    expect(s.deliveries[0]?.uuid).toBe("u1");
  });

  it("says which deliveries a result answers, and when it answers only messages from elsewhere", () => {
    const s = session();
    s.deliveries.push(deliveryOf("one", ask, 1));
    s.deliveries.push(deliveryOf("two", ask, 2));
    heard(s, "u1", "one");
    heard(s, "u2", "two");
    expect(busy(s)).toBe(true);
    expect(answering(s, ["u1", "u7"])).toEqual([s.deliveries[0]]);
    expect(answering(s, ["u7"])).toBeNull();
    // A turn the session started by itself lists no messages.
    expect(answering(s, [])).toEqual([]);
    // A delivery saved before uuids were noted takes the next result.
    s.deliveries.push({ ...deliveryOf("", ask, 3), key: "" });
    expect(answering(s, ["u7"])).toEqual([s.deliveries[2]]);
    s.deliveries.pop();
    for (const delivery of s.deliveries) delivery.answered = true;
    expect(busy(s)).toBe(false);
  });
});

describe("reading an answer", () => {
  it("reads a label at the start, and leaves it out", () => {
    expect(readAnswer("Done.")).toEqual({
      kind: "message",
      label: undefined,
      text: "Done.",
    });
    expect(readAnswer("[m41] Friday works.\n")).toEqual({
      kind: "message",
      label: "m41",
      text: "Friday works.",
    });
  });

  it("reads the pass word, alone or after a label", () => {
    expect(readAnswer(PASS).kind).toBe("pass");
    expect(readAnswer(` [m3] ${PASS}\n`).kind).toBe("pass");
    expect(readAnswer("").kind).toBe("pass");
    expect(readAnswer(`${PASS}.`).kind).toBe("pass");
    expect(readAnswer(`${PASS} on that, it's fine.`).kind).toBe("message");
  });

  it("reads one emoji as a reaction, and anything more as a message", () => {
    for (const emoji of ["👍", "👍🏽", "❤️", "🇬🇧", "👨‍👩‍👧", "1️⃣"])
      expect(readAnswer(emoji)).toEqual({
        kind: "reaction",
        label: undefined,
        text: emoji,
      });
    expect(readAnswer("[m4] 🎉")).toEqual({
      kind: "reaction",
      label: "m4",
      text: "🎉",
    });
    for (const text of ["👍 done", "👍👍", "1", "ok", ":)"])
      expect(readAnswer(text).kind).toBe("message");
  });
});
