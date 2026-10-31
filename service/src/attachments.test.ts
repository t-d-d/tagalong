import { describe, expect, it } from "vitest";
import { LIMITS, heardMedia, safeName, typeOf } from "./attachments.ts";
import type { MessageRow } from "./store.ts";

const row = (id: string, extra: Partial<MessageRow> = {}): MessageRow => ({
  id,
  chatJid: "120363000000000001@g.us",
  sender: "447700900002",
  content: "",
  timestamp: "2026-10-18 17:00:00+00:00",
  isFromMe: false,
  mediaType: "audio",
  fileLength: undefined,
  ...extra,
});

describe("attachments", () => {
  it("names a file safely", () => {
    expect(safeName("../../etc/passwd")).toBe("_.._etc_passwd");
    expect(safeName("My photo (1).JPG")).toBe("My_photo_1_.JPG");
    expect(safeName("...")).toBe("file");
    expect(safeName(`${"a".repeat(100)}.pdf`).length).toBe(80);
  });

  it("knows common types, and falls back to bytes", () => {
    expect(typeOf("a.JPG")).toBe("image/jpeg");
    expect(typeOf("voice.opus")).toBe("audio/ogg");
    expect(typeOf("thing.bin")).toBe("application/octet-stream");
  });

  it("hears the media an interjecting Claude is given: from anyone in the chat but the device, once each, at most five", () => {
    const rows = [
      row("a1"),
      row("t1", { mediaType: "", content: "just words" }),
      row("s1", { sender: "447700900003" }),
      row("c1", { isFromMe: true }),
      row("g1"),
      row("i1", { mediaType: "image" }),
      row("i2", { mediaType: "document" }),
      row("i3", { mediaType: "video" }),
    ];
    const heard = heardMedia(rows, { sent: new Set(["g1"]) });
    expect(heard.map((each) => each.id)).toEqual([
      "a1",
      "s1",
      "i1",
      "i2",
      "i3",
    ]);
    expect(LIMITS.files).toBe(5);
    const more = heardMedia([...rows, row("i4", { mediaType: "sticker" })], {
      sent: new Set(["g1"]),
    });
    expect(more.map((each) => each.id)).toEqual(["s1", "i1", "i2", "i3", "i4"]);
  });
});
