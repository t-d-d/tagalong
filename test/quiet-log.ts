// Log lines go nowhere unless a test reads them (test/log-lines.ts).
import { setSink } from "../service/src/log.ts";

setSink(() => undefined);
