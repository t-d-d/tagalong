import { describe, expect, it } from "vitest";
import type { Group } from "./groups.ts";
import { filesSection, firstPrompt, followUp } from "./prompts.ts";

const group = (access: Group["access"]): Group => ({
  jid: "120363000000000001@g.us",
  label: "Side projects",
  repo: "o/r",
  environment: undefined,
  access,
  ref: "main",
  model: undefined,
  members: [],
});
const file = {
  name: "photo.jpg",
  type: "image/jpeg",
  bytes: 2048,
  url: "https://bucket.test/k?sig",
};

describe("prompts", () => {
  it("tells a read-only session not to change anything", () => {
    const prompt = firstPrompt({
      group: group("read-only"),
      chatName: "Side projects",
      from: "Ollie",
      text: "why?",
      transcript: "",
      files: [],
    });
    expect(prompt).toContain("read-only");
    expect(prompt).toContain("Do not edit files");
    expect(prompt).toContain("working in o/r");
  });

  it("tells a read-write session to open a PR", () => {
    const prompt = firstPrompt({
      group: group("read-write"),
      chatName: "Side projects",
      from: "Ollie",
      text: "fix it",
      transcript: "[10-18 17:55] Ollie: it broke",
      files: [file],
    });
    expect(prompt).toContain("open a PR");
    expect(prompt).toContain("[10-18 17:55] Ollie: it broke");
    expect(prompt).toContain(
      "photo.jpg (image/jpeg, 2 KB): https://bucket.test/k?sig",
    );
  });

  it("says nothing about files when there are none", () => {
    expect(filesSection([])).toBe("");
    expect(followUp("Ollie", "and now?", [])).toBe(
      "Ollie on WhatsApp:\nand now?\n",
    );
  });
});
