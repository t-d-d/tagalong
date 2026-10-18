import { describe, expect, it } from "vitest";
import { logLines } from "../../test/log-lines.ts";
import { CommandError, HttpError, errorFields, log } from "./log.ts";

describe("log", () => {
  it("writes one JSON line naming the event", () => {
    const { lines } = logLines();
    log.warn("bridge-unreachable", { status: 503 });
    expect(lines).toEqual([
      expect.objectContaining({
        level: "warn",
        event: "bridge-unreachable",
        status: 503,
      }),
    ]);
  });

  it("gives an error's class and status, never its message", () => {
    expect(errorFields(new HttpError("bridge send", 500))).toEqual({
      error: "HttpError",
      status: 500,
      where: "bridge send",
    });
    expect(errorFields(new Error("+447700900001 said something"))).toEqual({
      error: "Error",
    });
    expect(errorFields(new CommandError("no repo"))).toEqual({
      error: "CommandError",
      why: "no repo",
    });
    expect(errorFields("text")).toEqual({ error: "string" });
  });
});
