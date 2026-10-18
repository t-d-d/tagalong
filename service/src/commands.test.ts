import { describe, expect, it } from "vitest";
import { ClaudeApi } from "./claude-api.ts";
import { COMMAND, commandIn, setupEntry, tokens } from "./commands.ts";
import type { Group } from "./groups.ts";

const self = new Set(["447700900100", "120363000000100"]);
// Never reached: these tests give environments by id.
const api = new ClaudeApi(
  "http://127.0.0.1:1",
  () => "token",
  () => undefined,
);

describe("commandIn", () => {
  it("reads a verb addressed to Claude by name or by mention", () => {
    expect(commandIn("@claude setup owner/repo read-write", self)).toEqual({
      verb: "setup",
      args: "owner/repo read-write",
    });
    expect(commandIn("@447700900100 status", self)).toEqual({
      verb: "status",
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
  });

  it("ignores a verb addressed to someone else, or not at the start", () => {
    expect(commandIn("@447700900002 setup owner/repo", self)).toBeNull();
    expect(commandIn("can you @claude setup this", self)).toBeNull();
    expect(commandIn("@claude set up the repo", self)).toBeNull();
    expect(commandIn("@claude statusline is broken", self)).toBeNull();
  });

  it("calls a command-shaped message a command for any sender (the prompt leaves them out)", () => {
    expect(COMMAND.test("@447700900002 stop")).toBe(true);
    expect(COMMAND.test("hello @claude")).toBe(false);
  });
});

describe("tokens", () => {
  it("keeps a quoted name whole", () => {
    expect(tokens('o/r read-write env="Podcast tools" ref=dev')).toEqual([
      "o/r",
      "read-write",
      "env=Podcast tools",
      "ref=dev",
    ]);
  });
});

describe("setupEntry", () => {
  const current: Group = {
    jid: "120363000000000001@g.us",
    label: "Side projects",
    repo: "o/old",
    environment: "env_fake1",
    access: "read-write",
    ref: "main",
    model: undefined,
    members: ["447700900002"],
  };

  it("starts read-only on main, with the default environment", async () => {
    const entry = await setupEntry(
      "o/r",
      undefined,
      "Group",
      [],
      "env_fakedefault",
      api,
    );
    expect(entry).toEqual({
      label: "Group",
      repo: "o/r",
      environment: "env_fakedefault",
      access: "read-only",
      ref: "main",
      members: [],
    });
  });

  it("changes only what the command names, and adds people", async () => {
    const entry = await setupEntry(
      "read-only ref=dev env_fake2 model=opus",
      current,
      "Side projects",
      ["447700900003"],
      undefined,
      api,
    );
    expect(entry).toEqual({
      label: "Side projects",
      repo: "o/old",
      environment: "env_fake2",
      access: "read-only",
      ref: "dev",
      model: "opus",
      members: ["447700900002", "447700900003"],
    });
  });

  it("asks for a repo when there is none", async () => {
    await expect(
      setupEntry("read-write", undefined, "Group", [], undefined, api),
    ).rejects.toThrow("Which repo?");
  });
});
