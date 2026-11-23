// Replaced by tests/e2e/fake-create-usb-checker.ts in `vite build --mode e2e` (vite.config.ts) only.
import { type UsbChecker, WebUsbChecker } from "./usb-checker";

export function createUsbChecker(): UsbChecker {
  return new WebUsbChecker();
}
