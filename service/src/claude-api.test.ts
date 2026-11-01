import { describe, expect, it } from "vitest";
import { carried, textOf, type Payload } from "./claude-api.ts";

describe("textOf", () => {
  it("reads a result and an assistant message's text blocks", () => {
    expect(textOf({ type: "result", result: "done" })).toBe("done");
    expect(
      textOf({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "a" },
            { type: "tool_use", id: "x" },
            { type: "text", text: "b" },
          ],
        },
      }),
    ).toBe("a\nb");
    expect(textOf({ type: "assistant", message: { content: "plain" } })).toBe(
      "plain",
    );
  });

  it("reads what a session was sent, but not tool results or meta messages", () => {
    expect(textOf({ type: "user", message: { content: "hi" } })).toBe("hi");
    expect(
      textOf({
        type: "user",
        message: { content: [{ type: "tool_result", content: "x" }] },
      }),
    ).toBe("");
    expect(
      textOf({ type: "user", isMeta: true, message: { content: "reminder" } }),
    ).toBe("");
  });

  it("finds no words in other events", () => {
    expect(textOf({ type: "system", subtype: "init" })).toBe("");
    expect(textOf({ type: "result", result: { not: "text" } })).toBe("");
  });
});

describe("carried", () => {
  const sent = (text: string): Payload => ({
    type: "user",
    message: { content: text },
  });
  const said = (text: string): Payload => ({
    type: "assistant",
    message: { content: [{ type: "text", text }] },
  });
  const result = (text: string): Payload => ({ type: "result", result: text });

  it("shows every message of a turn that held tags, in order, not its result", () => {
    expect(
      carried(
        [
          sent("[m1] Ollie: is main green?"),
          said("Checking the runs."),
          said('<whatsapp reply="m1">Yes, green.</whatsapp>'),
          said("Before:\n<whatsapp>One.</whatsapp> after."),
          said("Notes: I read the last three runs."),
          result("Notes: I read the last three runs."),
        ],
        10_000,
      ),
    ).toBe(
      'Sent to you:\n[m1] Ollie: is main green?\n\nYou answered:\n<whatsapp reply="m1">Yes, green.</whatsapp>\n\nYou answered:\nBefore:\n<whatsapp>One.</whatsapp> after.',
    );
  });

  it("shows a turn whose messages only show tags by its result (#96)", () => {
    expect(
      carried(
        [
          sent("how do I tag?"),
          said("Example: `<whatsapp>Done</whatsapp>`"),
          result("Like that."),
        ],
        10_000,
      ),
    ).toBe("Sent to you:\nhow do I tag?\n\nYou answered:\nLike that.");
  });

  it("keeps each turn's tagged messages to that turn", () => {
    expect(
      carried(
        [
          sent("first"),
          said("<whatsapp>A</whatsapp>"),
          result("<whatsapp>A</whatsapp>"),
          sent("second"),
          said("<whatsapp>B</whatsapp>"),
          said("done"),
          result("done"),
        ],
        10_000,
      ),
    ).toBe(
      "Sent to you:\nfirst\n\nYou answered:\n<whatsapp>A</whatsapp>\n\nSent to you:\nsecond\n\nYou answered:\n<whatsapp>B</whatsapp>",
    );
  });

  it("keeps a tagged message before a delivery that arrived mid-turn", () => {
    expect(
      carried(
        [
          sent("A"),
          said('<whatsapp reply="m1">X</whatsapp>'),
          sent("B"),
          said("<whatsapp>Y</whatsapp>"),
          result("<whatsapp>Y</whatsapp>"),
        ],
        10_000,
      ),
    ).toBe(
      'Sent to you:\nA\n\nYou answered:\n<whatsapp reply="m1">X</whatsapp>\n\nSent to you:\nB\n\nYou answered:\n<whatsapp>Y</whatsapp>',
    );
  });

  it("shows a turn's result when none of its messages held tags", () => {
    expect(
      carried([sent("why?"), said("Because."), result("Because.")], 10_000),
    ).toBe("Sent to you:\nwhy?\n\nYou answered:\nBecause.");
  });

  it("keeps what a turn tagged when it ends with no result", () => {
    expect(
      carried([sent("why?"), said("<whatsapp>Because.</whatsapp>")], 10_000),
    ).toBe(
      "Sent to you:\nwhy?\n\nYou answered:\n<whatsapp>Because.</whatsapp>",
    );
  });

  it("bounds the whole dialogue, the latest kept", () => {
    const events = [
      sent("old"),
      said(`<whatsapp>${"x".repeat(100)}</whatsapp>`),
      result("x"),
      sent("new"),
      said("<whatsapp>latest</whatsapp>"),
      result("latest"),
    ];
    const text = carried(events, 80);
    expect(text).toBe(
      "(2 earlier messages left out)\n\nSent to you:\nnew\n\nYou answered:\n<whatsapp>latest</whatsapp>",
    );
  });
});
