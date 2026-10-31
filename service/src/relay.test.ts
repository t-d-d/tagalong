import { describe, expect, it } from "vitest";
import { readGap } from "./relay.ts";

const MINUTE = 60_000;

describe("readGap", () => {
  it("backs off 30 seconds, then 1, 2, 5, 10 and 30 minutes, and stays at 30", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 50].map(readGap)).toEqual(
      [0.5, 1, 2, 5, 10, 30, 30, 30].map((minutes) => minutes * MINUTE),
    );
  });
});
