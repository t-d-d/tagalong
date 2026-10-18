import { describe, expect, it } from "vitest";
import {
  checkEntry,
  parseFile,
  parseOwners,
  toConfig,
  withoutGroup,
} from "./groups.ts";

const GROUP = "120363000000000001@g.us";

describe("groups.json", () => {
  it("fills in what an entry leaves out", () => {
    const config = toConfig(
      parseFile({
        owners: ["447700900001"],
        groups: { [GROUP]: { repo: "o/r", access: "read-only" } },
      }),
      ["447700900009"],
    );
    expect(config.owners).toEqual(["447700900009", "447700900001"]);
    expect(config.groups.get(GROUP)).toEqual({
      jid: GROUP,
      label: GROUP,
      repo: "o/r",
      environment: undefined,
      access: "read-only",
      ref: "main",
      model: undefined,
      members: [],
    });
  });

  it("says which field is wrong", () => {
    expect(() =>
      parseFile({ groups: { [GROUP]: { repo: "nope", access: "read-only" } } }),
    ).toThrow(/"groups.*repo" must be owner\/name/u);
    expect(() =>
      parseFile({
        groups: {
          "447700900001@s.whatsapp.net": { repo: "o/r", access: "read-only" },
        },
      }),
    ).toThrow("must be a group JID");
    expect(() => {
      checkEntry(GROUP, {
        repo: "o/r",
        access: "read-only",
        members: ["Ollie"],
      });
    }).toThrow("phone number");
    expect(() => {
      checkEntry(GROUP, {
        repo: "o/r",
        access: "read-only",
        environment: "prod",
      });
    }).toThrow("env_");
  });

  it("takes owners from the variable, with or without a plus", () => {
    expect(parseOwners(" +447700900001, 447700900002 ,")).toEqual([
      "447700900001",
      "447700900002",
    ]);
    expect(parseOwners("")).toEqual([]);
    expect(() => parseOwners("Thomas")).toThrow();
  });

  it("drops one group", () => {
    const file = {
      groups: { [GROUP]: { repo: "o/r", access: "read-only" as const } },
    };
    expect(withoutGroup(file, GROUP)).toEqual({ groups: {} });
  });
});
