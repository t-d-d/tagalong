// tagalong: Claude in your WhatsApp groups. Starts the app and runs its loops:
// answers, the heartbeat, the login and the device.
import { createApp } from "./app.ts";
import { realAws } from "./aws.ts";
import { readEnv } from "./env.ts";
import { errorFields, log } from "./log.ts";
import { run } from "./run.ts";

const env = readEnv();
const aws =
  env.LOGIN_PARAMETER !== undefined || env.ATTACHMENTS_BUCKET !== undefined
    ? realAws(env.AWS_REGION)
    : undefined;
const app = createApp(env, {
  aws,
  run,
  now: () => Date.now(),
  platform: process.platform,
});

const every = (loop: string, ms: number, task: () => Promise<unknown>) => {
  setInterval(() => {
    task().catch((error: unknown) => {
      log.warn("loop-failed", { loop, ...errorFields(error) });
    });
  }, ms);
};

await app.start();
await app.heartbeat();
every("poll", env.POLL_MS, app.pollOnce);
every("heartbeat", env.HEARTBEAT_MS, app.heartbeat);
every("login", env.LOGIN_CHECK_MS, app.keepFresh);
every("device", 30_000, app.checkDevice);
every("people", 600_000, () => Promise.resolve(app.refreshPeople()));
