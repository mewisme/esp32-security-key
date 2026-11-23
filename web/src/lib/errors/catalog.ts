// Every error the installer can show, in plain language. `retry: false` means retrying cannot help without changing
// something first. Integrity and storage-safety errors never offer a way to continue anyway.

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
  | "device-disconnected"
  | "disconnected-during-flash"
  | "flash-write-failed"
  | "flash-verify-failed"
  | "reboot-failed"
  | "no-reenumeration"
  | "firmware-version-unknown";

export type ErrorGroup = "Browser" | "Connecting" | "Board" | "Firmware" | "Flashing" | "After install";

export interface ErrorInfo {
  group: ErrorGroup;
  title: string;
  what: string;
  next: string[];
  retry: boolean;
}

/** Errors that must never offer "continue anyway". */
export const NO_BYPASS: readonly ErrorCode[] = ["checksum-mismatch", "manifest-invalid", "unsafe-layout", "storage-incompatible"];

const DOWNLOAD_MODE = "Put the board in download mode: unplug it, hold the BOOT button, plug it back in while holding BOOT, then let go.";

export const ERRORS: Record<ErrorCode, ErrorInfo> = {
  "browser-unsupported": {
    group: "Browser",
    title: "This browser can't install firmware",
    what: "Installing needs Web Serial, which only desktop Chrome, Edge and other Chromium browsers have. Firefox, Safari and phones don't.",
    next: ["Open this page in Google Chrome or Microsoft Edge on a Windows, macOS, Linux or ChromeOS computer."],
    retry: false,
  },
  "insecure-context": {
    group: "Browser",
    title: "This page wasn't opened securely",
    what: "Browsers only allow access to USB devices on pages loaded over https (or from your own computer).",
    next: ["Open https://multikeys.mewis.me directly instead of a copy or a proxy."],
    retry: false,
  },
  "no-device-selected": {
    group: "Connecting",
    title: "No device was chosen",
    what: "The device list closed without a selection, or it was empty.",
    next: [
      DOWNLOAD_MODE,
      "In the list, pick “USB JTAG/serial debug unit” or an entry mentioning ESP32-S3, then press Connect.",
      "If the list is empty, try another USB cable: many cables only carry power.",
    ],
    retry: true,
  },
  "permission-denied": {
    group: "Connecting",
    title: "The browser blocked access to the device",
    what: "Access to serial devices is turned off for this site, or a policy on this computer blocks it.",
    next: ["Click the icon left of the address bar, allow “Serial ports”, reload the page and try again."],
    retry: true,
  },
  "port-busy": {
    group: "Connecting",
    title: "Another program is using the board",
    what: "The board's port is already open in another tab or program (for example a serial monitor or Arduino IDE).",
    next: ["Close other tabs of this site and any program that talks to the board, then try again."],
    retry: true,
  },
  "wrong-connector": {
    group: "Connecting",
    title: "This is the board's UART connector",
    what: "You can install through this connector, but the finished key only works when plugged into the connector labelled USB or OTG.",
    next: ["After installing, move the cable to the USB/OTG connector."],
    retry: true,
  },
  "power-only-cable": {
    group: "Connecting",
    title: "The board doesn't show up",
    what: "Nothing new appeared in the device list. The most common reason is a cable that only carries power.",
    next: ["Try a different USB cable you know can transfer files.", "Try another USB port on the computer, directly rather than through a hub."],
    retry: true,
  },
  "multiple-devices": {
    group: "Connecting",
    title: "Several boards are connected",
    what: "More than one possible board is plugged in, so it isn't clear which one to install to.",
    next: ["Unplug every board except the one you want to install, then try again."],
    retry: true,
  },
  "not-download-mode": {
    group: "Connecting",
    title: "The board isn't ready for installing",
    what: "The installer couldn't start talking to the chip. Usually the board is running its normal program instead of waiting in download mode.",
    next: [
      DOWNLOAD_MODE,
      "Boards with an RST button: hold BOOT, press and release RST, then release BOOT.",
      "Then press Try again and choose the device again.",
    ],
    retry: true,
  },
  "unsupported-chip": {
    group: "Board",
    title: "This board has a different chip",
    what: "MultiKeys only runs on the ESP32-S3. The connected board reports another chip.",
    next: ["Use an ESP32-S3 board with 16 MB flash (for example one marked N16R8)."],
    retry: false,
  },
  "wrong-flash-size": {
    group: "Board",
    title: "This board doesn't have 16 MB of flash",
    what: "The firmware and its storage layout need 16 MB of flash memory. This board reports a different size.",
    next: ["Use an ESP32-S3 board with 16 MB flash; the module marking usually contains N16 (for example N16R8)."],
    retry: false,
  },
  "secure-download-mode": {
    group: "Board",
    title: "This chip is locked",
    what: "The chip is in Secure Download Mode, which permanently restricts what can be written. The installer won't try to work around it.",
    next: ["Use a different board."],
    retry: false,
  },
  "firmware-unavailable": {
    group: "Firmware",
    title: "The firmware couldn't be downloaded",
    what: "The release list or the firmware file couldn't be fetched.",
    next: ["Check your internet connection and try again.", "If it keeps failing, the GitHub release may be temporarily unavailable."],
    retry: true,
  },
  "manifest-invalid": {
    group: "Firmware",
    title: "The firmware description failed safety checks",
    what: "The release's firmware description doesn't match what this installer considers safe to write. Nothing was written.",
    next: ["Choose another release, or report the problem on GitHub."],
    retry: false,
  },
  "checksum-mismatch": {
    group: "Firmware",
    title: "The downloaded firmware is damaged",
    what: "The downloaded file doesn't match its published checksum. Nothing was written to your board.",
    next: ["Try again; if it fails again, report the problem on GitHub."],
    retry: true,
  },
  "unsafe-layout": {
    group: "Firmware",
    title: "The board's storage couldn't be checked",
    what: "The installer couldn't read the board's storage layout, so it can't tell whether installing would destroy data. Nothing was written.",
    next: ["Unplug the board, put it back in download mode and try again."],
    retry: true,
  },
  "storage-incompatible": {
    group: "Firmware",
    title: "This board's MultiKeys storage is incompatible",
    what: "The board runs MultiKeys with a different storage layout. Installing would destroy its stored keys, so the installer stops.",
    next: ["Keep using the firmware that is on the board, or ask for help on GitHub before changing anything."],
    retry: false,
  },
  "device-disconnected": {
    group: "Connecting",
    title: "The board was disconnected",
    what: "The connection to the board was lost before anything was written.",
    next: ["Plug the board back in (in download mode) and try again."],
    retry: true,
  },
  "disconnected-during-flash": {
    group: "Flashing",
    title: "The board was disconnected while installing",
    what: "The connection was lost while firmware was being written. The board won't start normally until it is installed again; your stored keys area was not being written.",
    next: [DOWNLOAD_MODE, "Then press Try again to install again."],
    retry: true,
  },
  "flash-write-failed": {
    group: "Flashing",
    title: "Writing the firmware failed",
    what: "The board stopped responding while the firmware was being written.",
    next: [DOWNLOAD_MODE, "Use a short cable plugged directly into the computer, then try again."],
    retry: true,
  },
  "flash-verify-failed": {
    group: "Flashing",
    title: "The written firmware didn't check out",
    what: "After writing, the board's flash didn't match the firmware. The board may not start correctly.",
    next: [DOWNLOAD_MODE, "Then try again. If it fails repeatedly, the board's flash may be faulty."],
    retry: true,
  },
  "reboot-failed": {
    group: "After install",
    title: "The board didn't restart by itself",
    what: "The firmware was written and verified, but the board couldn't be restarted from the browser.",
    next: ["Unplug the board and plug it back in (without holding BOOT)."],
    retry: false,
  },
  "no-reenumeration": {
    group: "After install",
    title: "The key hasn't shown up yet",
    what: "The firmware was written and verified, but the key wasn't detected afterwards.",
    next: ["Unplug the board and plug it back in without holding BOOT.", "Use the connector labelled USB or OTG.", "Then press “Check my key”."],
    retry: false,
  },
  "firmware-version-unknown": {
    group: "After install",
    title: "The installed version couldn't be read",
    what: "The board's current firmware doesn't say which version it is, so the installer can't promise your stored keys stay usable.",
    next: ["Only continue if you can afford to lose the keys stored on this board."],
    retry: false,
  },
};

export const ERROR_GROUPS: ErrorGroup[] = ["Browser", "Connecting", "Board", "Firmware", "Flashing", "After install"];
