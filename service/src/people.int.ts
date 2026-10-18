import { afterEach, describe, expect, it } from "vitest";
import {
  BridgeDb,
  CLAUDE,
  CLAUDE_LID,
  GROUP,
  MEMBER,
  OTHER_GROUP,
  OWNER,
  OWNER_LID,
  standardDb,
} from "../../test/bridge-db.ts";
import { People, userPart } from "./people.ts";
import { WhatsAppStore, timeOf } from "./store.ts";

const NOW = Date.parse("2026-10-18T17:00:00Z");
let db: BridgeDb | undefined;
afterEach(() => {
  db?.close();
  db = undefined;
});

describe("the bridge's databases", () => {
  it("has no device until both databases are there", () => {
    expect(new WhatsAppStore("/nonexistent").present()).toBe(false);
    db = standardDb(NOW);
    expect(new WhatsAppStore(db.store).present()).toBe(true);
  });

  it("reads chats and messages, oldest first, without reactions or deleted ones", () => {
    db = standardDb(NOW)
      .message({ id: "m1", sender: OWNER, content: "first", at: NOW - 3000 })
      .message({
        id: "m2",
        sender: MEMBER,
        content: "👍",
        at: NOW - 2000,
        mediaType: "reaction",
      })
      .message({ id: "m3", sender: MEMBER, content: "gone", at: NOW - 1500 })
      .message({
        id: "m4",
        sender: CLAUDE,
        content: "answer",
        at: NOW - 1000,
        fromMe: true,
      })
      .message({
        id: "m5",
        chat: OTHER_GROUP,
        sender: OWNER,
        content: "elsewhere",
        at: NOW,
      })
      .deleteMessage("m3", NOW);
    const store = new WhatsAppStore(db.store);
    expect(store.chatName(GROUP)).toBe("Side projects");
    expect(
      store
        .groupChats()
        .map((chat) => chat.jid)
        .sort(),
    ).toEqual([GROUP, OTHER_GROUP]);
    expect(store.recent(GROUP, 10).map((row) => row.id)).toEqual(["m1", "m4"]);
    expect(store.recent(GROUP, 1).map((row) => row.id)).toEqual(["m4"]);
    expect(store.message(GROUP, "m4")).toMatchObject({
      isFromMe: true,
      content: "answer",
    });
    expect(store.message(GROUP, "m5")).toBeUndefined();
    expect(store.message(GROUP, undefined)).toBeUndefined();
    const first = store.message(GROUP, "m1");
    expect(first === undefined ? NaN : timeOf(first.timestamp)).toBe(
      NOW - 3000,
    );
  });
});

describe("people", () => {
  it("knows Claude by its number and its LID", () => {
    db = standardDb(NOW);
    const people = new People(new WhatsAppStore(db.store));
    expect(people.refresh()).toBe(true);
    expect([...people.self].sort()).toEqual([CLAUDE_LID, CLAUDE].sort());
    expect(people.nameOf(`${CLAUDE}@s.whatsapp.net`)).toBe("Claude");
  });

  it("matches a person on their number or their LID, never their name", () => {
    db = standardDb(NOW);
    const people = new People(new WhatsAppStore(db.store));
    people.refresh();
    expect(people.sameUser(`${OWNER_LID}@lid`, OWNER)).toBe(true);
    expect(people.sameUser(OWNER, MEMBER)).toBe(false);
    expect(people.canonical(OWNER_LID)).toBe(OWNER);
    expect(people.nameOf(`${OWNER_LID}@lid`)).toBe("Thomas");
    expect(people.nameOf("447700900999")).toBe("+447700900999");
    expect(people.toJid(OWNER_LID)).toBe(`${OWNER_LID}@lid`);
    expect(people.toJid(MEMBER)).toBe(`${MEMBER}@s.whatsapp.net`);
    expect(people.readable(`hi @${MEMBER} and @447700900999`)).toBe(
      "hi @Ollie and @447700900999",
    );
  });

  it("waits for a device", () => {
    expect(new People(new WhatsAppStore("/nonexistent")).refresh()).toBe(false);
    expect(userPart("447700900001:12@s.whatsapp.net")).toBe("447700900001");
  });
});
