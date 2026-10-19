import { describe, expect, it } from "vitest";
import { textOf } from "./claude-api.ts";

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
