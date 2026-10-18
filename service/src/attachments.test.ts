import { describe, expect, it } from "vitest";
import { safeName, typeOf } from "./attachments.ts";

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
});
