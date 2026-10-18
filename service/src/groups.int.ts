import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GROUP, MEMBER, OWNER } from "../../test/bridge-db.ts";
import { GroupsStore } from "./groups.ts";
import { StateStore } from "./state.ts";

const folder = () => mkdtempSync(join(tmpdir(), "tagalong-groups-"));

describe("groups.json on disk", () => {
  it("starts empty, and writes what update returns", () => {
    const path = join(folder(), "groups.json");
    const store = new GroupsStore(path, [OWNER]);
    expect(store.config.groups.size).toBe(0);
    store.update((file) => ({
      ...file,
      groups: {
        [GROUP]: { repo: "o/r", access: "read-write", members: [MEMBER] },
      },
    }));
    expect(store.config.groups.get(GROUP)?.members).toEqual([MEMBER]);
    expect(new GroupsStore(path, []).config.groups.get(GROUP)?.repo).toBe(
      "o/r",
    );
  });

  it("writes nothing that is not valid, and keeps the live config", () => {
    const path = join(folder(), "groups.json");
    const store = new GroupsStore(path, []);
    store.update(() => ({
      groups: { [GROUP]: { repo: "o/r", access: "read-only" } },
    }));
    const before = readFileSync(path, "utf8");
    expect(() =>
      store.update(() => ({
        groups: {
          [GROUP]: { repo: "o/r", access: "read-write", members: ["Ollie"] },
        },
      })),
    ).toThrow();
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(store.config.groups.get(GROUP)?.access).toBe("read-only");
  });

  it("reloads a file that changed underneath", () => {
    const path = join(folder(), "groups.json");
    const store = new GroupsStore(path, []);
    writeFileSync(path, JSON.stringify({ owners: [OWNER], groups: {} }));
    expect(store.reload().owners).toEqual([OWNER]);
  });
});

describe("state.json on disk", () => {
  it("carries sessions across a restart", () => {
    const path = join(folder(), "state.json");
    const state = new StateStore(path);
    state.state.sessions.abc12345 = {
      chat: GROUP,
      cursor: "4",
      waiting: true,
      since: 1,
      nudged: false,
      lastText: "",
    };
    state.state.sentMedia.push(
      ...Array.from({ length: 600 }, (_, index) => `m${String(index)}`),
    );
    state.save();
    const again = new StateStore(path);
    expect(again.state.sessions.abc12345?.cursor).toBe("4");
    expect(again.state.sentMedia).toHaveLength(500);
    expect(again.state.sentMedia.at(-1)).toBe("m599");
  });
});
