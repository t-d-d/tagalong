import { describe, expect, it } from "vitest";
import { addressed } from "./addressing.ts";
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
