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

  it("finds no words in other events", () => {
    expect(textOf({ type: "user", message: { content: "hi" } })).toBe("");
    expect(textOf({ type: "result", result: { not: "text" } })).toBe("");
  });
});
