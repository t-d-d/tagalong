import { describe, expect, it } from "vitest";
import {
  answering,
  busy,
  deliveryOf,
  heard,
  labelFor,
  forChat,
  messageFor,
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
  deliveries: [],
  link: null,
  tags: true,
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

describe("reading what a Claude tags for the chat", () => {
  it("reads each pair in the order written, with its reply and its line breaks", () => {
    expect(
      forChat(
        'Deployed.\n<whatsapp reply="m45">Deployed. The fix is live.</whatsapp>\nthen\n<whatsapp>Heads up,\nmain is red.</whatsapp>',
      ),
    ).toEqual({
      posts: [
        { kind: "message", reply: "m45", text: "Deployed. The fix is live." },
        { kind: "message", reply: undefined, text: "Heads up,\nmain is red." },
      ],
      unclosed: false,
    });
  });

  it("reads nothing outside tags, nor in empty tags", () => {
    expect(forChat("Done, and PASS.")).toEqual({ posts: [], unclosed: false });
    expect(
      forChat('<whatsapp> </whatsapp><whatsapp reply="m2"></whatsapp>'),
    ).toEqual({
      posts: [],
      unclosed: false,
    });
  });

  it("posts nothing from an unclosed tag, and says it was there", () => {
    expect(forChat("<whatsapp>Half of it")).toEqual({
      posts: [],
      unclosed: true,
    });
    expect(
      forChat('<whatsapp>One.</whatsapp> and <whatsapp reply="m3">two'),
    ).toEqual({
      posts: [{ kind: "message", reply: undefined, text: "One." }],
      unclosed: true,
    });
  });

  it("reads one emoji with a reply as a reaction, and anything else as a message", () => {
    for (const emoji of ["👍", "👍🏽", "❤️", "🇬🇧", "👨‍👩‍👧", "1️⃣"])
      expect(forChat(`<whatsapp reply="m4">${emoji}</whatsapp>`).posts).toEqual(
        [{ kind: "reaction", reply: "m4", text: emoji }],
      );
    expect(forChat("<whatsapp>🎉</whatsapp>").posts).toEqual([
      { kind: "message", reply: undefined, text: "🎉" },
    ]);
    for (const text of ["👍 done", "👍👍", "1", "ok", ":)"])
      expect(
        forChat(`<whatsapp reply="m4">${text}</whatsapp>`).posts[0]?.kind,
      ).toBe("message");
  });
});
