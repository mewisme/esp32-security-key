import type { ErrorCode } from "./catalog";

/** An error that already knows which user-facing error it is. */
export class FirmwareError extends Error {
  readonly code: ErrorCode;
  readonly detail: string;

  constructor(code: ErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "FirmwareError";
    this.code = code;
    this.detail = detail;
  }
}
