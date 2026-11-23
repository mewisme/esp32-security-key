// Replaced by tests/e2e/fake-create-key-connector.ts in `vite build --mode e2e` (vite.config.ts) only.
import { type KeyConnector, WebUsbKeyConnector } from "./key-connector";

export function createKeyConnector(): KeyConnector {
  return new WebUsbKeyConnector();
}
