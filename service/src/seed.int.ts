import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fakeAws } from "../../test/fake-aws.ts";
import { logLines } from "../../test/log-lines.ts";
import { run } from "./run.ts";
import { ensureDevice } from "./seed.ts";

/** An upload as scripts/move-device.ts makes one. */
function archive(files: Record<string, string>): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "tagalong-seed-src-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  const out = join(
    mkdtempSync(join(tmpdir(), "tagalong-seed-out-")),
    "device.tgz",
  );
  execFileSync("tar", ["-czf", out, "-C", dir, "."]);
  return readFileSync(out);
}

function setup() {
  const data = mkdtempSync(join(tmpdir(), "tagalong-volume-"));
  mkdirSync(join(data, "bridge"), { recursive: true });
  const aws = fakeAws();
  const deps = {
    storeDir: join(data, "bridge", "store"),
    groupsFile: join(data, "groups.json"),
    stateFile: join(data, "state.json"),
    aws,
    bucket: "files",
    key: "seed/device.tgz",
    run,
    env: { PATH: "/usr/bin:/bin" },
  };
  return { data, aws, deps };
}

describe("the device seed", () => {
  it("unpacks the upload beside the bridge, keeps what is already there, and deletes the upload", async () => {
    const { aws, deps } = setup();
    writeFileSync(deps.stateFile, "kept");
    aws.objects.set("files/seed/device.tgz", {
      body: archive({
        "store/whatsapp.db": "device",
        "store/messages.db": "messages",
        "store/.bridge-token": "token",
        "groups.json": "{}",
        "state.json": "theirs",
      }),
      contentType: "application/gzip",
    });
    expect(await ensureDevice(deps)).toBe("seeded");
    expect(readFileSync(join(deps.storeDir, "whatsapp.db"), "utf8")).toBe(
      "device",
    );
    expect(readFileSync(join(deps.storeDir, ".bridge-token"), "utf8")).toBe(
      "token",
    );
    expect(readFileSync(deps.groupsFile, "utf8")).toBe("{}");
    expect(readFileSync(deps.stateFile, "utf8")).toBe("kept");
    expect(aws.objects.size).toBe(0);
    expect(await ensureDevice(deps)).toBe("present");
  });

  it("waits for an upload, and turns down one without a device", async () => {
    const { lines } = logLines();
    const { aws, deps } = setup();
    expect(await ensureDevice(deps)).toBe("waiting");
    aws.objects.set("files/seed/device.tgz", {
      body: archive({ "store/messages.db": "only" }),
      contentType: "application/gzip",
    });
    expect(await ensureDevice(deps)).toBe("waiting");
    expect(existsSync(deps.storeDir)).toBe(false);
    expect(lines.at(-1)).toMatchObject({
      level: "error",
      event: "device-seed-failed",
    });
  });

  it("is off without a bucket", async () => {
    const { deps } = setup();
    expect(await ensureDevice({ ...deps, aws: undefined })).toBe("off");
  });
});
