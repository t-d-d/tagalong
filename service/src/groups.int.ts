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
      claudes: { podstow: { repo: "o/r", access: "read-write" } },
      groups: { [GROUP]: { claudes: { podstow: { members: [MEMBER] } } } },
    }));
    expect(store.config.groups.get(GROUP)?.members).toEqual({
      podstow: [MEMBER],
    });
    expect(new GroupsStore(path, []).config.claudes.get("podstow")?.repo).toBe(
      "o/r",
    );
  });

  it("writes nothing that is not valid, and keeps the live config", () => {
    const path = join(folder(), "groups.json");
    const store = new GroupsStore(path, []);
    store.update(() => ({
      claudes: { podstow: { repo: "o/r", access: "read-only" } },
      groups: { [GROUP]: { claudes: { podstow: { members: [] } } } },
    }));
    const before = readFileSync(path, "utf8");
    expect(() =>
      store.update((file) => ({
        ...file,
        groups: { [GROUP]: { claudes: { podstow: { members: ["Ollie"] } } } },
      })),
    ).toThrow();
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(store.config.groups.get(GROUP)?.members).toEqual({ podstow: [] });
  });

  it("writes a file from before named Claudes back in the new shape", () => {
    const path = join(folder(), "groups.json");
    writeFileSync(
      path,
      JSON.stringify({
        groups: {
          [GROUP]: {
            repo: "o/podstow",
            access: "read-write",
            members: [MEMBER],
          },
        },
      }),
    );
    const store = new GroupsStore(path, []);
    expect(store.config.groups.get(GROUP)?.claudes).toEqual(["podstow"]);
    store.update((file) => file);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      claudes: { podstow: { repo: "o/podstow", access: "read-write" } },
      groups: { [GROUP]: { claudes: { podstow: { members: [MEMBER] } } } },
    });
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
      claude: "podstow",
      cursor: "4",
      waiting: true,
      since: 1,
      nudged: false,
      deliveries: [
        {
          uuid: "u1",
          key: "k",
          ask: null,
          at: 1,
          answered: false,
          interjecting: false,
        },
      ],
      link: { id: "Zk3q9xT0aB4mN7pR2sV5wY8c", given: 1, sent: ["k1"] },
      idle: 2,
      readAt: 4,
    };
    state.state.sentMedia.push(
      ...Array.from({ length: 600 }, (_, index) => `m${String(index)}`),
    );
    state.save();
    const again = new StateStore(path);
    expect(again.state.sessions.abc12345?.cursor).toBe("4");
    expect(again.state.sessions.abc12345?.deliveries[0]?.uuid).toBe("u1");
    expect(again.state.sessions.abc12345?.link?.sent).toEqual(["k1"]);
    expect(again.state.sentMedia).toHaveLength(500);
    expect(again.state.sentMedia.at(-1)).toBe("m599");
  });

  it("reads a session saved before sessions were mailboxes", () => {
    const path = join(folder(), "state.json");
    writeFileSync(
      path,
      JSON.stringify({
        sessions: {
          abc12345: {
            chat: GROUP,
            claude: "podstow",
            request: { id: "r1", sender: OWNER, content: "hi" },
            cursor: "4",
            waiting: true,
            since: 1,
            outbox: null,
          },
        },
      }),
    );
    // The request it waits on becomes a delivery, which takes the next result.
    expect(new StateStore(path).state.sessions.abc12345?.deliveries).toEqual([
      {
        uuid: null,
        key: "",
        ask: { id: "r1", sender: OWNER, content: "hi" },
        at: 1,
        answered: false,
        interjecting: false,
      },
    ]);
  });

  it("reads a session saved before links, whose deliveries had upload folders (#59)", () => {
    const path = join(folder(), "state.json");
    writeFileSync(
      path,
      JSON.stringify({
        sessions: {
          abc12345: {
            chat: GROUP,
            claude: "podstow",
            cursor: "4",
            waiting: true,
            since: 1,
            deliveries: [
              {
                uuid: "u1",
                key: "k",
                at: 1,
                answered: true,
                folder: "outgoing/old/",
                sent: ["outgoing/old/a.png"],
              },
            ],
          },
        },
      }),
    );
    const session = new StateStore(path).state.sessions.abc12345;
    expect(session?.deliveries).toEqual([
      {
        uuid: "u1",
        key: "k",
        ask: null,
        at: 1,
        answered: true,
        interjecting: false,
      },
    ]);
    // It gets a link with its next delivery.
    expect(session?.link).toBeNull();
  });
});
