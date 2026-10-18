import { describe, expect, it } from "vitest";
import {
  lastSession,
  oneLine,
  sessionLink,
  stripAnsi,
  toWhatsApp,
} from "./format.ts";

describe("lastSession", () => {
  it("reads either spelling of a session id and keeps the last", () => {
    expect(
      lastSession("see claude.ai/code/session_01AbCdEfGh then cse_01ZyXwVuTs"),
    ).toBe("01ZyXwVuTs");
    expect(lastSession("↗ claude.ai/code/session_01AbCdEfGh")).toBe(
      "01AbCdEfGh",
    );
  });

  it("finds nothing in text without one", () => {
    expect(lastSession("no session here, session_short")).toBeNull();
    expect(lastSession(undefined)).toBeNull();
  });
});

describe("text helpers", () => {
  it("folds whitespace", () => {
    expect(oneLine("  a\n\n b\tc ")).toBe("a b c");
    expect(oneLine(null)).toBe("");
  });

  it("links a session", () => {
    expect(sessionLink("01AbCdEfGh")).toBe("claude.ai/code/session_01AbCdEfGh");
  });

  it("strips terminal escapes", () => {
    expect(
      stripAnsi("\u001b[1mbold\u001b[0m and \u001b[32mgreen\u001b[0m"),
    ).toBe("bold and green");
  });
});

describe("toWhatsApp", () => {
  it("turns Markdown into what WhatsApp shows", () => {
    const text = toWhatsApp(
      "## Summary\n\n**Done** with __this__.\n\n* one\n+ two\n\n[the PR](https://github.com/o/r/pull/1) and [https://x.test](https://x.test)\n<!-- hidden -->\n\n\n\nSigning off.\n",
    );
    expect(text).toBe(
      "*Summary*\n\n*Done* with _this_.\n\n- one\n- two\n\nthe PR (https://github.com/o/r/pull/1) and https://x.test",
    );
  });

  it("drops a line that ends in a session's link", () => {
    expect(
      toWhatsApp(
        "Fixed.\n\n↗ claude.ai/code/session_01AbCdEfGh\n[session](https://claude.ai/code/session_01AbCdEfGh)",
      ),
    ).toBe("Fixed.");
    expect(toWhatsApp("See claude.ai/code/session_01AbCdEfGh for more")).toBe(
      "See claude.ai/code/session_01AbCdEfGh for more",
    );
  });

  it("cuts a long answer and says where the rest is", () => {
    const text = toWhatsApp("x".repeat(5000));
    expect(text.length).toBeLessThan(3600);
    expect(text.endsWith("(rest in the session)")).toBe(true);
  });
});
