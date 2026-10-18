import { describe, expect, it } from "vitest";
import { repoFiles, scripts } from "../test/repo.ts";
import { tiers } from "../test/tiers.ts";

describe("fitness: a test's suffix fixes its tier (test-tiers.md)", () => {
  it("names no test outside the tiers", () => {
    expect(
      repoFiles().filter((path) =>
        /\.spec\.[jt]sx?$|\.test\.(js|tsx|mjs)$/u.test(path),
      ),
    ).toEqual([]);
  });

  it("holds only static tests in fitness/", () => {
    expect(
      repoFiles().filter(
        (path) => path.startsWith("fitness/") && !path.endsWith(".static.ts"),
      ),
    ).toEqual([]);
  });

  it("runs every tier in the gate", () => {
    const gate = scripts().test ?? "";
    for (const tier of tiers) expect(gate).toContain(`--project ${tier.name}`);
  });

  it("sets up the offline guard for every tier", () => {
    expect(repoFiles()).toContain("test/offline.ts");
  });
});
