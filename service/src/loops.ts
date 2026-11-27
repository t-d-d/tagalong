// The loops main.ts runs. A loop that fails is logged and runs again next time.
import { errorFields, log } from "./log.ts";

/** Run `task` every `ms`. A throw or a rejection is logged, never left to stop the process. */
export function every(
  loop: string,
  ms: number,
  task: () => unknown,
): NodeJS.Timeout {
  return setInterval(() => {
    // The executor turns a throw before any promise into a rejection.
    new Promise((resolve) => {
      resolve(task());
    }).catch((error: unknown) => {
      log.warn("loop-failed", { loop, ...errorFields(error) });
    });
  }, ms);
}
