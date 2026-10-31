import { describe, expect, it } from "vitest";
import { addressed, reactedTo } from "./addressing.ts";
import type { MessageRow } from "./store.ts";
import { type Payload, payloadSchema } from "./webhook.ts";

const self = new Set(["447700900100", "120363000000100"]);
const defined = new Set(["podstow", "brainstorm", "critic"]);
const here = ["podstow", "brainstorm"];
const payload = (fields: Record<string, unknown>): Payload =>
  payloadSchema.parse({
    chatJID: "120363000000000001@g.us",
    sender: "447700900002",
    content: "hi",
    ...fields,
  });
const ask = (fields: Record<string, unknown>, repliedTo?: string) =>
  addressed(payload(fields), here, defined, self, repliedTo);

describe("addressed", () => {
  it("asks each Claude named, once, in order", () => {
    expect(ask({ content: "@brainstorm go wide" }).claudes).toEqual([
      "brainstorm",
    ]);
    expect(
      ask({ content: "what do @Podstow and @brainstorm think? @podstow first" })
        .claudes,
    ).toEqual(["podstow", "brainstorm"]);
    expect(ask({ content: "(@podstow) check this" }).claudes).toEqual([
      "podstow",
    ]);
  });

  it("asks the Claude a reply answers, unless the reply names others", () => {
    expect(
      ask({ content: "and the tests?", quotedIsFromMe: true }, "podstow")
        .claudes,
    ).toEqual(["podstow"]);
    expect(
      ask(
        { content: "@brainstorm what about this?", quotedIsFromMe: true },
        "podstow",
      ).claudes,
    ).toEqual(["brainstorm"]);
    expect(ask({ content: "and now?" }, "critic").claudes).toEqual([]);
  });

  it("asks the Claude a voice note or other media with no text replies to, and nobody for one that replies to nothing", () => {
    expect(
      ask({ content: "", mediaType: "audio", quotedIsFromMe: true }, "podstow")
        .claudes,
    ).toEqual(["podstow"]);
    expect(
      ask(
        { content: "", mediaType: "image", quotedIsFromMe: true },
        "brainstorm",
      ).claudes,
    ).toEqual(["brainstorm"]);
    expect(ask({ content: "", mediaType: "audio" })).toEqual({
      claudes: [],
      missing: [],
      bare: false,
    });
  });

  it("notices a defined Claude that is not in the chat", () => {
    expect(ask({ content: "@critic have a look" })).toEqual({
      claudes: [],
      missing: ["critic"],
      bare: false,
    });
  });

  it("treats @claude or a mention of the number, with no name, as asking who is here", () => {
    expect(ask({ content: "@claude what's up" })).toEqual({
      claudes: [],
      missing: [],
      bare: true,
    });
    expect(
      ask({ content: "hey", mentionedJids: ["120363000000100@lid"] }).bare,
    ).toBe(true);
    expect(ask({ content: "@claude and @podstow" }).bare).toBe(false);
  });

  it("ignores everything else", () => {
    expect(ask({ content: "hello podstow" }).claudes).toEqual([]);
    expect(ask({ content: "mail me at me@podstow.com" }).claudes).toEqual([]);
    expect(ask({ content: "@podstow hi", isFromMe: true }).claudes).toEqual([]);
    expect(
      ask({ content: "👍", eventType: "reaction" }, "podstow").claudes,
    ).toEqual([]);
    expect(ask({ content: "  " }, "podstow").claudes).toEqual([]);
  });
});

const GROUP = "120363000000000001@g.us";
const reaction = (emoji: string, fields: Record<string, unknown> = {}) =>
  payload({
    eventType: "reaction",
    content: emoji,
    mediaType: "reaction",
    reactionEmoji: emoji,
    reactionToMessageId: "sent-2",
    ...fields,
  });
const reacts = (fields: Record<string, unknown>, claude?: string) =>
  addressed(
    reaction(
      typeof fields.reactionEmoji === "string" ? fields.reactionEmoji : "👍",
      fields,
    ),
    here,
    defined,
    self,
    claude,
  ).claudes;

describe("addressed, for a reaction on a Claude's latest answer", () => {
  it("asks the Claude whose answer it is on", () => {
    expect(reacts({}, "podstow")).toEqual(["podstow"]);
    expect(reacts({ reactionEmoji: "❤️" }, "brainstorm")).toEqual([
      "brainstorm",
    ]);
  });

  it("asks nobody when it is on nobody's latest answer, or a Claude not here", () => {
    expect(reacts({})).toEqual([]);
    expect(reacts({}, "critic")).toEqual([]);
  });

  it("asks nobody when a reaction is taken off", () => {
    expect(
      reacts(
        { reactionEmoji: "", content: "", reactionRemoved: true },
        "podstow",
      ),
    ).toEqual([]);
  });

  it("asks nobody for the device's own reactions", () => {
    expect(reacts({ isFromMe: true }, "podstow")).toEqual([]);
    expect(reacts({ sender: "120363000000100@lid" }, "podstow")).toEqual([]);
  });

  it("never runs as a command or asks who is here", () => {
    expect(
      addressed(
        reaction("👍", { mentionedJids: ["120363000000100@lid"] }),
        here,
        defined,
        self,
        undefined,
      ),
    ).toEqual({ claudes: [], missing: [], bare: false });
  });
});

const row = (
  id: string,
  content: string,
  isFromMe: boolean,
  at: string,
): MessageRow => ({
  id,
  chatJid: GROUP,
  sender: isFromMe ? "447700900100" : "447700900002",
  content,
  timestamp: `2026-10-18 17:${at}:00+00:00`,
  isFromMe,
  mediaType: "",
  fileLength: 0,
});

// The chat: podstow answered twice, brainstorm once, a person spoke and
// tagalong posted a notice.
const rows = [
  row("sent-1", "*podstow:* First answer.", true, "01"),
  row("sent-2", "*podstow:* Shall I open the PR?", true, "02"),
  row("sent-3", "*brainstorm:* Go wide.", true, "03"),
  row("m1", "we ship on Friday", false, "04"),
  row("sent-4", "Ask one of us by name: @podstow.", true, "05"),
];
const store = {
  message: (chat: string, id: string | undefined) =>
    rows.find((each) => each.chatJid === chat && each.id === id),
  latestAnswer: (chat: string, claude: string) =>
    rows.findLast(
      (each) =>
        each.chatJid === chat &&
        each.isFromMe &&
        each.content.startsWith(`*${claude}:*`),
    ),
};
const on = (id: string, fields: Record<string, unknown> = {}) =>
  reactedTo(reaction("👍", { reactionToMessageId: id, ...fields }), store);

describe("reactedTo", () => {
  it("finds the Claude whose latest answer a reaction is on, and that answer", () => {
    expect(on("sent-2")).toEqual({ claude: "podstow", answer: rows[1] });
    expect(on("sent-3")?.claude).toBe("brainstorm");
  });

  it("finds nothing for an older answer, a person's message or one of tagalong's notices", () => {
    expect(on("sent-1")).toBeUndefined();
    expect(on("m1")).toBeUndefined();
    expect(on("sent-4")).toBeUndefined();
    expect(on("gone")).toBeUndefined();
  });

  it("finds nothing for a message, or for an answer in another chat", () => {
    expect(
      reactedTo(payload({ quotedMessageId: "sent-2", content: "ok" }), store),
    ).toBeUndefined();
    expect(
      on("sent-2", { chatJID: "120363000000000002@g.us" }),
    ).toBeUndefined();
  });
});
