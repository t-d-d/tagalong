import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logLines } from "../../test/log-lines.ts";
import { every } from "./loops.ts";

describe("loops", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("logs a task that throws before it returns a promise, and runs it again next time", async () => {
    const { lines } = logLines();
    let runs = 0;
    const timer = every("people", 1000, () => {
      runs += 1;
      throw new Error("database is locked");
    });
    try {
      await vi.advanceTimersByTimeAsync(2000);
    } finally {
      clearInterval(timer);
    }
    expect(runs).toBe(2);
    expect(lines).toEqual([
      expect.objectContaining({
        level: "warn",
        event: "loop-failed",
        loop: "people",
        error: "Error",
      }),
      expect.objectContaining({ event: "loop-failed", loop: "people" }),
    ]);
  });

  it("logs a task whose promise rejects", async () => {
    const { lines } = logLines();
    const timer = every("poll", 1000, () =>
      Promise.reject(new TypeError("fetch failed")),
    );
    try {
      await vi.advanceTimersByTimeAsync(1000);
    } finally {
      clearInterval(timer);
    }
    expect(lines).toEqual([
      expect.objectContaining({
        event: "loop-failed",
        loop: "poll",
        error: "TypeError",
      }),
    ]);
  });
});
