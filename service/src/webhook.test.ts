import { describe, expect, it } from "vitest";
import { type Payload, payloadSchema, trigger } from "./webhook.ts";

const self = new Set(["447700900100", "120363000000100"]);
const payload = (fields: Record<string, unknown>): Payload =>
  payloadSchema.parse({
    chatJID: "120363000000000001@g.us",
    sender: "447700900002",
    content: "hi",
    ...fields,
  });

describe("trigger", () => {
  it("answers a mention of Claude's number or LID", () => {
    expect(
      trigger(
        payload({
          content: "@120363000000100 look",
          mentionedJids: ["120363000000100@lid"],
        }),
        self,
      ),
    ).toBe("mention");
    expect(
      trigger(
        payload({
          content: "look",
          mentionedJids: ["447700900100@s.whatsapp.net"],
        }),
        self,
      ),
    ).toBe("mention");
  });

  it("answers @claude typed anywhere, and a reply to Claude", () => {
    expect(
      trigger(payload({ content: "what do you think @Claude?" }), self),
    ).toBe("@claude");
    expect(
      trigger(
        payload({ content: "and the tests?", quotedIsFromMe: true }),
        self,
      ),
    ).toBe("reply");
  });

  it("ignores everything else", () => {
    expect(trigger(payload({ content: "hello" }), self)).toBeNull();
    expect(trigger(payload({ content: "@claudette hi" }), self)).toBeNull();
    expect(
      trigger(
        payload({
          content: "@447700900002 hi",
          mentionedJids: ["447700900002@s.whatsapp.net"],
        }),
        self,
      ),
    ).toBeNull();
    expect(
      trigger(payload({ content: "@claude hi", isFromMe: true }), self),
    ).toBeNull();
    expect(
      trigger(
        payload({ content: "👍", eventType: "reaction", quotedIsFromMe: true }),
        self,
      ),
    ).toBeNull();
    expect(
      trigger(payload({ content: "  ", quotedIsFromMe: true }), self),
    ).toBeNull();
  });
});
