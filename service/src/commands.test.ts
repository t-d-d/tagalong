import { describe, expect, it } from "vitest";
import { ClaudeApi } from "./claude-api.ts";
import { COMMAND, commandIn, defineEntry, tokens } from "./commands.ts";
import type { Claude } from "./groups.ts";

const self = new Set(["447700900100", "120363000000100"]);
// Never reached: these tests name no environment, which is looked up.
const api = new ClaudeApi(
  "http://127.0.0.1:1",
  () => "token",
  () => undefined,
);

describe("commandIn", () => {
  it("reads a verb addressed to @claude or the number", () => {
    expect(commandIn("@claude define critic o/r read-only", self)).toEqual({
      verb: "define",
      args: "critic o/r read-only",
    });
    expect(commandIn("@claude undefine critic", self)).toEqual({
      verb: "undefine",
      args: "critic",
    });
    expect(commandIn("@447700900100 who", self)).toEqual({
      verb: "who",
      args: "",
    });
    expect(commandIn("  @Claude, HELP", self)).toEqual({
      verb: "help",
      args: "",
    });
    expect(commandIn("@120363000000100: allow @447700900002", self)).toEqual({
      verb: "allow",
      args: "@447700900002",
    });
    expect(commandIn("@claude add podstow brainstorm", self)).toEqual({
      verb: "add",
      args: "podstow brainstorm",
    });
  });

  it("reads interject as a verb", () => {
    expect(commandIn("@claude interject brainstorm on", self)).toEqual({
      verb: "interject",
      args: "brainstorm on",
    });
    expect(COMMAND.test("@claude interject brainstorm off")).toBe(true);
  });

  it("reads set as a verb", () => {
    expect(commandIn("@claude set interjecting read-only", self)).toEqual({
      verb: "set",
      args: "interjecting read-only",
    });
    expect(commandIn("@claude settings", self)).toBeNull();
  });

  it("ignores a verb addressed to someone else, or not at the start", () => {
    expect(commandIn("@447700900002 add podstow", self)).toBeNull();
    expect(commandIn("can you @claude add this", self)).toBeNull();
    expect(commandIn("@claude addition please", self)).toBeNull();
    expect(commandIn("@podstow help me", self)).toBeNull();
  });

  it("calls a command-shaped message a command for any sender (the prompt leaves them out)", () => {
    expect(COMMAND.test("@447700900002 stop")).toBe(true);
    expect(COMMAND.test("hello @claude")).toBe(false);
  });
});

describe("tokens", () => {
  it("keeps a quoted name whole", () => {
    expect(tokens('critic o/r read-write env="Podcast tools" ref=dev')).toEqual(
      ["critic", "o/r", "read-write", "env=Podcast tools", "ref=dev"],
    );
  });
});

describe("defineEntry", () => {
  const current: Claude = {
    name: "podstow",
    repo: "o/old",
    environment: "env_fake1",
    access: "read-write",
    ref: "main",
    model: undefined,
    role: undefined,
  };

  it("starts read-only on main, with the default environment", async () => {
    expect(
      await defineEntry("critic o/r", undefined, "env_fakedefault", api),
    ).toEqual({
      repo: "o/r",
      environment: "env_fakedefault",
      access: "read-only",
    });
  });

  it("changes only what the command names", async () => {
    expect(
      await defineEntry(
        "podstow read-only ref=dev model=opus",
        current,
        undefined,
        api,
      ),
    ).toEqual({
      repo: "o/old",
      environment: "env_fake1",
      access: "read-only",
      ref: "dev",
      model: "opus",
    });
  });

  it("takes a role in quotes, straight or curly, and clears it when empty", async () => {
    expect(
      await defineEntry(
        "ops o/podstow read-only role=\u201cYou are Podstow's ops operator. Use the ops-tooling skill.\u201d",
        undefined,
        undefined,
        api,
      ),
    ).toEqual({
      repo: "o/podstow",
      access: "read-only",
      role: "You are Podstow's ops operator. Use the ops-tooling skill.",
    });
    const ops = { ...current, name: "ops", role: "Old role." };
    expect(
      (await defineEntry('ops role=""', ops, undefined, api)).role,
    ).toBeUndefined();
    expect((await defineEntry("ops read-only", ops, undefined, api)).role).toBe(
      "Old role.",
    );
  });

  it("asks for a repo when there is none", async () => {
    await expect(
      defineEntry("critic read-write", undefined, undefined, api),
    ).rejects.toThrow("Which repo?");
  });
});
