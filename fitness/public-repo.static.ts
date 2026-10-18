import { describe, expect, it } from "vitest";
import { readRepoFile, repoFiles } from "../test/repo.ts";

// Text files a value could hide in. The lockfile is hashes and versions.
const files = () =>
  repoFiles().filter(
    (path) =>
      path !== "package-lock.json" &&
      !path.startsWith(".claude/skills/unslop/") &&
      !/\.(png|jpg|ico)$/u.test(path),
  );

// Ofcom's drama range, the fake group and LID prefix, and digests written in hex.
const fake = (digits: string) =>
  /^447700900\d{3}$/u.test(digits) || digits.startsWith("120363000000");

describe("fitness: the repo holds no values (public-repo.md)", () => {
  it("has no phone number, group, LID or account id outside the fake ranges", () => {
    const found = files().flatMap((path) =>
      [...readRepoFile(path).matchAll(/(?<![\w.:/-])\d{10,}(?![\w.-])/gu)]
        .map((match) => match[0])
        .filter((digits) => !fake(digits))
        .map((digits) => `${path}: ${digits}`),
    );
    expect(found).toEqual([]);
  });

  it("has no real environment or session id", () => {
    const found = files().flatMap((path) =>
      [
        ...readRepoFile(path).matchAll(
          /\b(env|session|cse)_[A-Za-z0-9]{12,}\b/gu,
        ),
      ]
        .map((match) => match[0])
        .filter(
          (id) =>
            !/^(env_fake|session_01Session|cse_01Session)/u.test(id) &&
            !/^session_01Abcdefghij$/u.test(id),
        )
        .map((id) => `${path}: ${id}`),
    );
    expect(found).toEqual([]);
  });

  it("commits no groups.json, state.json or store", () => {
    expect(
      repoFiles().filter((path) =>
        /(^|\/)(groups|state)\.json$|\.db$|\.bridge-token$/u.test(path),
      ),
    ).toEqual([]);
  });
});
