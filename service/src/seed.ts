// The WhatsApp device arrives once, from the Mac it was paired on
// (one-device.md): scripts/move-device.ts uploads it to the bucket, and the
// first task to find it unpacks it beside the bridge and deletes the upload.
import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { Aws } from "./aws.ts";
import { errorFields, log } from "./log.ts";
import type { Runner } from "./run.ts";

export interface SeedDeps {
  storeDir: string;
  groupsFile: string;
  stateFile: string;
  aws: Aws | undefined;
  bucket: string | undefined;
  key: string;
  run: Runner;
  env: Record<string, string>;
}

export type DeviceState = "present" | "seeded" | "waiting" | "off";

const present = (dir: string) =>
  existsSync(join(dir, "whatsapp.db")) && existsSync(join(dir, "messages.db"));

export async function ensureDevice(deps: SeedDeps): Promise<DeviceState> {
  if (present(deps.storeDir)) return "present";
  if (deps.aws === undefined || deps.bucket === undefined) return "off";
  const upload = await deps.aws.getObject(deps.bucket, deps.key);
  if (upload === undefined) return "waiting";
  // Unpacked on the same volume as the store, so the move into place is one rename.
  const parent = dirname(deps.storeDir);
  const incoming = join(parent, `.incoming-${String(process.pid)}`);
  rmSync(incoming, { recursive: true, force: true });
  mkdirSync(incoming, { recursive: true, mode: 0o700 });
  try {
    const archive = join(incoming, "device.tgz");
    writeFileSync(archive, upload, { mode: 0o600 });
    const { code } = await deps.run("tar", ["-xzf", archive, "-C", incoming], {
      env: deps.env,
    });
    if (code !== 0 || !present(join(incoming, "store"))) {
      log.error("device-seed-failed", {
        why:
          code === 0
            ? "no store/whatsapp.db and store/messages.db in the upload"
            : "tar failed",
      });
      return "waiting";
    }
    for (const [name, target] of [
      ["groups.json", deps.groupsFile],
      ["state.json", deps.stateFile],
    ] as const) {
      if (existsSync(join(incoming, name)) && !existsSync(target))
        renameSync(join(incoming, name), target);
    }
    rmSync(deps.storeDir, { recursive: true, force: true });
    renameSync(join(incoming, "store"), deps.storeDir);
    await deps.aws.deleteObject(deps.bucket, deps.key);
    log.info("device-seeded");
    return "seeded";
  } catch (error) {
    log.error("device-seed-failed", errorFields(error));
    return "waiting";
  } finally {
    rmSync(incoming, { recursive: true, force: true });
  }
}
