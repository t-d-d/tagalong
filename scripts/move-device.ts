// Move the WhatsApp device from the laptop it was paired on to the task
// (one-device.md). Run once, on that laptop, with its bridge stopped:
//
//   node scripts/move-device.ts --store <the bridge's store folder> \
//     [--groups <groups.json>] [--state <state.json>] [--profile <aws profile>]
//
// It checks the bridge is not running, packs the store's two databases and
// its token with groups.json and state.json, uploads them to the stack's
// bucket at seed/device.tgz, and waits for the task to take them. Then it
// renames the store, so the bridge here cannot start with the device again.
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseFile } from "../service/src/groups.ts";
import { StateStore } from "../service/src/state.ts";

const KEY = "seed/device.tgz";

const say = (line: string) => {
  process.stderr.write(`${line}\n`);
};

async function bridgeRunning(): Promise<boolean> {
  try {
    await fetch("http://127.0.0.1:8080/api/health", {
      signal: AbortSignal.timeout(2000),
    });
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      store: { type: "string" },
      groups: { type: "string" },
      state: { type: "string" },
      profile: { type: "string" },
    },
  });
  const aws = (args: string[]) => [
    ...args,
    ...(values.profile === undefined ? [] : ["--profile", values.profile]),
  ];
  if (values.store === undefined) {
    say(
      "--store names the bridge's store folder, the one holding whatsapp.db and messages.db.",
    );
    return 2;
  }
  const store = resolve(values.store);
  for (const name of ["whatsapp.db", "messages.db", ".bridge-token"]) {
    if (!existsSync(join(store, name))) {
      say(
        `${join(store, name)} is not there. Is --store the bridge's store folder?`,
      );
      return 1;
    }
  }
  if (await bridgeRunning()) {
    say(
      "The bridge here is still running. Stop it, and the dispatcher, then run this again.",
    );
    return 1;
  }
  // Check both files the way the task will read them, before anything moves.
  if (values.groups !== undefined)
    parseFile(JSON.parse(readFileSync(values.groups, "utf8")));
  if (values.state !== undefined) new StateStore(values.state);

  const bucket = spawnSync(
    "aws",
    aws([
      "cloudformation",
      "describe-stacks",
      "--stack-name",
      "tagalong-app",
      "--query",
      "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue",
      "--output",
      "text",
    ]),
    { encoding: "utf8" },
  );
  const name = bucket.stdout.trim();
  if (bucket.status !== 0 || name === "" || name === "None") {
    say(
      `Could not read the stack's bucket: ${bucket.stderr.trim() || "no tagalong-app stack"}. Deploy first (docs/bootstrap.md).`,
    );
    return 1;
  }

  const stage = mkdtempSync(join(tmpdir(), "tagalong-device-"));
  try {
    mkdirSync(join(stage, "pack", "store"), { recursive: true, mode: 0o700 });
    for (const file of ["whatsapp.db", "messages.db", ".bridge-token"])
      copyFileSync(join(store, file), join(stage, "pack", "store", file));
    if (values.groups !== undefined)
      copyFileSync(values.groups, join(stage, "pack", "groups.json"));
    if (values.state !== undefined)
      copyFileSync(values.state, join(stage, "pack", "state.json"));
    const archive = join(stage, "device.tgz");
    if (
      spawnSync("tar", ["-czf", archive, "-C", join(stage, "pack"), "."], {
        stdio: "inherit",
      }).status !== 0
    )
      return 1;
    const upload = spawnSync(
      "aws",
      aws(["s3", "cp", archive, `s3://${name}/${KEY}`, "--only-show-errors"]),
      { stdio: "inherit" },
    );
    if (upload.status !== 0) return 1;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  say(
    "Uploaded. Waiting for the task to take the device (up to five minutes)...",
  );

  for (let tries = 0; tries < 60; tries++) {
    await new Promise((done) => setTimeout(done, 5000));
    const head = spawnSync(
      "aws",
      aws(["s3api", "head-object", "--bucket", name, "--key", KEY]),
      { stdio: "ignore" },
    );
    if (head.status !== 0) {
      const moved = `${store}.moved-to-tagalong`;
      renameSync(store, moved);
      process.stdout.write(
        `The task has the device. This store is now ${moved}: never start the bridge here with it again. The heartbeat in /tagalong says when the bridge is connected.\n`,
      );
      return 0;
    }
  }
  say(
    `The task has not taken it yet. It stays in the bucket for a day; check the task is running, and that /tagalong says device-seeded. The store here is unchanged: do not start the bridge with it.`,
  );
  return 1;
}

process.exitCode = await main();
