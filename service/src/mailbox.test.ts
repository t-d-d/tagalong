import { describe, expect, it } from "vitest";
import {
  answering,
  busy,
  deliveryOf,
  heard,
  labelFor,
  forChat,
  messageFor,
  tagged,
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
      forChat('<whatsapp>One.</whatsapp> and\n<whatsapp reply="m3">two'),
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

  it("reads a pair only where its opening tag is the first thing on its line (#96)", () => {
    const one = { kind: "message", reply: "m45", text: "Done" };
    expect(
      forChat('Shown first.\n<whatsapp reply="m45">Done</whatsapp>'),
    ).toEqual({ posts: [one], unclosed: false });
    for (const before of [" ", '"', "> ", "- ", "`", "Example: ", "    "])
      expect(
        forChat(`Shown first.\n${before}<whatsapp reply="m45">Done</whatsapp>`),
      ).toEqual({ posts: [], unclosed: false });
    // A second pair on the line the first closed on has something before it.
    expect(
      forChat('<whatsapp reply="m45">Done</whatsapp> <whatsapp>Two</whatsapp>'),
    ).toEqual({ posts: [one], unclosed: false });
    // A tag that does not count is plain text, closing tag and all, and is not left open.
    expect(forChat("Quoted: <whatsapp>Half of it")).toEqual({
      posts: [],
      unclosed: false,
    });
    expect(
      forChat(
        'Quoted: <whatsapp>Hi</whatsapp>\n<whatsapp reply="m45">Done</whatsapp>',
      ),
    ).toEqual({ posts: [one], unclosed: false });
    expect(tagged("Example: `<whatsapp>Done</whatsapp>`")).toBe(false);
    expect(tagged("<whatsapp>Half of it")).toBe(true);
  });

  it("reads no pair inside a fenced code block (#96)", () => {
    for (const fence of ["```", "~~~", "```ts", "````"])
      expect(
        forChat(
          `Like this:\n${fence}\n<whatsapp reply="m45">Done</whatsapp>\n${fence}\n`,
        ),
      ).toEqual({ posts: [], unclosed: false });
    // An unclosed block runs to the end of the message.
    expect(forChat("```\n<whatsapp>Done</whatsapp>")).toEqual({
      posts: [],
      unclosed: false,
    });
    // A block closes only with a fence of its own kind.
    expect(
      forChat(
        "```\n~~~\n<whatsapp>Done</whatsapp>\n```\n<whatsapp>After</whatsapp>",
      ),
    ).toEqual({
      posts: [{ kind: "message", reply: undefined, text: "After" }],
      unclosed: false,
    });
    expect(tagged("```\n<whatsapp>Done</whatsapp>\n```")).toBe(false);
    // As in Markdown, a block closes only with a fence of its own character,
    // at least as long, with nothing after it.
    for (const inner of ["````md\n```\n", "```ts\n```ts\n", "~~~~\n~~~\n"])
      expect(forChat(`${inner}<whatsapp>Leak</whatsapp>\n`).posts).toEqual([]);
    // Three backticks with a backtick after them on the line are inline code.
    expect(
      forChat("```npm run gate``` is the command\n<whatsapp>Done</whatsapp>")
        .posts,
    ).toEqual([{ kind: "message", reply: undefined, text: "Done" }]);
  });

  it("posts a code block inside a pair as part of it, and counts on after it (#96)", () => {
    expect(
      forChat(
        "<whatsapp>Run this:\n```\nnpm run gate\n```\n</whatsapp>\n<whatsapp>Then this.</whatsapp>",
      ),
    ).toEqual({
      posts: [
        {
          kind: "message",
          reply: undefined,
          text: "Run this:\n```\nnpm run gate\n```",
        },
        { kind: "message", reply: undefined, text: "Then this." },
      ],
      unclosed: false,
    });
    // One fence inside a pair opens no block after it.
    expect(
      forChat("<whatsapp>A fence: ```</whatsapp>\n<whatsapp>Next.</whatsapp>")
        .posts,
    ).toHaveLength(2);
    expect(
      forChat("<whatsapp>Fence:\n```\n</whatsapp>\n<whatsapp>Next.</whatsapp>")
        .posts,
    ).toHaveLength(2);
  });
});
