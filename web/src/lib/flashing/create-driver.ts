// Replaced by tests/e2e/fake-create-driver.ts in `vite build --mode e2e` (vite.config.ts); never in production builds.
import type { FlashDriver } from "./driver";
import { EsptoolDriver } from "./esptool-driver";

export function createDriver(): FlashDriver {
  return new EsptoolDriver();
}
