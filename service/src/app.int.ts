import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type Harness,
  NOW,
  harness,
  standardGroups,
} from "../../test/app-harness.ts";
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
import {
  assistant,
  result,
  selfStarted,
  user,
} from "../../test/fake-claude-api.ts";
import { eventsOf } from "../../test/log-lines.ts";

const SESSION = "01SessionAaaaaaaaaaaaaaa";
const SECOND = "01SessionBbbbbbbbbbbbbbb";
const THIRD = "01SessionCccccccccccccccc";
const DIRECT = `${OWNER}@s.whatsapp.net`;

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

/** A message from `sender`, a second after the last, stored as the bridge stores it, then delivered. */
async function says(
  t: Harness,
  id: string,
  sender: string,
  content: string,
  extra: Record<string, unknown> = {},
) {
  spoken.push(content.replace(/^@\w+ /u, ""));
  t.clock.now += 1000;
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

/** A poll a second later, as the loop would make. */
async function poll(t: Harness) {
  t.clock.now += 1000;
  await t.app.pollOnce();
}

/** A session that, given its first message, answers with `reply`. */
function started(
  t: Harness,
  id: string,
  reply: unknown[] = [],
  environmentId = "env_fake1",
) {
  t.api.sessions.set(id, {
    status: "running",
    environmentId,
    events: [],
    replies: reply.length === 0 ? [] : [reply],
  });
}

/** The folder in the bucket a message's upload form writes to. */
const folderIn = (text: string | undefined): string =>
  /-F 'key=(outgoing\/[\w-]+\/)\$\{filename\}'/u.exec(text ?? "")?.[1] ?? "";

/** Each reaction tagalong sent: the message and the emoji, "" to take one off. */
const reactions = (t: Harness) =>
  t.bridge.reactions.map((reaction) => [reaction.message_id, reaction.emoji]);
const launches = (t: Harness) =>
  t.fake.calls.filter((call) => call.command === t.env.PYTHON);
const followUps = (t: Harness) =>
  t.fake.calls.filter((call) => call.command === t.env.CLAUDE_BIN);

describe("asking a Claude", () => {
  it("starts its session in its repo and environment, then posts its answer under its name", async () => {
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
    await says(t, "r1", MEMBER, "@podstow why is the build red?");

    expect(t.bridge.reactions).toEqual([
      expect.objectContaining({ message_id: "r1", emoji: "👀" }),
    ]);
    const [launch] = launches(t);
    expect(launch?.prompt).toContain(
      'You are "podstow", one of the Claudes in the WhatsApp chat "Side projects"',
    );
    expect(launch?.prompt).toContain("The other Claudes here are @brainstorm");
    expect(launch?.prompt).toContain("Ollie: the CI broke again");
    expect(launch?.prompt).toContain(
      "Ollie asks you, @podstow:\n@podstow why is the build red?",
    );
    expect(launch?.options.env).toMatchObject({
      CLAUDE_PERMISSION_MODE: "auto",
      CLAUDE_REF: "main",
      CLAUDE_SESSION_NAME: "WhatsApp podstow: why is the build red?",
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

    const session = t.api.sessions.get(SESSION);
    if (session !== undefined) session.status = "idle";
    session?.events.push(
      assistant("Looking now."),
      result("The **build** fails on lint."),
    );
    await poll(t);
    expect(t.bridge.sent).toEqual([
      {
        recipient: GROUP,
        message: "*podstow:* The *build* fails on lint.",
        quoted_message_id: "r1",
      },
    ]);
    await poll(t);
    expect(t.bridge.sent).toHaveLength(1);
  });

  it("carries on the same session at the next turn, with what was said since", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION);
    started(t, SESSION, [result("It fails on lint.")]);
    await says(t, "r1", MEMBER, "@podstow why is the build red?");
    await poll(t);
    await says(t, "m1", OWNER, "we ship on Friday");
    await says(t, "s1", STRANGER, "the secret plan");
    await says(t, "r2", MEMBER, "@podstow can you fix it?");

    expect(launches(t)).toHaveLength(1);
    const [next] = followUps(t);
    expect(next?.args).toEqual([
      "-p",
      "--cloud",
      `session_${SESSION}`,
      "--output-format",
      "json",
    ]);
    const input = next?.options.input ?? "";
    expect(input).toMatch(/^Said in the chat since you last heard from it:\n/u);
    expect(input).toContain("podstow (you): It fails on lint.");
    // Each line has a label the Claude can answer it by.
    expect(input).toMatch(/^\[m\d+\] \S+ \S+ Thomas: we ship on Friday$/mu);
    expect(input).not.toContain("secret plan");
    expect(input).toContain(
      "Ollie asks you, @podstow:\n@podstow can you fix it?",
    );
    expect(input.match(/can you fix it/gu)).toHaveLength(1);

    t.api.sessions.get(SESSION)?.events.push(result("Opened a PR."));
    await poll(t);
    expect(t.bridge.sent.at(-1)).toMatchObject({
      message: "*podstow:* Opened a PR.",
      quoted_message_id: "r2",
    });
  });

  it("posts the answer to its own turn, not one someone gave the session elsewhere", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION);
    started(t, SESSION, [result("It fails on lint.")]);
    await says(t, "r1", MEMBER, "@podstow why is the build red?");
    await poll(t);
    // Someone carries on in the session from Claude Desktop.
    t.api.sessions
      .get(SESSION)
      ?.events.push(
        user("carry on from my laptop", "desktop-1"),
        assistant("Working on it."),
        result("Answered on a laptop."),
      );
    await says(t, "r2", MEMBER, "@podstow can you fix it?");
    await poll(t);
    expect(t.bridge.sent.at(-1)?.message).toBe("*podstow:* It fails on lint.");
    expect(t.lines).toContainEqual(
      expect.objectContaining({ event: "session-elsewhere", level: "info" }),
    );

    t.api.sessions.get(SESSION)?.events.push(result("Opened a PR."));
    await poll(t);
    expect(t.bridge.sent.at(-1)).toMatchObject({
      message: "*podstow:* Opened a PR.",
      quoted_message_id: "r2",
    });
  });

  it("lets Claudes hear each other through the chat", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION, SECOND);
    started(t, SESSION, [result("Three ideas: A, B and C.")]);
    started(t, SECOND, [result("B could become an offline queue.")]);
    await says(t, "r1", OWNER, "@podstow what could we add for commuters?");
    await poll(t);
    await says(t, "r2", OWNER, "@brainstorm take idea B and go wide");
    const brainstorm = launches(t)[1];
    expect(brainstorm?.prompt).toContain('You are "brainstorm"');
    expect(brainstorm?.prompt).toContain("podstow: Three ideas: A, B and C.");
    expect(brainstorm?.options.env).toMatchObject({
      CLAUDE_PERMISSION_MODE: "dontAsk",
    });
    await poll(t);
    expect(t.bridge.sent.at(-1)?.message).toBe(
      "*brainstorm:* B could become an offline queue.",
    );

    await says(
      t,
      "r3",
      OWNER,
      "@podstow write-prd for what brainstorm landed on",
    );
    const input = followUps(t)[0]?.options.input ?? "";
    expect(input).toContain("brainstorm: B could become an offline queue.");
    expect(input).toContain("Thomas: @brainstorm take idea B and go wide");
  });

  it("asks each Claude a message names", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION, SECOND);
    started(t, SESSION);
    started(t, SECOND);
    await says(t, "r1", MEMBER, "@podstow @brainstorm what do you both think?");
    expect(
      launches(t).map((call) => call.prompt?.match(/You are "(\w+)"/u)?.[1]),
    ).toEqual(["podstow", "brainstorm"]);
    expect(t.bridge.reactions).toHaveLength(1);
  });

  it("sends a reply to an answer to the Claude that wrote it", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION, SECOND);
    started(t, SESSION, [result("Three options.")]);
    started(t, SECOND, [result("Go wide.")]);
    await says(t, "r1", MEMBER, "@brainstorm ideas?");
    await poll(t);
    await says(t, "r2", MEMBER, "@podstow thoughts?");
    await poll(t);
    await says(t, "r3", MEMBER, "and the second one?", {
      quotedIsFromMe: true,
      quotedMessageId: "sent-1",
      quotedContent: "*brainstorm:* Three options.",
    });
    const input = followUps(t)[0]?.options.input ?? "";
    expect(followUps(t)[0]?.args[2]).toBe(`session_${SESSION}`);
    expect(input).toContain(
      'Ollie asks you, @brainstorm, replying to @brainstorm: "Three options.":\nand the second one?',
    );
  });

  it("starts a new session when its running one is archived", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION, SECOND);
    started(t, SESSION, [result("Done.")]);
    started(t, SECOND);
    await says(t, "r1", MEMBER, "@podstow tidy the README");
    await poll(t);
    t.fake.followUps.set(SESSION, "archived");
    await says(t, "r2", MEMBER, "@podstow and the docs?");
    expect(eventsOf(t.lines)).toEqual(
      expect.arrayContaining(["session-gone", "session-started"]),
    );
    expect(launches(t)).toHaveLength(2);
    expect(launches(t)[1]?.prompt).toContain("You answered:\nDone.");
    expect(launches(t)[1]?.prompt).toContain("podstow (you): Done.");
    await says(t, "r3", MEMBER, "@podstow thanks");
    expect(followUps(t).at(-1)?.args[2]).toBe(`session_${SECOND}`);
  });

  it("posts an answer without the session's link, even one the session wrote", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION);
    started(t, SESSION, [
      result(`Fixed in #12.\n\n↗ claude.ai/code/session_${SESSION}`),
    ]);
    await says(t, "r1", MEMBER, "@podstow fix it");
    await poll(t);
    expect(t.bridge.sent.map((sent) => sent.message)).toEqual([
      "*podstow:* Fixed in #12.",
    ]);
  });

  it("gives each Claude a member's recent photos once, as short-lived links, and nobody else's", async () => {
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
    t.fake.launches.push(SESSION, SECOND);
    started(t, SESSION);
    started(t, SECOND);
    await says(t, "r1", MEMBER, "@podstow what's wrong in this screenshot?");
    const prompt = launches(t)[0]?.prompt ?? "";
    expect(prompt).toMatch(
      /- screen_shot\.png \(image\/png, 1 KB\): https:\/\/files\.s3\.example\.test\/attachments\/[\w-]+\/screen_shot\.png\?expires=3600/u,
    );
    expect(prompt).not.toContain("theirs.png");
    await says(t, "r2", MEMBER, "@podstow and now?");
    expect(followUps(t)[0]?.options.input).not.toContain("screen_shot.png");
    await says(t, "r3", MEMBER, "@brainstorm what do you see?");
    expect(launches(t)[1]?.prompt).toContain("screen_shot.png");
  });

  it("gives a Claude a member's voice note with its transcript, and the link alone when it cannot be transcribed", async () => {
    const t = (h = await harness({ env: { ATTACHMENTS_BUCKET: "files" } }));
    t.bridge.media.set("v1", {
      filename: "audio_1.ogg",
      bytes: Buffer.from("ogg bytes"),
    });
    t.bridge.media.set("v2", {
      filename: "audio_2.ogg",
      bytes: Buffer.from("garbled"),
    });
    t.aws.speech.set("ogg bytes", "the CI broke again");
    t.db.message({
      id: "v1",
      sender: MEMBER,
      content: "",
      at: NOW - 60_000,
      mediaType: "audio",
    });
    t.fake.launches.push(SESSION, SECOND);
    started(t, SESSION);
    started(t, SECOND);
    await says(t, "r1", MEMBER, "@podstow what did I say?");
    const prompt = launches(t)[0]?.prompt ?? "";
    expect(prompt).toMatch(
      /- audio_1\.ogg \(audio\/ogg, 1 KB\): https:\/\/files\.s3\.example\.test\/attachments\/[\w-]+\/audio_1\.ogg\?expires=3600\n {2}Transcript, by speech recognition, so it may have errors: "the CI broke again"\n/u,
    );
    expect(t.lines).toContainEqual(
      expect.objectContaining({ event: "attachment-transcribed" }),
    );

    t.db.message({
      id: "v2",
      sender: MEMBER,
      content: "",
      at: t.clock.now,
      mediaType: "audio",
    });
    await says(t, "r2", MEMBER, "@brainstorm and this one?");
    const second = launches(t)[1]?.prompt ?? "";
    expect(second).toMatch(
      /- audio_2\.ogg \(audio\/ogg, 1 KB\): \S+\n(?! {2}Transcript)/u,
    );
    expect(t.lines).toContainEqual(
      expect.objectContaining({
        event: "attachment-untranscribed",
        level: "warn",
        error: "Error",
      }),
    );
  });

  it("takes a voice note that replies to an answer as a request to the Claude that wrote it, and one that replies to nothing as none", async () => {
    const t = (h = await harness({ env: { ATTACHMENTS_BUCKET: "files" } }));
    t.bridge.media.set("v1", {
      filename: "audio_1.ogg",
      bytes: Buffer.from("ogg bytes"),
    });
    t.aws.speech.set("ogg bytes", "the CI broke again");
    t.fake.launches.push(SESSION);
    started(t, SESSION, [result("Three options.")]);
    await says(t, "r1", MEMBER, "@brainstorm ideas?");
    await poll(t);
    await says(t, "v1", MEMBER, "", {
      mediaType: "audio",
      quotedIsFromMe: true,
      quotedMessageId: "sent-1",
      quotedContent: "*brainstorm:* Three options.",
    });
    expect(followUps(t)[0]?.args[2]).toBe(`session_${SESSION}`);
    const input = followUps(t)[0]?.options.input ?? "";
    expect(input).toContain(
      'Ollie asks you, @brainstorm, replying to @brainstorm: "Three options.":\n[audio]\n',
    );
    expect(input).toMatch(
      /- audio_1\.ogg \(audio\/ogg, 1 KB\): \S+\n {2}Transcript, by speech recognition, so it may have errors: "the CI broke again"\n/u,
    );
    expect(reactions(t)).toContainEqual(["v1", "👀"]);

    t.bridge.media.set("v2", {
      filename: "audio_2.ogg",
      bytes: Buffer.from("more ogg"),
    });
    await says(t, "v2", MEMBER, "", { mediaType: "audio" });
    expect(followUps(t)).toHaveLength(1);
    expect(launches(t)).toHaveLength(1);
    expect(reactions(t).filter(([id]) => id === "v2")).toEqual([]);
  });

  it("transcribes only voice notes", async () => {
    const t = (h = await harness({ env: { ATTACHMENTS_BUCKET: "files" } }));
    t.bridge.media.set("p1", { filename: "a.png", bytes: Buffer.from("png") });
    t.db.message({
      id: "p1",
      sender: MEMBER,
      content: "",
      at: NOW - 60_000,
      mediaType: "image",
    });
    t.fake.launches.push(SESSION);
    started(t, SESSION);
    await says(t, "r1", MEMBER, "@podstow look");
    expect(launches(t)[0]?.prompt).toContain("a.png");
    expect(t.aws.transcribed).toEqual([]);
  });

  it("sends the files a Claude uploads in its turn after its answer, and only that turn's", async () => {
    const t = (h = await harness({ env: { ATTACHMENTS_BUCKET: "files" } }));
    t.fake.launches.push(SESSION);
    started(t, SESSION);
    await says(t, "r1", MEMBER, "@podstow draw me the chart");
    const prompt = launches(t)[0]?.prompt ?? "";
    expect(prompt).toContain(
      "To send pictures, audio or files to the chat with your answer, upload each before you answer, at most 5, each at most 16 MB:",
    );
    expect(prompt).toContain("'https://files.s3.example.test/'");
    expect(prompt).toContain("-F 'Policy=max-16777216-for-7200'");
    const [, folder] =
      /-F 'key=(outgoing\/[\w-]+\/)\$\{filename\}'/u.exec(prompt) ?? [];
    expect(folder).toBeDefined();
    // The session uploads a picture and a voice note.
    t.aws.objects.set(`files/${folder ?? ""}chart.png`, {
      body: Buffer.from("png bytes"),
      contentType: "image/png",
    });
    t.aws.objects.set(`files/${folder ?? ""}note.ogg`, {
      body: Buffer.from("ogg bytes"),
      contentType: "audio/ogg",
    });
    t.api.sessions.get(SESSION)?.events.push(result("Here it is."));
    await poll(t);
    const sent = t.bridge.sent.slice(-3);
    expect(sent.map((message) => message.message)).toEqual([
      "*podstow:* Here it is.",
      "",
      "",
    ]);
    const paths = sent.slice(1).map((message) => message.media_path ?? "");
    expect(paths.map((path) => path.split("/").at(-1))).toEqual([
      "chart.png",
      "note.ogg",
    ]);
    expect(paths.every((path) => path.startsWith(t.env.OUTBOX_DIR))).toBe(true);
    expect(t.bridge.files.get(paths[0] ?? "")?.toString()).toBe("png bytes");
    expect(paths.some((path) => existsSync(path))).toBe(false);
    expect(t.lines).toContainEqual(
      expect.objectContaining({ event: "files-sent", count: 2, bytes: 18 }),
    );
    expect(t.raw.filter((line) => line.includes("chart"))).toEqual([]);

    await says(t, "r2", MEMBER, "@podstow thanks");
    const next = followUps(t)[0]?.options.input ?? "";
    expect(next).not.toContain(folder ?? "");
    expect(next).toMatch(/-F 'key=outgoing\/[\w-]+\/\$\{filename\}'/u);
    t.api.sessions.get(SESSION)?.events.push(result("You're welcome."));
    await poll(t);
    expect(t.bridge.sent.at(-1)?.message).toBe("*podstow:* You're welcome.");
  });

  it("sends at most five files with an answer, and none too large", async () => {
    const t = (h = await harness({ env: { ATTACHMENTS_BUCKET: "files" } }));
    t.fake.launches.push(SESSION);
    started(t, SESSION);
    await says(t, "r1", MEMBER, "@podstow lots of pictures");
    const [, folder = ""] =
      /-F 'key=(outgoing\/[\w-]+\/)\$\{filename\}'/u.exec(
        launches(t)[0]?.prompt ?? "",
      ) ?? [];
    t.aws.objects.set(`files/${folder}huge.png`, {
      body: Buffer.alloc(16 * 1024 * 1024 + 1),
      contentType: "image/png",
    });
    for (const n of [1, 2, 3, 4, 5, 6])
      t.aws.objects.set(`files/${folder}p${String(n)}.png`, {
        body: Buffer.from("png"),
        contentType: "image/png",
      });
    t.api.sessions.get(SESSION)?.events.push(result("Pictures."));
    await poll(t);
    const files = t.bridge.sent.filter(
      (message) => message.media_path !== undefined,
    );
    expect(files).toHaveLength(5);
    expect(
      files.some((message) => message.media_path?.endsWith("huge.png")),
    ).toBe(false);
  });

  it("trusts each workspace it makes, in the task (cloud-sessions.md)", async () => {
    const t = (h = await harness({
      env: { LOGIN_PARAMETER: "/tagalong/claude-login" },
    }));
    t.fake.launches.push(SESSION);
    started(t, SESSION);
    await says(t, "r1", MEMBER, "@podstow hello");
    const cwd = launches(t)[0]?.options.cwd ?? "";
    const config: unknown = JSON.parse(
      readFileSync(join(t.env.HOME, ".claude.json"), "utf8"),
    );
    expect(config).toMatchObject({
      projects: { [cwd]: { hasTrustDialogAccepted: true } },
    });
  });

  it("leaves a laptop's own Claude config alone", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION);
    started(t, SESSION);
    await says(t, "r1", MEMBER, "@podstow hello");
    expect(existsSync(join(t.env.HOME, ".claude.json"))).toBe(false);
  });

  it("answers the same message once, however often the bridge sends it", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION, SECOND);
    started(t, SESSION);
    await says(t, "r1", MEMBER, "@podstow hello");
    await t.deliver({
      messageId: "r1",
      sender: MEMBER,
      content: "@podstow hello",
    });
    expect(t.fake.calls).toHaveLength(1);
  });

  it("starts nothing in a dry run", async () => {
    const t = (h = await harness({ env: { DRY_RUN: "1" } }));
    await says(t, "r1", MEMBER, "@podstow hello");
    expect(t.fake.calls).toEqual([]);
    expect(t.bridge.reactions).toEqual([]);
  });

  it("holds turns past the hourly cap", async () => {
    const t = (h = await harness({ env: { MAX_PER_HOUR: "2" } }));
    t.fake.launches.push(SESSION, SECOND, THIRD);
    started(t, SESSION);
    started(t, SECOND);
    await says(t, "r1", MEMBER, "@podstow one");
    await says(t, "r2", MEMBER, "@podstow @brainstorm two");
    expect(t.bridge.reactions.map((reaction) => reaction.emoji)).toEqual([
      "👀",
      "⏳",
    ]);
    t.clock.now += 3_600_001;
    await says(t, "r3", MEMBER, "@brainstorm three");
    expect(launches(t)).toHaveLength(2);
  });

  it("marks a request it could not start, and says why at error level", async () => {
    const t = (h = await harness());
    await says(t, "r1", MEMBER, "@podstow hello");
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

describe("a Claude's environment (cloud-sessions.md)", () => {
  it("starts nothing for a Claude whose environment is gone, and tells the chat", async () => {
    const t = (h = await harness());
    t.api.environments.splice(
      t.api.environments.findIndex(
        (environment) => environment.environment_id === "env_fake1",
      ),
      1,
    );
    t.fake.launches.push(SESSION);
    started(t, SESSION, [result("Lint.")]);
    await says(t, "r1", MEMBER, "@podstow why is the build red?");
    expect(launches(t)).toEqual([]);
    expect(t.bridge.sent).toEqual([
      {
        recipient: GROUP,
        message:
          "@podstow's environment is gone, so it can't start. An owner must define it again: `@claude define podstow env=<name>`",
        quoted_message_id: "r1",
      },
    ]);
    expect(reactions(t)).toEqual([
      ["r1", "👀"],
      ["r1", ""],
    ]);
    expect(t.lines).toContainEqual(
      expect.objectContaining({
        level: "warn",
        event: "session-environment-gone",
        claude: "podstow",
      }),
    );
  });

  it("keeps a member's photo for a Claude whose environment was gone, until it starts", async () => {
    const t = (h = await harness({ env: { ATTACHMENTS_BUCKET: "files" } }));
    t.bridge.media.set("p1", {
      filename: "screen shot.png",
      bytes: Buffer.from("png bytes"),
    });
    t.db.message({
      id: "p1",
      sender: MEMBER,
      content: "",
      at: NOW - 60_000,
      mediaType: "image",
    });
    const at = t.api.environments.findIndex(
      (environment) => environment.environment_id === "env_fake1",
    );
    const [gone] = t.api.environments.splice(at, 1);
    await says(t, "r1", MEMBER, "@podstow what's wrong in this screenshot?");
    expect(launches(t)).toEqual([]);
    if (gone !== undefined) t.api.environments.push(gone);
    t.fake.launches.push(SESSION);
    started(t, SESSION);
    await says(t, "r2", MEMBER, "@podstow what's wrong in it?");
    expect(launches(t)[0]?.prompt).toContain("screen_shot.png");
  });

  it("starts the other Claudes named with one whose environment is gone", async () => {
    const t = (h = await harness());
    t.api.environments.splice(
      t.api.environments.findIndex(
        (environment) => environment.environment_id === "env_fake1",
      ),
      1,
    );
    t.fake.launches.push(SECOND);
    started(t, SECOND, [result("Go wide.")]);
    await says(t, "r1", MEMBER, "@podstow @brainstorm what do you both think?");
    expect(launches(t)).toHaveLength(1);
    expect(launches(t)[0]?.prompt).toContain('You are "brainstorm"');
  });

  it("starts a Claude whose environment is in the list as before, beside one with no environment", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION, SECOND);
    started(t, SESSION, [result("Lint.")]);
    started(t, SECOND, [result("Go wide.")]);
    await says(t, "r1", MEMBER, "@podstow @brainstorm what do you both think?");
    expect(launches(t)).toHaveLength(2);
  });
});

describe("a Claude's session as a mailbox (cloud-sessions.md)", () => {
  it("delivers an ask while the last turn runs, and posts each answer as a reply to its own ask", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION);
    started(t, SESSION);
    await says(t, "r1", MEMBER, "@podstow why is the build red?");
    await poll(t);
    await says(t, "r2", MEMBER, "@podstow and is the deploy stuck?");
    expect(followUps(t)).toHaveLength(1);
    // The first turn ends, then the second, each listing its own message.
    t.api.sessions
      .get(SESSION)
      ?.events.push(
        { ...result("It fails on lint."), user_message_uuids: ["u1"] },
        { ...result("It waits on CI."), user_message_uuids: ["u2"] },
      );
    await poll(t);
    expect(t.bridge.sent).toEqual([
      {
        recipient: GROUP,
        message: "*podstow:* It fails on lint.",
        quoted_message_id: "r1",
      },
      {
        recipient: GROUP,
        message: "*podstow:* It waits on CI.",
        quoted_message_id: "r2",
      },
    ]);
  });

  it("answers asks that went into one turn once, as a reply to the latest", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION);
    started(t, SESSION);
    await says(t, "r1", MEMBER, "@podstow why is the build red?");
    await says(t, "r2", MEMBER, "@podstow and is the deploy stuck?");
    t.api.sessions.get(SESSION)?.events.push(result("Lint, and so CI."));
    await poll(t);
    expect(t.bridge.sent).toEqual([
      {
        recipient: GROUP,
        message: "*podstow:* Lint, and so CI.",
        quoted_message_id: "r2",
      },
    ]);
  });

  it("takes its 👀 off a request once the answer is posted", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION);
    started(t, SESSION, [result("It fails on lint.")]);
    await says(t, "r1", MEMBER, "@podstow why is the build red?");
    expect(reactions(t)).toEqual([["r1", "👀"]]);
    await poll(t);
    expect(reactions(t)).toEqual([
      ["r1", "👀"],
      ["r1", ""],
    ]);
  });

  it("keeps the 👀 on a message that asks two Claudes until both have answered", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION, SECOND);
    started(t, SESSION, [result("Lint.")]);
    started(t, SECOND);
    await says(t, "r1", MEMBER, "@podstow @brainstorm what do you both think?");
    await poll(t);
    expect(reactions(t)).toEqual([["r1", "👀"]]);
    t.api.sessions.get(SECOND)?.events.push(result("Go wide."));
    await poll(t);
    expect(reactions(t)).toEqual([
      ["r1", "👀"],
      ["r1", ""],
    ]);
  });

  it("keeps the 👀 while the second Claude's session is still starting", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION, SECOND);
    started(t, SESSION, [result("Lint.")]);
    started(t, SECOND);
    // The first Claude answers while the second one's session starts.
    t.fake.duringLaunch = () => t.app.pollOnce();
    await says(t, "r1", MEMBER, "@podstow @brainstorm what do you both think?");
    t.fake.duringLaunch = undefined;
    expect(t.bridge.sent.map((sent) => sent.message)).toEqual([
      "*podstow:* Lint.",
    ]);
    expect(reactions(t)).toEqual([["r1", "👀"]]);
    t.api.sessions.get(SECOND)?.events.push(result("Go wide."));
    await poll(t);
    expect(reactions(t)).toEqual([
      ["r1", "👀"],
      ["r1", ""],
    ]);
  });

  it("leaves the ⚠️ on a message one of its Claudes could not start for", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION);
    started(t, SESSION, [result("Lint.")]);
    await says(t, "r1", MEMBER, "@podstow @brainstorm what do you both think?");
    await poll(t);
    expect(reactions(t)).toEqual([
      ["r1", "👀"],
      ["r1", "⚠️"],
    ]);
  });

  it("posts a turn the session started by itself, until it has been quiet for GIVE_UP_MS", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION);
    started(t, SESSION, [result("Started the backfill in the background.")]);
    await says(t, "r1", MEMBER, "@podstow backfill the feed");
    await poll(t);
    t.clock.now += 30 * 60_000;
    t.api.sessions
      .get(SESSION)
      ?.events.push(selfStarted("The backfill finished: 120 rows."));
    await poll(t);
    expect(t.bridge.sent.map((sent) => sent.message)).toEqual([
      "*podstow:* Started the backfill in the background.",
      "*podstow:* The backfill finished: 120 rows.",
    ]);
    expect(t.bridge.sent[1]?.quoted_message_id).toBeUndefined();

    t.clock.now += t.env.GIVE_UP_MS;
    await poll(t);
    t.api.sessions.get(SESSION)?.events.push(selfStarted("Much later."));
    await poll(t);
    expect(t.bridge.sent).toHaveLength(2);
  });

  it("posts nothing for a turn that passes", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION);
    started(t, SESSION, [result("PASS")]);
    await says(t, "r1", MEMBER, "@podstow start the backfill");
    await poll(t);
    expect(t.bridge.sent).toEqual([]);
    expect(t.lines).toContainEqual(
      expect.objectContaining({ event: "session-passed", session: SESSION }),
    );
  });

  it("posts an answer that starts with a label as a reply to that line, without the label", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION);
    started(t, SESSION);
    await says(t, "m1", OWNER, "we ship on Friday");
    await says(t, "r1", MEMBER, "@podstow does that work?");
    const label =
      /^\[(m\d+)\] \S+ \S+ Thomas: we ship on Friday$/mu.exec(
        launches(t)[0]?.prompt ?? "",
      )?.[1] ?? "";
    expect(label).not.toBe("");
    t.api.sessions
      .get(SESSION)
      ?.events.push(result(`[${label}] Friday works.`));
    await poll(t);
    expect(t.bridge.sent).toEqual([
      {
        recipient: GROUP,
        message: "*podstow:* Friday works.",
        quoted_message_id: "m1",
      },
    ]);
  });

  it("puts a one-emoji answer on the message it answers as a reaction, and posts no message", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION);
    started(t, SESSION, [result("👍")]);
    await says(t, "m1", OWNER, "we ship on Friday");
    await says(t, "r1", MEMBER, "@podstow tag the release");
    await poll(t);
    // The Claude's reaction replaced the 👀, and stays.
    expect(reactions(t)).toEqual([
      ["r1", "👀"],
      ["r1", "👍"],
    ]);
    expect(t.bridge.sent).toEqual([]);

    const label =
      /^\[(m\d+)\] \S+ \S+ Thomas: we ship on Friday$/mu.exec(
        launches(t)[0]?.prompt ?? "",
      )?.[1] ?? "";
    t.api.sessions
      .get(SESSION)
      ?.events.push(selfStarted(`[${label}] 🎉`), selfStarted("✅"));
    await poll(t);
    expect(t.bridge.reactions.at(-1)).toMatchObject({
      message_id: "m1",
      emoji: "🎉",
    });
    // With no message to react to, it is posted.
    expect(t.bridge.sent.map((sent) => sent.message)).toEqual([
      "*podstow:* ✅",
    ]);
  });

  it("sends the files from every message a turn answers, and a later turn's, each once", async () => {
    const t = (h = await harness({ env: { ATTACHMENTS_BUCKET: "files" } }));
    t.fake.launches.push(SESSION);
    started(t, SESSION);
    await says(t, "r1", MEMBER, "@podstow draw the chart");
    await says(t, "r2", MEMBER, "@podstow and the table");
    const first = folderIn(launches(t)[0]?.prompt);
    const second = folderIn(followUps(t)[0]?.options.input);
    expect(first).not.toBe("");
    expect(second).not.toBe("");
    expect(second).not.toBe(first);
    const upload = (key: string) => {
      t.aws.objects.set(`files/${key}`, {
        body: Buffer.from("png"),
        contentType: "image/png",
      });
    };
    upload(`${first}chart.png`);
    upload(`${second}table.png`);
    t.api.sessions.get(SESSION)?.events.push(result("Both attached."));
    await poll(t);
    const names = () =>
      t.bridge.sent.map(
        (sent) => sent.media_path?.split("/").at(-1) ?? sent.message,
      );
    expect(names()).toEqual([
      "*podstow:* Both attached.",
      "chart.png",
      "table.png",
    ]);

    // Background work finishes and uploads with the form it was given.
    upload(`${second}late.png`);
    t.api.sessions.get(SESSION)?.events.push(selfStarted("And the late one."));
    await poll(t);
    expect(names().slice(3)).toEqual([
      "*podstow:* And the late one.",
      "late.png",
    ]);
  });
});

describe("who is answered", () => {
  it("ignores someone the owner has not allowed", async () => {
    const t = (h = await harness());
    await says(t, "r1", STRANGER, "@podstow hello");
    expect(t.fake.calls).toEqual([]);
    expect(t.bridge.reactions).toEqual([]);
    expect(t.lines).toContainEqual(
      expect.objectContaining({
        event: "request-ignored",
        why: "not-a-member",
      }),
    );
  });

  it("says nothing at all in a chat with no Claudes", async () => {
    const t = (h = await harness());
    await says(t, "x1", OWNER, "@podstow hello", { chatJID: OTHER_GROUP });
    expect(t.fake.calls).toEqual([]);
    expect(t.bridge.sent).toEqual([]);
    expect(t.lines).toEqual([]);
  });

  it("says who is here when asked with no name, or with one that is not here", async () => {
    const t = (h = await harness());
    await says(t, "r1", MEMBER, "@claude can you look at this?");
    expect(t.bridge.sent.at(-1)?.message).toBe(
      "Ask one of us by name: @podstow, @brainstorm.",
    );
    await says(t, "r2", MEMBER, "@critic have a look");
    expect(t.bridge.sent.at(-1)?.message).toBe(
      "@critic isn't here. You can ask: @podstow, @brainstorm. An owner can add one with @claude add <name>.",
    );
    expect(t.fake.calls).toEqual([]);
  });

  it("lets each Claude answer only the people allowed to ask it here", async () => {
    const t = (h = await harness({
      groups: {
        ...standardGroups,
        groups: {
          [GROUP]: {
            label: "Side projects",
            claudes: {
              podstow: { members: [] },
              brainstorm: { members: [MEMBER] },
            },
          },
        },
      },
    }));
    t.fake.launches.push(SESSION, SECOND);
    started(t, SESSION);
    started(t, SECOND);
    await says(t, "r1", MEMBER, "@podstow @brainstorm what do you think?");
    expect(
      launches(t).map((call) => call.prompt?.match(/You are "(\w+)"/u)?.[1]),
    ).toEqual(["brainstorm"]);
    expect(t.lines).toContainEqual(
      expect.objectContaining({
        event: "request-ignored",
        why: "not-a-member",
        claudes: 1,
      }),
    );
    await says(t, "r2", MEMBER, "@claude anyone around?");
    expect(t.bridge.sent.at(-1)?.message).toBe(
      "Ask one of us by name: @brainstorm.",
    );
    // podstow never hears someone who may not ask it.
    await says(t, "r3", OWNER, "@podstow what did Ollie say?");
    expect(launches(t)[1]?.prompt).not.toContain("what do you think?");
    expect(launches(t)[1]?.prompt).toContain('You are "podstow"');
  });
  it("answers an owner who writes from their LID", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION);
    started(t, SESSION);
    await says(t, "r1", OWNER_LID, "@podstow hello");
    expect(launches(t)).toHaveLength(1);
  });
});

describe("commands", () => {
  it("lets an owner define a Claude, add it, allow people for it, and stop", async () => {
    const t = (h = await harness());
    await says(
      t,
      "c1",
      OWNER,
      '@claude define reviewer o/other read-only env="spare"',
      { chatJID: OTHER_GROUP },
    );
    expect(t.groupsFile().claudes?.reviewer).toEqual({
      repo: "o/other",
      environment: "env_fake2",
      access: "read-only",
    });
    expect(t.bridge.sent.at(-1)?.message).toBe(
      "Defined.\n*@reviewer*: o/other, read-only, spare\n\nAdd it to a group with `@claude add reviewer` there.",
    );

    await says(t, "c2", OWNER, "@claude add reviewer podstow", {
      chatJID: OTHER_GROUP,
    });
    expect(t.groupsFile().groups?.[OTHER_GROUP]).toEqual({
      label: "Family",
      claudes: { reviewer: { members: [] }, podstow: { members: [] } },
    });
    expect(t.bridge.sent.at(-1)?.message).toBe(
      [
        "Claudes here:",
        "*@reviewer*: o/other, read-only, spare",
        "  Asked by: Thomas",
        "*@podstow*: o/r, read-write, Default Full",
        "  Asked by: Thomas",
        "",
        "Owners can ask them all: Thomas",
        "Others you can add: brainstorm, critic",
        "",
        "Only owners can ask @reviewer and @podstow until you allow someone: `@claude allow @Name reviewer`",
      ].join("\n"),
    );

    await says(t, "c3", OWNER, `@claude allow @${MEMBER}`, {
      chatJID: OTHER_GROUP,
      mentionedJids: [`${MEMBER}@s.whatsapp.net`],
    });
    expect(t.bridge.sent.at(-1)?.message).toBe(
      "Which Claude? `@claude allow @Name reviewer`. Allowing someone for one Claude does not let them ask the others.",
    );
    await says(t, "c4", OWNER, `@claude allow @${MEMBER} reviewer`, {
      chatJID: OTHER_GROUP,
      mentionedJids: [`${MEMBER}@s.whatsapp.net`],
    });
    expect(t.groupsFile().groups?.[OTHER_GROUP]?.claudes).toEqual({
      reviewer: { members: [MEMBER] },
      podstow: { members: [] },
    });
    expect(t.bridge.sent.at(-1)?.message).toContain(
      "*@reviewer*: o/other, read-only, spare\n  Asked by: Thomas, Ollie\n*@podstow*",
    );

    await says(t, "c5", OWNER, "@claude revoke +447700900002", {
      chatJID: OTHER_GROUP,
    });
    expect(t.groupsFile().groups?.[OTHER_GROUP]?.claudes).toEqual({
      reviewer: { members: [] },
      podstow: { members: [] },
    });

    await says(t, "c6", OWNER, "@claude remove reviewer podstow", {
      chatJID: OTHER_GROUP,
    });
    expect(t.app.parts.groups.config.groups.has(OTHER_GROUP)).toBe(false);
    expect(t.bridge.sent.at(-1)?.message).toBe(
      "No Claudes left here, so I'll ignore this chat.",
    );

    await says(t, "c7", OWNER, "@claude stop", { chatJID: OTHER_GROUP });
    expect(t.groupsFile().groups?.[OTHER_GROUP]).toBeUndefined();
  });

  it("lets an owner undefine a Claude in no chat, and starts it afresh if defined again", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION, SECOND);
    started(t, SESSION, [result("First answer.")]);
    started(t, SECOND);
    await says(t, "r1", MEMBER, "@podstow hello");
    await poll(t);

    await says(t, "c1", OWNER, "@claude undefine podstow");
    expect(t.bridge.sent.at(-1)?.message).toBe(
      "@podstow is still in Side projects. Remove it there first: `@claude remove podstow`",
    );
    expect(t.groupsFile()).toEqual(standardGroups);

    await says(t, "c2", OWNER, "@claude undefine nobody");
    expect(t.bridge.sent.at(-1)?.message).toMatch(
      /^Couldn't do that: No Claude called nobody\. Defined Claudes:\n/u,
    );

    await says(t, "c3", OWNER, "@claude remove podstow");
    await says(t, "c4", OWNER, "@claude undefine @podstow");
    expect(t.groupsFile().claudes?.podstow).toBeUndefined();
    expect(t.bridge.sent.at(-1)?.message).toBe(
      "Undefined @podstow, and forgot its conversations.\n\nDefined Claudes:\n*@brainstorm*: o/kickoff, read-only, default environment\n*@critic*: o/critic, read-only, default environment",
    );

    await says(t, "c5", OWNER, "@claude define podstow o/r read-write");
    await says(t, "c6", OWNER, "@claude add podstow");
    await says(t, "r2", OWNER, "@podstow again");
    expect(launches(t)).toHaveLength(2);
    expect(followUps(t)).toHaveLength(0);
  });

  it("keeps a chat on a Claude's old version until an owner updates it, then carries the conversation over", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION, SECOND);
    started(t, SESSION, [
      {
        type: "user",
        message: {
          content: [{ type: "tool_result", content: "secret file contents" }],
        },
      },
      result("Fine."),
    ]);
    started(t, SECOND);
    await says(t, "r1", MEMBER, "@brainstorm hello");
    await poll(t);
    await says(
      t,
      "c1",
      OWNER,
      '@claude define brainstorm role="You coach a brainstorm: go wide before narrowing."',
    );
    expect(t.bridge.sent.at(-1)?.message).toBe(
      'Updated.\n*@brainstorm*: o/kickoff, read-only, default environment, role "You coach a brainstorm: go wide before narrowing."\n\nChats already talking to @brainstorm keep the old version until `@claude update brainstorm` there.',
    );
    await says(t, "r2", MEMBER, "@brainstorm still there?");
    expect(launches(t)).toHaveLength(1);
    expect(followUps(t)).toHaveLength(1);

    await says(t, "c2", OWNER, "@claude who");
    expect(t.bridge.sent.at(-1)?.message).toContain(
      "  Talking here on an older version: `@claude update brainstorm`",
    );
    await says(t, "c3", OWNER, "@claude update brainstorm");
    expect(t.bridge.sent.at(-1)?.message).toBe(
      "Next time, @brainstorm starts on its current version and repo, with its whole conversation here carried over.",
    );
    await says(t, "m1", OWNER, "we ship on Friday");
    await says(t, "r3", MEMBER, "@brainstorm and now?");
    expect(launches(t)).toHaveLength(2);
    const prompt = launches(t)[1]?.prompt ?? "";
    expect(prompt).toContain(
      "Your role:\nYou coach a brainstorm: go wide before narrowing.",
    );
    expect(prompt).toContain(
      'This carries on your conversation in this chat from a previous session. Your dialogue there, oldest first:\nSent to you:\nYou are "brainstorm"',
    );
    expect(prompt).toMatch(
      /Ollie asks you, @brainstorm:\n@brainstorm hello\n[\s\S]*\n\nYou answered:\nFine\./u,
    );
    expect(prompt).not.toContain("secret file contents");
    expect(prompt).toContain("Said in the chat since you last heard from it:");
    expect(prompt).toContain("Thomas: we ship on Friday");
    expect(t.lines).toContainEqual(
      expect.objectContaining({ event: "session-started", carried: true }),
    );

    await says(t, "c4", OWNER, "@claude who");
    expect(t.bridge.sent.at(-1)?.message).not.toContain("older version");
  });

  it("opens a read-only Claude to everyone in the chat, and never a read-write one", async () => {
    const t = (h = await harness());
    await says(t, "c1", OWNER, "@claude allow everyone brainstorm");
    expect(t.groupsFile().groups?.[GROUP]?.claudes.brainstorm).toEqual({
      members: [MEMBER],
      everyone: true,
    });
    expect(t.bridge.sent.at(-1)?.message).toContain(
      "*@brainstorm*: o/kickoff, read-only, default environment\n  Asked by: everyone here",
    );
    t.fake.launches.push(SESSION);
    started(t, SESSION);
    await says(t, "r1", STRANGER, "@brainstorm wild idea");
    expect(launches(t)).toHaveLength(1);
    await says(t, "r2", STRANGER, "@podstow and you?");
    expect(launches(t)).toHaveLength(1);

    await says(t, "c2", OWNER, "@claude allow everyone podstow");
    expect(t.bridge.sent.at(-1)?.message).toBe(
      "Couldn't do that: everyone is only for read-only Claudes. @podstow can change a repo, so allow people by name.",
    );
    expect(t.groupsFile().groups?.[GROUP]?.claudes.podstow).toEqual({
      members: [MEMBER],
    });

    await says(t, "c3", OWNER, "@claude revoke everyone brainstorm");
    expect(t.groupsFile().groups?.[GROUP]?.claudes.brainstorm).toEqual({
      members: [MEMBER],
    });
  });

  it("works the same in a one-to-one chat with the number", async () => {
    const t = (h = await harness());
    await says(t, "c1", OWNER, "@claude add brainstorm", { chatJID: DIRECT });
    t.fake.launches.push(SESSION);
    started(t, SESSION);
    await says(t, "r1", OWNER, "@brainstorm let's think about pricing", {
      chatJID: DIRECT,
    });
    expect(launches(t)[0]?.prompt).toContain('You are "brainstorm"');
  });

  it("refuses a Claude it does not know, a reserved name, and an environment by name or id it cannot find", async () => {
    const t = (h = await harness());
    await says(t, "c1", OWNER, "@claude add nobody", { chatJID: OTHER_GROUP });
    expect(t.bridge.sent.at(-1)?.message).toMatch(
      /^Couldn't do that: No Claude called nobody\. Defined Claudes:\n\*@podstow\*/u,
    );
    await says(t, "c2", OWNER, "@claude define claude o/r", {
      chatJID: OTHER_GROUP,
    });
    expect(t.bridge.sent.at(-1)?.message).toBe(
      "Couldn't do that: Name it first: `@claude define critic owner/repo read-only`",
    );
    await says(t, "c3", OWNER, "@claude define critic o/other env=nowhere", {
      chatJID: OTHER_GROUP,
    });
    expect(t.bridge.sent.at(-1)?.message).toBe(
      'Couldn\'t do that: no environment called "nowhere". Yours: Default Full, spare',
    );
    await says(t, "c4", OWNER, "@claude define critic o/other env_fakegone", {
      chatJID: OTHER_GROUP,
    });
    expect(t.bridge.sent.at(-1)?.message).toBe(
      'Couldn\'t do that: no environment called "env_fakegone". Yours: Default Full, spare',
    );
    await says(t, "c5", OWNER, "@claude define critic env=env_fakegone", {
      chatJID: OTHER_GROUP,
    });
    expect(t.bridge.sent.at(-1)?.message).toBe(
      'Couldn\'t do that: no environment called "env_fakegone". Yours: Default Full, spare',
    );
    await says(t, "c6", OWNER, "@claude define critic env_fake2", {
      chatJID: OTHER_GROUP,
    });
    expect(t.groupsFile().claudes?.critic).toEqual({
      repo: "o/critic",
      environment: "env_fake2",
      access: "read-only",
    });
  });

  it("starts a Claude afresh, with only the last messages", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION, SECOND);
    started(t, SESSION, [result("First answer.")]);
    started(t, SECOND);
    await says(t, "r1", MEMBER, "@podstow hello");
    await poll(t);
    await says(t, "c1", OWNER, "@claude fresh podstow");
    expect(t.bridge.sent.at(-1)?.message).toBe(
      "Next time, @podstow starts afresh, with only the last messages here.",
    );
    await says(t, "r2", MEMBER, "@podstow again");
    expect(launches(t)).toHaveLength(2);
    expect(followUps(t)).toHaveLength(0);
  });

  it("sends help as an intro and messages to copy", async () => {
    const t = (h = await harness());
    await says(t, "c1", OWNER, "@claude help");
    expect(t.bridge.sent.map((sent) => sent.message.split("\n")[0])).toEqual([
      "Claudes here:",
      "@claude add critic",
      "@claude define critic owner/repo read-only",
      "@claude allow @",
      "@claude revoke @",
      "@claude listen podstow on",
      "@claude update podstow",
      "@claude fresh podstow",
      "@claude who",
      "@claude stop",
    ]);
  });

  it("ignores a command from anyone but an owner, and never treats it as a request", async () => {
    const t = (h = await harness());
    await says(t, "c1", MEMBER, "@claude add critic");
    await says(t, "c2", STRANGER, "@claude stop");
    expect(t.groupsFile()).toEqual(standardGroups);
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
  it("says once when a Claude waits for an approval, and gives up in the end", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION);
    started(t, SESSION);
    await says(t, "r1", MEMBER, "@podstow deploy it");
    t.api.sessions.set(SESSION, {
      status: "requires_action",
      environmentId: "env_fake1",
      events: [],
    });
    await poll(t);
    await poll(t);
    expect(t.bridge.sent.map((sent) => sent.message)).toEqual([
      `*podstow:* waiting for an approval in the session.\n\n↗ claude.ai/code/session_${SESSION}`,
    ]);
    t.clock.now += t.env.GIVE_UP_MS + 1;
    await poll(t);
    expect(t.bridge.sent.at(-1)?.message).toBe(
      "*podstow:* no reply after 120 minutes; I may still be working.",
    );
    expect(reactions(t).at(-1)).toEqual(["r1", ""]);
    await poll(t);
    expect(t.bridge.sent).toHaveLength(2);
  });

  it("says nothing of an approval once every request has its answer", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION);
    started(t, SESSION, [result("Done.")]);
    await says(t, "r1", MEMBER, "@podstow tidy up");
    await poll(t);
    const session = t.api.sessions.get(SESSION);
    if (session !== undefined) session.status = "requires_action";
    await poll(t);
    expect(t.bridge.sent.map((sent) => sent.message)).toEqual([
      "*podstow:* Done.",
    ]);
  });

  it("reports a session that ended in an error", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION);
    started(t, SESSION, [
      { type: "result", subtype: "error_max_turns", is_error: true },
    ]);
    await says(t, "r1", MEMBER, "@podstow go");
    await poll(t);
    expect(t.bridge.sent.at(-1)?.message).toBe(
      "*podstow:* ⚠️ The session stopped with an error (error_max_turns).",
    );
  });

  it("posts a turn's last words when it ended with no result", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION);
    started(t, SESSION, [assistant("Half an answer.")]);
    await says(t, "r1", MEMBER, "@podstow go");
    await poll(t);
    expect(t.bridge.sent).toEqual([]);
    const session = t.api.sessions.get(SESSION);
    if (session !== undefined) session.status = "idle";
    await poll(t);
    expect(t.bridge.sent.at(-1)?.message).toBe("*podstow:* Half an answer.");
  });

  it("posts a turn once when its result lands just after its events were read", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION);
    started(t, SESSION, [assistant("Half an answer.")]);
    await says(t, "r1", MEMBER, "@podstow go");
    const session = t.api.sessions.get(SESSION);
    if (session !== undefined) {
      session.status = "idle";
      // The turn ends between the read of its events and of its status.
      session.onStatus = () => {
        delete session.onStatus;
        session.events.push(result("The whole answer."));
      };
    }
    await poll(t);
    await poll(t);
    expect(t.bridge.sent.map((sent) => sent.message)).toEqual([
      "*podstow:* The whole answer.",
    ]);
  });

  it("calls nothing archived while a message is still on its way in", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION, SECOND);
    started(t, SESSION, [result("Done.")]);
    started(t, SECOND, [result("Started afresh.")]);
    await says(t, "r1", MEMBER, "@podstow tidy the README");
    await poll(t);
    // The session signed off and was archived; tagalong still reads it.
    const session = t.api.sessions.get(SESSION);
    if (session !== undefined) session.status = "archived";
    t.fake.followUps.set(SESSION, "archived");
    t.fake.during = () => t.app.pollOnce();
    await says(t, "r2", MEMBER, "@podstow and the docs?");
    t.fake.during = undefined;
    await poll(t);
    expect(t.bridge.sent.map((sent) => sent.message)).toEqual([
      "*podstow:* Done.",
      "*podstow:* Started afresh.",
    ]);
  });

  it("posts a late answer to a request it gave up on, while it still reads the session", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION);
    started(t, SESSION);
    await says(t, "r1", MEMBER, "@podstow migrate the database");
    t.clock.now += t.env.GIVE_UP_MS - 60_000;
    await says(t, "r2", MEMBER, "@podstow and the backups?");
    t.clock.now += 120_000;
    await poll(t);
    expect(t.bridge.sent.at(-1)).toMatchObject({
      message: "*podstow:* no reply after 120 minutes; I may still be working.",
      quoted_message_id: "r1",
    });
    t.api.sessions
      .get(SESSION)
      ?.events.push({ ...result("Migrated."), user_message_uuids: ["u1"] });
    await poll(t);
    expect(t.bridge.sent.at(-1)).toMatchObject({
      message: "*podstow:* Migrated.",
      quoted_message_id: "r1",
    });
  });

  it("stops watching a Claude removed from the chat", async () => {
    const t = (h = await harness());
    t.fake.launches.push(SESSION);
    started(t, SESSION);
    await says(t, "r1", MEMBER, "@podstow go");
    await says(t, "c1", OWNER, "@claude remove podstow");
    const sent = t.bridge.sent.length;
    t.api.sessions.get(SESSION)?.events.push(result("late"));
    await poll(t);
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
  it("starts even when the login cannot be read, and says so at error level", async () => {
    const t = (h = await harness({
      env: { LOGIN_PARAMETER: "/tagalong/claude-login", PORT: "18771" },
    }));
    t.aws.getSecret = () => Promise.reject(new Error("AccessDeniedException"));
    const server = await t.app.start();
    try {
      expect(t.lines).toContainEqual(
        expect.objectContaining({ level: "error", event: "login-missing" }),
      );
      expect(t.lines).toContainEqual(
        expect.objectContaining({ event: "started" }),
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("listens on loopback", async () => {
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
      expect(
        await (await fetch(`http://127.0.0.1:${String(free)}/healthz`)).text(),
      ).toBe("ok");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
