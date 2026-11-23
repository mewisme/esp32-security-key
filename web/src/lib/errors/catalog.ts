// Every error the installer can show. The text of each one (title, what happened, what to do) is in src/i18n/messages,
// next to every other string of the site. `retry: false` means retrying cannot help without changing something first.
// Integrity and storage-safety errors never offer a way to continue anyway.

export type ErrorCode =
  | "browser-unsupported"
  | "insecure-context"
  | "no-device-selected"
  | "permission-denied"
  | "port-busy"
  | "wrong-connector"
  | "power-only-cable"
  | "multiple-devices"
  | "not-download-mode"
  | "unsupported-chip"
  | "wrong-flash-size"
  | "secure-download-mode"
  | "firmware-unavailable"
  | "manifest-invalid"
  | "checksum-mismatch"
  | "unsafe-layout"
  | "storage-incompatible"
  | "storage-unverified"
  | "device-disconnected"
  | "disconnected-during-flash"
  | "flash-write-failed"
  | "flash-verify-failed"
  | "reboot-failed"
  | "no-reenumeration"
  | "firmware-version-unknown"
  | "unsupported-flash-mode"
  | "unknown-flash-size"
  | "profile-not-in-release"
  | "name-rename-disabled"
  | "name-button-timeout"
  | "name-pin-wrong"
  | "name-pin-blocked"
  | "name-transport-unavailable"
  | "name-not-verified"
  | "name-failed";

/** Identity of a Help section: stays English because it feeds the `#group-...` anchors; the label shown is `t.errorGroups`. */
export type ErrorGroup = "Browser" | "Connecting" | "Board" | "Firmware" | "Flashing" | "After install" | "Personalization";

export interface ErrorInfo {
  group: ErrorGroup;
  retry: boolean;
}

/** The words of one error in one language. */
export interface ErrorText {
  title: string;
  what: string;
  next: string[];
}

/** Errors that must never offer "continue anyway". */
export const NO_BYPASS: readonly ErrorCode[] = ["checksum-mismatch", "manifest-invalid", "unsafe-layout", "storage-incompatible", "storage-unverified"];

export const ERRORS: Record<ErrorCode, ErrorInfo> = {
  "browser-unsupported": { group: "Browser", retry: false },
  "insecure-context": { group: "Browser", retry: false },
  "no-device-selected": { group: "Connecting", retry: true },
  "permission-denied": { group: "Connecting", retry: true },
  "port-busy": { group: "Connecting", retry: true },
  "wrong-connector": { group: "Connecting", retry: true },
  "power-only-cable": { group: "Connecting", retry: true },
  "multiple-devices": { group: "Connecting", retry: true },
  "not-download-mode": { group: "Connecting", retry: true },
  "unsupported-chip": { group: "Board", retry: false },
  "wrong-flash-size": { group: "Board", retry: false },
  "unsupported-flash-mode": { group: "Board", retry: false },
  "unknown-flash-size": { group: "Board", retry: true },
  "profile-not-in-release": { group: "Board", retry: false },
  "secure-download-mode": { group: "Board", retry: false },
  "firmware-unavailable": { group: "Firmware", retry: true },
  "manifest-invalid": { group: "Firmware", retry: false },
  "checksum-mismatch": { group: "Firmware", retry: true },
  "unsafe-layout": { group: "Firmware", retry: true },
  "storage-incompatible": { group: "Firmware", retry: false },
  "storage-unverified": { group: "Firmware", retry: false },
  "device-disconnected": { group: "Connecting", retry: true },
  "disconnected-during-flash": { group: "Flashing", retry: true },
  "flash-write-failed": { group: "Flashing", retry: true },
  "flash-verify-failed": { group: "Flashing", retry: true },
  "reboot-failed": { group: "After install", retry: false },
  "no-reenumeration": { group: "After install", retry: false },
  "firmware-version-unknown": { group: "After install", retry: false },
  "name-rename-disabled": { group: "Personalization", retry: false },
  "name-button-timeout": { group: "Personalization", retry: true },
  "name-pin-wrong": { group: "Personalization", retry: true },
  "name-pin-blocked": { group: "Personalization", retry: false },
  "name-transport-unavailable": { group: "Personalization", retry: true },
  "name-not-verified": { group: "Personalization", retry: true },
  "name-failed": { group: "Personalization", retry: true },
};

export const ERROR_GROUPS: ErrorGroup[] = ["Browser", "Connecting", "Board", "Firmware", "Flashing", "After install", "Personalization"];
