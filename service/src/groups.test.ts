import { describe, expect, it } from "vitest";
import {
  claudesOf,
  nameFor,
  parseFile,
  parseOwners,
  toConfig,
  withoutGroup,
} from "./groups.ts";

const GROUP = "120363000000000001@g.us";
const DIRECT = "447700900001@s.whatsapp.net";

describe("groups.json", () => {
  it("defines Claudes once and lists them per chat", () => {
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
            claudes: ["podstow", "brainstorm", "gone"],
            members: ["447700900002"],
          },
          [DIRECT]: { claudes: ["podstow"] },
          "120363000000000002@g.us": { claudes: [] },
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
    });
    const group = config.groups.get(GROUP);
    expect(group?.claudes).toEqual(["podstow", "brainstorm"]);
    expect(
      group === undefined
        ? []
        : claudesOf(config, group).map((claude) => claude.repo),
    ).toEqual(["o/podstow", "o/kickoff"]);
    expect(config.groups.has(DIRECT)).toBe(true);
    // A chat whose Claudes were all removed is ignored, but kept in the file.
    expect(config.groups.has("120363000000000002@g.us")).toBe(false);
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
        claudes: ["podstow"],
        members: ["447700900002"],
      },
      "120363000000000002@g.us": { claudes: ["spotimy"] },
      "120363000000000003@g.us": { claudes: ["podstow"] },
      "120363000000000004@g.us": { claudes: ["podstow-2"] },
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
      parseFile({ groups: { "someone@example.com": { claudes: [] } } }),
    ).toThrow("must be a chat JID");
    expect(() =>
      parseFile({ groups: { [GROUP]: { claudes: [], members: ["Ollie"] } } }),
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
      withoutGroup({ groups: { [GROUP]: { claudes: ["podstow"] } } }, GROUP),
    ).toEqual({ groups: {} });
  });
});
