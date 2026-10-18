import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Harness, NOW, harness } from "../../test/app-harness.ts";
import {
  CLAUDE,
  CLAUDE_LID,
  GROUP,
  MEMBER,
  OTHER_GROUP,
  OWNER,
  OWNER_LID,
  STRANGER,
} from "../../test/bridge-db.ts";
import { assistant, result } from "../../test/fake-claude-api.ts";
import { eventsOf } from "../../test/log-lines.ts";

const SESSION = "01SessionAaaaaaaaaaaaaaa";
const SECOND = "01SessionBbbbbbbbbbbbbbb";

// Numbers, names and every message a test sends. None may reach a log line (logging.md).
const PEOPLE = [
  OWNER,
  MEMBER,
  STRANGER,
  CLAUDE,
  CLAUDE_LID,
  OWNER_LID,
  "Thomas",
  "Ollie",
  "Sam",
];
let spoken: string[] = [];

let h: Harness | undefined;
afterEach(async () => {
  if (h === undefined) return;
  const words = [
    ...PEOPLE,
    ...spoken.filter((text) => text.length >= 10),
    "the CI broke again",
    "secret plan",
    "ship on Friday",
  ];
  const leaked = h.raw.filter((line) =>
    words.some((word) => line.includes(word)),
  );
  await h.close();
  h = undefined;
  spoken = [];
  expect(leaked).toEqual([]);
});

/** A message from `sender`, stored as the bridge stores it, then delivered. */
async function says(
  t: Harness,
  id: string,
  sender: string,
  content: string,
  extra: Record<string, unknown> = {},
) {
  spoken.push(content.replace(/^@claude /u, ""));
  const chat = typeof extra.chatJID === "string" ? extra.chatJID : GROUP;
  const at = typeof extra.at === "number" ? extra.at : t.clock.now;
  t.db.message({
    id,
    chat,
    sender,
    content,
    at,
    ...(typeof extra.mediaType === "string"
      ? { mediaType: extra.mediaType }
      : {}),
  });
  const fields = Object.fromEntries(
    Object.entries(extra).filter(([key]) => key !== "at"),
  );
  await t.deliver({ messageId: id, sender, content, ...fields });
}

function started(t: Harness, id: string, events: unknown[] = []) {
  t.api.sessions.set(id, {
    status: "running",
    environmentId: "env_fake1",
    events,
  });
}

describe("a request in a group that is set up", () => {
  it("starts a session in the group's repo and environment, then posts its answer", async () => {
    const t = (h = await harness({
      db: (db) =>
        db.message({
          id: "old",
          sender: MEMBER,
          content: "the CI broke again",
          at: NOW - 60_000,
        }),
    }));
    t.fake.launches.push(SESSION);
    started(t, SESSION);
    await says(t, "r1", MEMBER, "@claude why is the build red?");

    expect(t.bridge.reactions).toEqual([
      expect.objectContaining({ message_id: "r1", emoji: "👀" }),
    ]);
    const [launch] = t.fake.calls;
    expect(launch?.prompt).toContain(
      "Request from Ollie:\n@claude why is the build red?",
    );
    expect(launch?.prompt).toContain("Ollie: the CI broke again");
    expect(launch?.prompt).toContain("You are working in o/r");
    expect(launch?.options.env).toMatchObject({
      CLAUDE_PERMISSION_MODE: "auto",
      CLAUDE_REF: "main",
      CLAUDE_SESSION_NAME: "WhatsApp: why is the build red?",
    });
    const cwd = launch?.options.cwd ?? "";
    expect(
      JSON.parse(
        readFileSync(join(cwd, ".claude", "settings.local.json"), "utf8"),
      ),
    ).toEqual({ remote: { defaultEnvironmentId: "env_fake1" } });
    expect(
      execFileSync("git", ["remote", "get-url", "origin"], {
        cwd,
        encoding: "utf8",
      }).trim(),
    ).toBe("https://github.com/o/r.git");
    expect(eventsOf(t.lines)).toContain("session-started");

    t.api.sessions.set(SESSION, {
      status: "idle",
      environmentId: "env_fake1",
      events: [
        assistant("Looking now."),
        result("The **build** fails on lint."),
      ],
    });
    await t.app.pollOnce();
    expect(t.bridge.sent).toEqual([
      {
        recipient: GROUP,
        message: `The *build* fails on lint.\n\n↗ claude.ai/code/session_${SESSION}`,
        quoted_message_id: "r1",
      },
    ]);
    await t.app.pollOnce();
    expect(t.bridge.sent).toHaveLength(1);
  });

  it("carries a reply to Claude on in the session it came from", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION);
    started(t, SESSION, [result("It fails on lint.")]);
    await says(t, "r1", MEMBER, "@claude why is the build red?");
    await t.app.pollOnce();

    await says(t, "r2", MEMBER, "can you fix it?", {
      quotedIsFromMe: true,
      quotedMessageId: "a1",
      quotedContent: `It fails on lint.\n\n↗ claude.ai/code/session_${SESSION}`,
    });
    const followUp = t.fake.calls.find(
      (call) => call.command === t.env.CLAUDE_BIN,
    );
    expect(followUp?.args).toEqual([
      "-p",
      "--cloud",
      `session_${SESSION}`,
      "--output-format",
      "json",
    ]);
    expect(followUp?.options.input).toBe(
      "Ollie on WhatsApp:\ncan you fix it?\n",
    );
    expect(eventsOf(t.lines)).toContain("session-followup");

    t.api.sessions.get(SESSION)?.events.push(result("Opened a PR."));
    await t.app.pollOnce();
    expect(t.bridge.sent.at(-1)?.message).toContain("Opened a PR.");
    expect(t.bridge.sent.at(-1)?.quoted_message_id).toBe("r2");
  });

  it("starts a fresh session when the one replied to is archived", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION, SECOND);
    started(t, SESSION, [result("Done.")]);
    started(t, SECOND);
    await says(t, "r1", MEMBER, "@claude tidy the README");
    await t.app.pollOnce();
    t.fake.followUps.set(SESSION, "archived");
    await says(t, "r2", MEMBER, "and the docs?", {
      quotedIsFromMe: true,
      quotedContent: `Done.\n\n↗ claude.ai/code/session_${SESSION}`,
    });
    expect(eventsOf(t.lines)).toEqual(
      expect.arrayContaining(["session-gone", "session-started"]),
    );
    expect(
      t.fake.calls.filter((call) => call.command === t.env.PYTHON),
    ).toHaveLength(2);
  });

  it("answers the same message once, however often the bridge sends it", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION, SECOND);
    started(t, SESSION);
    await says(t, "r1", MEMBER, "@claude hello");
    await t.deliver({
      messageId: "r1",
      sender: MEMBER,
      content: "@claude hello",
    });
    expect(t.fake.calls).toHaveLength(1);
  });

  it("gives a session only what members said, and leaves commands out", async () => {
    const t = (h = await harness({
      db: (db) =>
        db
          .message({
            id: "s1",
            sender: STRANGER,
            content: "the secret plan is here",
            at: NOW - 3000,
          })
          .message({
            id: "c1",
            sender: OWNER,
            content: "@claude status",
            at: NOW - 2000,
          })
          .message({
            id: "o1",
            sender: OWNER,
            content: "we ship on Friday",
            at: NOW - 1000,
          }),
    }));
    t.fake.launches.push(SESSION);
    started(t, SESSION);
    await says(t, "r1", MEMBER, "@claude what's the plan?");
    const prompt = t.fake.calls[0]?.prompt ?? "";
    expect(prompt).toContain("Thomas: we ship on Friday");
    expect(prompt).not.toContain("secret plan");
    expect(prompt).not.toContain("@claude status");
  });

  it("passes on recent photos from members as short-lived links, and nobody else's", async () => {
    const t = (h = await harness({ env: { ATTACHMENTS_BUCKET: "files" } }));
    t.bridge.media.set("p1", {
      filename: "screen shot.png",
      bytes: Buffer.from("png bytes"),
    });
    t.bridge.media.set("p2", {
      filename: "theirs.png",
      bytes: Buffer.from("png"),
    });
    t.db.message({
      id: "p1",
      sender: MEMBER,
      content: "",
      at: NOW - 60_000,
      mediaType: "image",
    });
    t.db.message({
      id: "p2",
      sender: STRANGER,
      content: "",
      at: NOW - 30_000,
      mediaType: "image",
    });
    t.fake.launches.push(SESSION);
    started(t, SESSION);
    await says(t, "r1", MEMBER, "@claude what's wrong in this screenshot?");
    const prompt = t.fake.calls[0]?.prompt ?? "";
    expect(prompt).toMatch(
      /- screen_shot\.png \(image\/png, 1 KB\): https:\/\/files\.s3\.example\.test\/attachments\/[\w-]+\/screen_shot\.png\?expires=3600/u,
    );
    expect(prompt).not.toContain("theirs.png");
    expect([...t.aws.objects.keys()]).toEqual([
      expect.stringMatching(/^files\/attachments\/[\w-]+\/screen_shot\.png$/u),
    ]);
    expect(t.stateFile()).toMatchObject({ sentMedia: ["p1"] });
  });

  it("starts nothing in a dry run", async () => {
    const t = (h = await harness({ env: { DRY_RUN: "1" } }));
    await says(t, "r1", MEMBER, "@claude hello");
    expect(t.fake.calls).toEqual([]);
    expect(t.bridge.reactions).toEqual([]);
  });

  it("holds requests past the hourly cap", async () => {
    const t = (h = await harness({ env: { MAX_PER_HOUR: "1" } }));
    t.fake.launches.push(SESSION, SECOND);
    started(t, SESSION);
    await says(t, "r1", MEMBER, "@claude one");
    await says(t, "r2", MEMBER, "@claude two");
    expect(t.bridge.reactions.map((reaction) => reaction.emoji)).toEqual([
      "👀",
      "⏳",
    ]);
    t.clock.now += 3_600_001;
    started(t, SECOND);
    await says(t, "r3", MEMBER, "@claude three");
    expect(
      t.fake.calls.filter((call) => call.command === t.env.PYTHON),
    ).toHaveLength(2);
  });

  it("marks a request it could not start, and says so at error level", async () => {
    const t = (h = await harness());
    await says(t, "r1", MEMBER, "@claude hello");
    expect(t.bridge.reactions.map((reaction) => reaction.emoji)).toEqual([
      "👀",
      "⚠️",
    ]);
    expect(t.lines).toContainEqual(
      expect.objectContaining({
        level: "error",
        event: "request-failed",
        why: "the launcher exited 1 without a session (unknown)",
      }),
    );
  });
});

describe("who is answered", () => {
  it("ignores someone the owner has not added", async () => {
    const t = (h = await harness());
    await says(t, "r1", STRANGER, "@claude hello");
    expect(t.fake.calls).toEqual([]);
    expect(t.bridge.reactions).toEqual([]);
    expect(t.lines).toContainEqual(
      expect.objectContaining({
        event: "request-ignored",
        why: "not-a-member",
      }),
    );
  });

  it("says nothing at all about a group that is not set up", async () => {
    const t = (h = await harness());
    await says(t, "x1", OWNER, "@claude hello", { chatJID: OTHER_GROUP });
    expect(t.fake.calls).toEqual([]);
    expect(t.bridge.reactions).toEqual([]);
    expect(t.lines).toEqual([]);
  });

  it("answers an owner who writes from their LID", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION);
    started(t, SESSION);
    await says(t, "r1", OWNER_LID, "@claude hello");
    expect(t.fake.calls).toHaveLength(1);
  });
});

describe("commands", () => {
  it("lets an owner set a group up, add and remove people, and stop", async () => {
    const t = (h = await harness());
    await says(t, "c1", OWNER, '@claude setup o/other read-only env="spare"', {
      chatJID: OTHER_GROUP,
    });
    expect(t.groupsFile().groups?.[OTHER_GROUP]).toEqual({
      label: "Family",
      repo: "o/other",
      environment: "env_fake2",
      access: "read-only",
      ref: "main",
      members: [],
    });
    expect(t.bridge.sent.at(-1)).toMatchObject({
      recipient: OTHER_GROUP,
      quoted_message_id: "c1",
    });
    expect(t.bridge.sent.at(-1)?.message).toContain(
      "Set up.\n*o/other* (read-only)\nEnvironment: spare (env_fake2)",
    );

    await says(t, "c2", OWNER, `@claude allow @${MEMBER}`, {
      chatJID: OTHER_GROUP,
      mentionedJids: [`${MEMBER}@s.whatsapp.net`],
    });
    expect(t.groupsFile().groups?.[OTHER_GROUP]?.members).toEqual([MEMBER]);
    expect(t.bridge.sent.at(-1)?.message).toContain(
      "Answers @claude from: Thomas, Ollie",
    );

    await says(t, "c3", OWNER, "@claude revoke +447700900002", {
      chatJID: OTHER_GROUP,
    });
    expect(t.groupsFile().groups?.[OTHER_GROUP]?.members).toEqual([]);

    await says(t, "c4", OWNER, "@claude stop", { chatJID: OTHER_GROUP });
    expect(t.groupsFile().groups?.[OTHER_GROUP]).toBeUndefined();
    expect(t.app.parts.groups.config.groups.has(OTHER_GROUP)).toBe(false);
  });

  it("refuses an environment it cannot find, and changes nothing", async () => {
    const t = (h = await harness());
    await says(t, "c1", OWNER, "@claude setup o/other env=nowhere", {
      chatJID: OTHER_GROUP,
    });
    expect(t.groupsFile().groups?.[OTHER_GROUP]).toBeUndefined();
    expect(t.bridge.sent.at(-1)?.message).toBe(
      'Couldn\'t do that: no environment called "nowhere". Yours: Default Full, spare',
    );
  });

  it("sends help as an intro and messages to copy", async () => {
    const t = (h = await harness());
    await says(t, "c1", OWNER, "@claude help");
    expect(t.bridge.sent.map((sent) => sent.message.split("\n")[0])).toEqual([
      "Set up here:",
      '@claude setup o/r read-write env="Default Full"',
      "@claude allow @",
      "@claude revoke @",
      "@claude status",
      "@claude stop",
    ]);
  });

  it("ignores a command from anyone but an owner, and never treats it as a request", async () => {
    const t = (h = await harness());
    await says(t, "c1", MEMBER, "@claude setup o/r read-write");
    await says(t, "c2", STRANGER, "@claude stop");
    expect(t.groupsFile()).toEqual(
      (await import("../../test/app-harness.ts")).standardGroups,
    );
    expect(t.fake.calls).toEqual([]);
    expect(t.bridge.sent).toEqual([]);
    expect(
      t.lines.filter((line) => line.event === "command-ignored"),
    ).toHaveLength(2);
  });

  it("ignores an owner's command typed more than ten minutes ago", async () => {
    const t = (h = await harness());
    await says(t, "c1", OWNER, "@claude stop", { at: NOW - 11 * 60_000 });
    expect(t.groupsFile().groups?.[GROUP]).toBeDefined();
    expect(t.bridge.sent).toEqual([]);
  });

  it("ignores its own messages, such as the help it sent", async () => {
    const t = (h = await harness());
    await says(t, "c1", CLAUDE, "@claude stop", { isFromMe: true });
    expect(t.groupsFile().groups?.[GROUP]).toBeDefined();
  });
});

describe("waiting on a session", () => {
  it("says once when the session waits for an approval, and gives up in the end", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION);
    started(t, SESSION);
    await says(t, "r1", MEMBER, "@claude deploy it");
    t.api.sessions.set(SESSION, {
      status: "requires_action",
      environmentId: "env_fake1",
      events: [],
    });
    await t.app.pollOnce();
    await t.app.pollOnce();
    expect(t.bridge.sent.map((sent) => sent.message)).toEqual([
      `Claude is waiting for an approval in the session.\n\n↗ claude.ai/code/session_${SESSION}`,
    ]);
    t.clock.now += t.env.GIVE_UP_MS + 1;
    await t.app.pollOnce();
    expect(t.bridge.sent.at(-1)?.message).toMatch(
      /^No reply from Claude after 120 minutes/u,
    );
    await t.app.pollOnce();
    expect(t.bridge.sent).toHaveLength(2);
  });

  it("reports a session that ended in an error", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION);
    started(t, SESSION, [
      { type: "result", subtype: "error_max_turns", is_error: true },
    ]);
    await says(t, "r1", MEMBER, "@claude go");
    await t.app.pollOnce();
    expect(t.bridge.sent.at(-1)?.message).toContain(
      "⚠️ The session stopped with an error (error_max_turns).",
    );
  });

  it("posts a turn's last words when it ended with no result", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION);
    started(t, SESSION, [assistant("Half an answer.")]);
    await says(t, "r1", MEMBER, "@claude go");
    await t.app.pollOnce();
    expect(t.bridge.sent).toEqual([]);
    const session = t.api.sessions.get(SESSION);
    if (session !== undefined) session.status = "idle";
    await t.app.pollOnce();
    expect(t.bridge.sent.at(-1)?.message).toContain("Half an answer.");
  });

  it("stops watching sessions of a group that was stopped", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION);
    started(t, SESSION);
    await says(t, "r1", MEMBER, "@claude go");
    await says(t, "c1", OWNER, "@claude stop");
    const sent = t.bridge.sent.length;
    t.api.sessions.get(SESSION)?.events.push(result("late"));
    await t.app.pollOnce();
    expect(t.bridge.sent).toHaveLength(sent);
  });
});

describe("the heartbeat", () => {
  it("says whether the bridge is connected", async () => {
    const t = (h = await harness());
    expect(await t.app.heartbeat()).toBe("connected");
    t.bridge.connected = false;
    expect(await t.app.heartbeat()).toBe("disconnected");
    expect(
      t.lines
        .filter((line) => line.event === "heartbeat")
        .map((line) => line.bridge),
    ).toEqual(["connected", "disconnected"]);
  });
});

describe("starting", () => {
  it("listens on loopback, and says the workspaces are not trusted yet", async () => {
    const free = await new Promise<number>((resolve) => {
      const probe = createServer();
      probe.listen(0, "127.0.0.1", () => {
        const address = probe.address();
        probe.close(() => {
          resolve(
            typeof address === "object" && address !== null ? address.port : 0,
          );
        });
      });
    });
    const t = (h = await harness({ env: { PORT: String(free) } }));
    const server = await t.app.start();
    try {
      expect(t.lines).toContainEqual(
        expect.objectContaining({
          event: "started",
          device: "present",
          groups: 1,
          owners: 1,
        }),
      );
      expect(t.lines).toContainEqual(
        expect.objectContaining({
          level: "warn",
          event: "workspace-untrusted",
        }),
      );
      expect(
        await (await fetch(`http://127.0.0.1:${String(free)}/healthz`)).text(),
      ).toBe("ok");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
