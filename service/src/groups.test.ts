import { describe, expect, it } from "vitest";
import {
  claudesOf,
  nameFor,
  openTo,
  parseFile,
  parseOwners,
  toConfig,
  withoutGroup,
} from "./groups.ts";

const GROUP = "120363000000000001@g.us";
const DIRECT = "447700900001@s.whatsapp.net";

describe("groups.json", () => {
  it("defines Claudes once, and lists them per chat with who may ask each", () => {
    const config = toConfig(
      parseFile({
        owners: ["447700900001"],
        claudes: {
          podstow: {
            repo: "o/podstow",
            access: "read-write",
            environment: "env_fake1",
          },
          brainstorm: { repo: "o/kickoff", access: "read-only" },
        },
        groups: {
          [GROUP]: {
            label: "Side projects",
            claudes: {
              podstow: { members: ["447700900002"] },
              brainstorm: { everyone: true, listening: true },
              gone: {},
            },
          },
          [DIRECT]: { claudes: { podstow: {} } },
          "120363000000000002@g.us": { claudes: {} },
        },
      }),
      ["447700900009"],
    );
    expect(config.owners).toEqual(["447700900009", "447700900001"]);
    expect(config.claudes.get("brainstorm")).toEqual({
      name: "brainstorm",
      repo: "o/kickoff",
      environment: undefined,
      access: "read-only",
      ref: "main",
      model: undefined,
      role: undefined,
    });
    const group = config.groups.get(GROUP);
    if (group === undefined) throw new Error("no group");
    expect(group.claudes).toEqual(["podstow", "brainstorm"]);
    expect(group.members).toEqual({
      podstow: ["447700900002"],
      brainstorm: [],
    });
    expect(claudesOf(config, group).map((claude) => claude.repo)).toEqual([
      "o/podstow",
      "o/kickoff",
    ]);
    expect(openTo(config, group, "brainstorm")).toBe(true);
    // Listening is off unless an owner turned it on.
    expect(group.listening).toEqual(["brainstorm"]);
    expect(openTo(config, group, "podstow")).toBe(false);
    expect(config.groups.get(DIRECT)?.label).toBe("direct chat");
    // A chat whose Claudes were all removed is ignored.
    expect(config.groups.has("120363000000000002@g.us")).toBe(false);
  });

  it("never opens a read-write Claude to everyone, whatever the file says", () => {
    const config = toConfig(
      parseFile({
        claudes: { podstow: { repo: "o/podstow", access: "read-write" } },
        groups: { [GROUP]: { claudes: { podstow: { everyone: true } } } },
      }),
      [],
    );
    const group = config.groups.get(GROUP);
    expect(group === undefined ? true : openTo(config, group, "podstow")).toBe(
      false,
    );
  });

  it("turns a group from before named Claudes into a Claude named after its repo", () => {
    const file = parseFile({
      groups: {
        [GROUP]: {
          label: "Podstow etc",
          repo: "podstow/podstow",
          environment: "env_fake1",
          access: "read-write",
          members: ["447700900002"],
        },
        "120363000000000002@g.us": {
          repo: "t-d-d/spotimy",
          access: "read-only",
          ref: "main",
        },
        "120363000000000003@g.us": {
          repo: "podstow/podstow",
          environment: "env_fake1",
          access: "read-write",
        },
        "120363000000000004@g.us": {
          repo: "other/podstow",
          access: "read-only",
        },
      },
    });
    expect(file.claudes).toEqual({
      podstow: {
        repo: "podstow/podstow",
        environment: "env_fake1",
        access: "read-write",
      },
      spotimy: { repo: "t-d-d/spotimy", access: "read-only", ref: "main" },
      "podstow-2": { repo: "other/podstow", access: "read-only" },
    });
    expect(file.groups).toEqual({
      [GROUP]: {
        label: "Podstow etc",
        claudes: { podstow: { members: ["447700900002"] } },
      },
      "120363000000000002@g.us": { claudes: { spotimy: { members: [] } } },
      "120363000000000003@g.us": { claudes: { podstow: { members: [] } } },
      "120363000000000004@g.us": { claudes: { "podstow-2": { members: [] } } },
    });
  });

  it("says which field is wrong", () => {
    expect(() =>
      parseFile({
        claudes: { podstow: { repo: "nope", access: "read-only" } },
      }),
    ).toThrow(/"claudes.podstow.repo" must be owner\/name/u);
    expect(() =>
      parseFile({ claudes: { claude: { repo: "o/r", access: "read-only" } } }),
    ).toThrow('not "claude"');
    expect(() =>
      parseFile({
        claudes: { "Big Name": { repo: "o/r", access: "read-only" } },
      }),
    ).toThrow("lowercase");
    expect(() =>
      parseFile({ groups: { "someone@example.com": { claudes: {} } } }),
    ).toThrow("must be a chat JID");
    expect(() =>
      parseFile({
        groups: { [GROUP]: { claudes: { podstow: { members: ["Ollie"] } } } },
      }),
    ).toThrow("phone number");
  });

  it("names a Claude after a repo, uniquely", () => {
    expect(nameFor("podstow/podstow", () => false)).toBe("podstow");
    expect(nameFor("t-d-d/My_App", () => false)).toBe("my-app");
    expect(nameFor("o/r", () => false)).toBe("c-r");
    expect(
      nameFor(
        "o/podstow",
        (name) => name === "podstow" || name === "podstow-2",
      ),
    ).toBe("podstow-3");
  });

  it("takes owners from the variable, with or without a plus", () => {
    expect(parseOwners(" +447700900001, 447700900002 ,")).toEqual([
      "447700900001",
      "447700900002",
    ]);
    expect(parseOwners("")).toEqual([]);
    expect(() => parseOwners("Thomas")).toThrow();
  });

  it("drops one chat", () => {
    expect(
      withoutGroup(
        { groups: { [GROUP]: { claudes: { podstow: { members: [] } } } } },
        GROUP,
      ),
    ).toEqual({ groups: {} });
  });
});
