import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readRepoFile, repoFiles, root } from "../test/repo.ts";

const files = () =>
  repoFiles().filter(
    (path) =>
      /^docs\/constraints\/.+\.md$/u.test(path) && !path.endsWith("README.md"),
  );

describe("fitness: every constraint file has the same parts (docs/constraints/README.md)", () => {
  it("has a Relevance line, a short Decision, Rules, Do not and History", () => {
    expect(files().length).toBeGreaterThan(0);
    for (const path of files()) {
      const text = readRepoFile(path);
      const decision = /^Decision: (.+)$/mu.exec(text)?.[1] ?? "";
      expect(text, path).toMatch(/^Relevance: .+$/mu);
      expect(decision.length, path).toBeGreaterThan(0);
      expect(decision.length, path).toBeLessThanOrEqual(160);
      expect(text, path).toContain("## Rules");
      expect(text, path).toContain("## Do not");
      expect(text, path).toMatch(/^History: .+$/mu);
    }
  });

  it("has a file for every constraint the code names", () => {
    const code = repoFiles().filter((path) =>
      /\.(ts|js|py|sh|ya?ml)$|Dockerfile$/u.test(path),
    );
    const named = new Set(
      code.flatMap((path) =>
        [...readRepoFile(path).matchAll(/\b([a-z][a-z-]+)\.md\b/gu)].map(
          (match) => match[1] ?? "",
        ),
      ),
    );
    const missing = [...named].filter(
      (name) =>
        !["README", "CLAUDE", "PRD", "SKILL"].includes(name) &&
        !existsSync(join(root, "docs", "constraints", `${name}.md`)) &&
        !existsSync(join(root, "docs", `${name}.md`)),
    );
    expect(missing).toEqual([]);
  });
});

describe("fitness: plain writing, no em dashes (CLAUDE.md)", () => {
  it("has none in the docs or in what tagalong says in WhatsApp", () => {
    const prose = repoFiles().filter(
      (path) =>
        (/\.md$/u.test(path) && !path.startsWith(".claude/skills/unslop/")) ||
        /^service\/src\/[^/]+\.ts$/u.test(path),
    );
    expect(prose.filter((path) => readRepoFile(path).includes("—"))).toEqual(
      [],
    );
  });
});
