import { describe, expect, it } from "vitest";
import { launchFailure } from "./cloud.ts";

describe("launchFailure", () => {
  it("names the usual reasons a launch fails", () => {
    expect(
      launchFailure(1, "claude stopped at the folder-trust prompt in /w"),
    ).toBe("folder-untrusted");
    expect(
      launchFailure(1, "\u001b[31mNot logged in\u001b[0m · Please run /login"),
    ).toBe("not-logged-in");
    expect(launchFailure(1, "API Error: 429 rate limit")).toBe("limit");
    expect(
      launchFailure(1, "The Claude GitHub app is not installed on o/r"),
    ).toBe("github");
    expect(launchFailure(1, "error: unknown option '--cloud'")).toBe(
      "cli-flags",
    );
  });

  it("says when the CLI never confirmed, and otherwise does not guess", () => {
    expect(launchFailure(3, "Connecting...")).toBe("no-confirmation");
    expect(launchFailure(1, "something else")).toBe("unknown");
  });
});
