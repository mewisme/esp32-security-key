import type { Phase } from "../flashing/machine";
import type { ErrorCode } from "./catalog";
import { FirmwareError } from "./firmware-error";

/** Marks a loss of the serial connection (raised by the driver's disconnect listener). */
export class DisconnectedError extends Error {
  constructor() {
    super("device disconnected");
    this.name = "DisconnectedError";
  }
}

export function classifyError(err: unknown, phase: Phase): ErrorCode {
  if (err instanceof FirmwareError) return err.code;
  const name = err instanceof Error ? err.name : "";
  const disconnected = err instanceof DisconnectedError || name === "NetworkError" && phase !== "requesting-permission" && phase !== "connecting";
  if (disconnected) {
    return phase === "flashing" || phase === "verifying-flash" ? "disconnected-during-flash" : "device-disconnected";
  }
  if (phase === "requesting-permission") {
    if (name === "NotFoundError") return "no-device-selected";
    if (name === "SecurityError" || name === "NotAllowedError") return "permission-denied";
    return "no-device-selected";
  }
  if (phase === "connecting" && (name === "InvalidStateError" || name === "NetworkError")) return "port-busy";
  if (phase === "connecting" || phase === "detecting-chip") return "not-download-mode";
  if (phase === "flashing") return "flash-write-failed";
  if (phase === "verifying-flash") return "flash-verify-failed";
  if (phase === "rebooting") return "reboot-failed";
  if (phase === "checking-flash-safety") return "unsafe-layout";
  if (phase === "fetching-metadata" || phase === "downloading" || phase === "firmware-selection") return "firmware-unavailable";
  if (phase === "verifying-integrity") return "checksum-mismatch";
  return "device-disconnected";
}
