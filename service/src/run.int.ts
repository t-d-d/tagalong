import { describe, expect, it } from "vitest";
import { run } from "./run.ts";

describe("run", () => {
  it("survives a child that exits without reading its input (issue #2)", async () => {
    // true reads nothing, so most of a megabyte meets a closed pipe.
    const result = await run("true", [], {
      env: { PATH: "/usr/bin:/bin" },
      input: "x".repeat(1024 * 1024),
    });
    expect(result.code).toBe(0);
  });

  it("gives a child with no input nothing to read", async () => {
    const result = await run("cat", [], { env: { PATH: "/usr/bin:/bin" } });
    expect(result).toEqual({ code: 0, out: "" });
  });

  it("passes input to a child that reads it, and collects both streams", async () => {
    const result = await run("sh", ["-c", "cat; echo err >&2"], {
      env: { PATH: "/usr/bin:/bin" },
      input: "hello\n",
    });
    expect(result).toEqual({ code: 0, out: "hello\nerr\n" });
  });
});
