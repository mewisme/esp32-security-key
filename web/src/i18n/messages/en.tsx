// The English dictionary: source of truth for the shape of every language (`Messages`). vi.tsx must provide the same keys
// with the same function signatures, so a missing or extra key is a compile error.
//
// Conventions:
// - Interpolation and plurals are functions that return the whole sentence (never concatenate fragments in a component).
// - A sentence with a link or other markup is a function that takes the inner element(s) and returns JSX.
// - Records keyed by a domain enum (error codes, install modes, ...) are checked with `satisfies`/a typed const.
// - Identity values (MultiKeys, BOOT, ESP32-S3, CLI commands, error codes, release names) are never in here.
import type { ReactNode } from "react";
import type { MatrixLevel, MatrixRowId } from "@/lib/compatibility/matrix";
import type { Support } from "@/lib/compatibility/profiles";
import { DEVICE_NAME_MAX, FALLBACK_DEFAULT_NAME, type NameProblem } from "@/lib/device/device-name";
import type { NameRequest } from "@/lib/device/mkauth";
import type { ErrorCode, ErrorGroup, ErrorText } from "@/lib/errors/catalog";
import type { AckId, InstallMode } from "@/lib/flashing/install-mode";
import type { LabCheck, LabErrorId } from "@/lib/passkey/lab";
import type { StepId } from "@/lib/wizard-steps";
import { flashSizeList } from "./shared";

const FLASH_SIZES = flashSizeList("or");

const DOWNLOAD_MODE = "Put the board in download mode: unplug it, hold the BOOT button, plug it back in while holding BOOT, then let go.";

const errors = {
  "browser-unsupported": {
    title: "This browser can't install firmware",
    what: "Installing needs Web Serial, which only desktop Chrome, Edge and other Chromium browsers have. Firefox, Safari and phones don't.",
    next: ["Open this page in Google Chrome or Microsoft Edge on a Windows, macOS, Linux or ChromeOS computer."],
  },
  "insecure-context": {
    title: "This page wasn't opened securely",
    what: "Browsers only allow access to USB devices on pages loaded over https (or from your own computer).",
    next: ["Open https://multikeys.mewis.me directly instead of a copy or a proxy."],
  },
  "no-device-selected": {
    title: "No device was chosen",
    what: "The device list closed without a selection, or it was empty.",
    next: [
      DOWNLOAD_MODE,
      "In the list, pick “USB JTAG/serial debug unit” or an entry mentioning ESP32-S3, then press Connect.",
      "If the list is empty, try another USB cable: many cables only carry power.",
    ],
  },
  "permission-denied": {
    title: "The browser blocked access to the device",
    what: "Access to serial devices is turned off for this site, or a policy on this computer blocks it.",
    next: ["Click the icon left of the address bar, allow “Serial ports”, reload the page and try again."],
  },
  "port-busy": {
    title: "Another program is using the board",
    what: "The board's port is already open in another tab or program (for example a serial monitor or Arduino IDE).",
    next: ["Close other tabs of this site and any program that talks to the board, then try again."],
  },
  "wrong-connector": {
    title: "This is the board's UART connector",
    what: "You can install through this connector, but the finished key only works when plugged into the connector labelled USB or OTG.",
    next: ["After installing, move the cable to the USB/OTG connector."],
  },
  "power-only-cable": {
    title: "The board doesn't show up",
    what: "Nothing new appeared in the device list. The most common reason is a cable that only carries power.",
    next: ["Try a different USB cable you know can transfer files.", "Try another USB port on the computer, directly rather than through a hub."],
  },
  "multiple-devices": {
    title: "Several boards are connected",
    what: "More than one possible board is plugged in, so it isn't clear which one to install to.",
    next: ["Unplug every board except the one you want to install, then try again."],
  },
  "not-download-mode": {
    title: "The board isn't ready for installing",
    what: "The installer couldn't start talking to the chip. Usually the board is running its normal program instead of waiting in download mode.",
    next: [
      DOWNLOAD_MODE,
      "Boards with an RST button: hold BOOT, press and release RST, then release BOOT.",
      "Then press Try again and choose the device again.",
    ],
  },
  "unsupported-chip": {
    title: "This board has a different chip",
    what: "MultiKeys only runs on the ESP32-S3. The connected board reports another chip.",
    next: [`Use an ESP32-S3 board with ${FLASH_SIZES} of quad flash (for example one marked N16R8).`],
  },
  "wrong-flash-size": {
    title: "This board's flash size isn't supported",
    what: `MultiKeys needs ${FLASH_SIZES} of flash. This board reports a different size.`,
    next: [`Use an ESP32-S3 board with ${FLASH_SIZES} of flash; the module marking usually contains N4, N8 or N16 (for example N16R8).`],
  },
  "unsupported-flash-mode": {
    title: "This board uses octal flash",
    what: "Your board uses octal flash. MultiKeys only supports ESP32-S3 boards with quad-SPI flash; nothing was written.",
    next: ["Use an ESP32-S3 board with a quad-flash module. ESP32-S3-WROOM-2 modules (for example N16R8V) use octal flash."],
  },
  "unknown-flash-size": {
    title: "The flash size couldn't be read",
    what: "The flash size couldn't be read, so no firmware can be chosen safely. Reconnect in download mode and try again; nothing was written.",
    next: [DOWNLOAD_MODE, "Then press Try again and choose the device again."],
  },
  "profile-not-in-release": {
    title: "No firmware for this board in the chosen release",
    what: "This release has no firmware for your board's flash size. Choose a newer release.",
    next: ["Go back and choose another release, or check the Releases page for the flash sizes each release covers."],
  },
  "secure-download-mode": {
    title: "This chip is locked",
    what: "The chip is in Secure Download Mode, which permanently restricts what can be written. The installer won't try to work around it.",
    next: ["Use a different board."],
  },
  "firmware-unavailable": {
    title: "The firmware couldn't be downloaded",
    what: "The release list or the firmware file couldn't be fetched.",
    next: ["Check your internet connection and try again.", "If it keeps failing, the GitHub release may be temporarily unavailable."],
  },
  "manifest-invalid": {
    title: "The firmware description failed safety checks",
    what: "The release's firmware description doesn't match what this installer considers safe to write. Nothing was written.",
    next: ["Choose another release, or report the problem on GitHub."],
  },
  "checksum-mismatch": {
    title: "The downloaded firmware is damaged",
    what: "The downloaded file doesn't match its published checksum. Nothing was written to your board.",
    next: ["Try again; if it fails again, report the problem on GitHub."],
  },
  "unsafe-layout": {
    title: "The board's storage couldn't be checked",
    what: "The installer couldn't read the board's storage layout, so it can't tell whether installing would destroy data. Nothing was written.",
    next: ["Unplug the board, put it back in download mode and try again."],
  },
  "storage-incompatible": {
    title: "This board's MultiKeys storage is incompatible",
    what: "The board runs MultiKeys with a different storage layout. Installing would destroy its stored keys, so the installer stops.",
    next: ["Keep using the firmware that is on the board, or ask for help on GitHub before changing anything."],
  },
  "device-disconnected": {
    title: "The board was disconnected",
    what: "The connection to the board was lost before anything was written.",
    next: ["Plug the board back in (in download mode) and try again."],
  },
  "disconnected-during-flash": {
    title: "The board was disconnected while installing",
    what: "The connection was lost while firmware was being written. The board won't start normally until it is installed again; your stored keys area was not being written.",
    next: [DOWNLOAD_MODE, "Then press Try again to install again."],
  },
  "flash-write-failed": {
    title: "Writing the firmware failed",
    what: "The board stopped responding while the firmware was being written.",
    next: [DOWNLOAD_MODE, "Use a short cable plugged directly into the computer, then try again."],
  },
  "flash-verify-failed": {
    title: "The written firmware didn't check out",
    what: "After writing, the board's flash didn't match the firmware. The board may not start correctly.",
    next: [DOWNLOAD_MODE, "Then try again. If it fails repeatedly, the board's flash may be faulty."],
  },
  "reboot-failed": {
    title: "The board didn't restart by itself",
    what: "The firmware was written and verified, but the board couldn't be restarted from the browser.",
    next: ["Unplug the board and plug it back in (without holding BOOT)."],
  },
  "no-reenumeration": {
    title: "The key hasn't shown up yet",
    what: "The firmware was written and verified, but the key wasn't detected afterwards.",
    next: ["Unplug the board and plug it back in without holding BOOT.", "Use the connector labelled USB or OTG.", "Then press “Check my key”."],
  },
  "firmware-version-unknown": {
    title: "The installed version couldn't be read",
    what: "The board's current firmware doesn't say which version it is, so the installer can't promise your stored keys stay usable.",
    next: ["Only continue if you can afford to lose the keys stored on this board."],
  },
  "name-rename-disabled": {
    title: "This firmware can't be renamed",
    what: "This firmware was built without renaming support.",
    next: ["Keep the default name, or install a MultiKeys build that supports renaming."],
  },
  "name-button-timeout": {
    title: "The BOOT button wasn't pressed in time",
    what: "The BOOT button wasn't pressed within 15 seconds; the name was not changed.",
    next: ["Try again, and press the BOOT button on your key as soon as the page asks you to."],
  },
  "name-pin-wrong": {
    title: "Wrong management PIN",
    what: "Wrong management PIN; the name was not changed.",
    next: ["Enter the management PIN again. Too many wrong attempts block the PIN."],
  },
  "name-pin-blocked": {
    title: "The management PIN is blocked",
    what: "The management PIN is blocked; renaming is impossible without re-provisioning.",
    next: ["Keep using the current name. A FIDO reset doesn't clear a blocked management PIN; docs/PROVISIONING.md explains re-provisioning a development unit."],
  },
  "name-transport-unavailable": {
    title: "This browser can't reach the key's management interface",
    what: "This browser can't talk to the key's management interface.",
    next: [
      "Use desktop Chrome or Edge, with the key plugged into the USB/OTG connector.",
      'Or rename it from the command line with the host tools: multikey device rename "My Key" --reenumerate',
    ],
  },
  "name-not-verified": {
    title: "The new name wasn't confirmed",
    what: "The key accepted the name but didn't come back after restarting its USB connection.",
    next: ["Unplug the key, plug it in again, and check the name on the First use page."],
  },
  "name-failed": {
    title: "The key refused the name",
    what: "The key refused the name; its answer is shown as a status code.",
    next: [
      `Use 1–${DEVICE_NAME_MAX} plain ASCII characters (letters, digits, spaces, punctuation) without a space at the start or end.`,
      'If it keeps failing, rename it from the command line: multikey device rename "My Key" --reenumerate',
    ],
  },
} satisfies Record<ErrorCode, ErrorText>;

// Typed (not `satisfies`) so every language gets the same `(from: string) => string` signature, used or not.
const risk: Record<Exclude<InstallMode, "blocked">, (from: string) => string> = {
  "first-install": () => "The board's flash is empty, so there is nothing to lose.",
  update: (from) =>
    `Your keys are stored in an area the installer does not write. This release declares it can read data from version ${from} and later.`,
  "update-unverified": (from) =>
    `The installed MultiKeys firmware is older than ${from} or doesn't declare a compatible version. The area holding your keys is not written, but this firmware may not be able to use keys created by the installed one.`,
  "switch-image": () =>
    "The board runs the other MultiKeys firmware. The storage area is not written, but its contents belong to the other firmware and will not be usable.",
  "replace-compatible-layout": () =>
    "The board runs firmware that isn't MultiKeys but uses the same storage layout. That firmware will be replaced; the storage area is not written.",
  repurpose: () =>
    "The board uses a different storage layout, for example factory demo firmware. To install MultiKeys the installer first clears the nvs and part0 areas — everything the previous firmware stored there is erased — and then writes MultiKeys. Nothing else is erased.",
};

export const en = {
  meta: {
    title: "MultiKeys — install a DIY security key from your browser",
    description: "Install MultiKeys, an experimental open-source security key firmware for ESP32-S3 boards, from your browser.",
  },

  // Words used by several screens.
  common: {
    continue: "Continue",
    back: "Back",
    cancel: "Cancel",
    tryAgain: "Try again",
    startOver: "Start over",
    retry: "Retry",
    technicalDetails: "Technical details",
    moreHelp: "More help",
    releaseNotes: "Release notes",
    download: "Download",
    preRelease: "Pre-release",
    stable: "Stable",
    loadingReleases: "Loading releases",
    noFirmwareRelease: "No firmware release yet",
    firmware: "Firmware",
    deviceName: "Device name",
    checkMyKey: "Check my key",
    unnamedDevice: "unnamed USB device",
  },

  layout: {
    skipToContent: "Skip to content",
    mainNav: "Main",
    mobileNav: "Mobile",
    nav: { install: "Install", firstUse: "First use", passkeys: "Passkeys", help: "Help", releases: "Releases" },
    githubRepository: "GitHub repository",
    github: "GitHub",
    openMenu: "Open menu",
    close: "Close",
    language: "Language",
    theme: { label: "Color theme", light: "Light", dark: "Dark", system: "System" },
    footer: {
      label: "Footer",
      notice: "MultiKeys is experimental open-source software, licensed AGPL-3.0-or-later.",
      documentation: "Documentation",
      source: "Corresponding source",
      license: "License",
    },
  },

  home: {
    badge: "Experimental · open source",
    title: "Turn an ESP32-S3 into a FIDO2 security key",
    lead: "Install MultiKeys from your browser in a few minutes, no command line needed.",
    source: "Source on GitHub",
    verified: "Hardware verified on ESP32-S3 N16R8",
    how: {
      title: "How it works",
      connect: { title: "Connect", text: "Plug an ESP32-S3 board into your computer's USB port in download mode." },
      install: { title: "Install", text: "The installer checks the board and the firmware, shows what it will write, then writes it." },
      signIn: { title: "Press BOOT to sign in", text: "Replug it: it is now a security key. Press BOOT when a website asks you to touch it." },
    },
    features: {
      title: "Features",
      passkeys: { title: "Passkeys and FIDO2", text: "Works with WebAuthn sign-in on sites and apps that accept security keys." },
      presence: { title: "BOOT-button presence", text: "Every sign-in needs a physical press of the BOOT button." },
      pin: { title: "PIN", text: "Protect stored credentials with a FIDO PIN set from your browser or OS." },
      open: { title: "Open source and auditable", text: "Firmware, host tools and this site are published under the AGPL." },
    },
    hardware: {
      title: "Supported hardware",
      details: (link: ReactNode) => <>Details and how to read your module's marking: {link}.</>,
      table: { hardware: "Hardware", details: "Details", status: "Status" },
    },
    warning: {
      title: "Development firmware",
      text: "Development firmware: not FIDO-certified, no secure element, flash encryption off. Don't use it as your only key.",
    },
    latest: "Latest release",
    docs: { title: "Documentation", documentation: "Documentation", hardware: "Hardware", security: "Security", releasesProcess: "Releases process" },
  },

  help: {
    title: "Help",
    lead: "What each message means and what to do next.",
    topics: "Help topics",
  },

  notFound: {
    title: "Page not found",
    text: "That address doesn't exist on this site.",
    home: "Go home",
  },

  releases: {
    title: "Releases",
    intro: (link: ReactNode) => <>Firmware published on {link}. Releases before v0.2.0 contain host tools only.</>,
    githubReleases: "GitHub Releases",
    loadingLatest: "Loading latest release",
    skipped: (n: number) => `${n} release(s) skipped because their manifest failed validation:`,
    history: "Release history",
    unpublished: "unpublished",
    loadFailed: "The release list couldn't be loaded",
    allReleases: "All releases",
    copy: "Copy",
    copied: "Copied",
  },

  experimental: {
    title: "Experimental",
    text: "Experimental development firmware — not suitable for protecting important accounts.",
  },

  statusBanner: {
    title: "Not yet tested on real hardware",
    text: (link: ReactNode) => (
      <>The web installer has not yet been tested on real hardware. The developer script is the verified method. {link}.</>
    ),
    link: "Read the developer instructions",
  },

  install: {
    loading: "Loading the installer…",
    title: "Install MultiKeys",
    lead: "Put the MultiKeys FIDO2 firmware on an ESP32-S3 board, straight from your browser.",
    cancelled: { title: "Installation cancelled", text: "Nothing was written to the board." },
    steps: {
      "get-started": "Get started",
      firmware: "Firmware & name",
      connect: "Connect & verify",
      review: "Review",
      install: "Install",
      finish: "Finish",
    } satisfies Record<StepId, string>,
    stepper: {
      label: "Installation progress",
      completed: ", completed",
      stepOf: (n: number, total: number) => `Step ${n} of ${total}`,
    },
    // Screen-reader text of a checklist row.
    rowState: { done: "done", active: "in progress", waiting: "waiting" },
    firmwareName: (label: ReactNode) => <>MultiKeys FIDO2 — {label}</>,

    getStarted: {
      description: "Install the MultiKeys FIDO2 firmware on an ESP32-S3 board. It takes about five minutes.",
      whatHappens: {
        title: "What happens",
        text: "You pick the firmware, put the board in download mode, check what the installer found, and install. Afterwards you can give the key its own name.",
      },
      whatYouNeed: {
        title: "What you need",
        text: `An ESP32-S3 board with ${FLASH_SIZES} of quad-SPI flash, a native USB connector, a BOOT button, a USB cable that carries data, and desktop Chrome or Edge.`,
      },
      beforeConfirm: { title: "Before you confirm", text: "Nothing is written to the board until you confirm on the Review screen." },
      boardCaption: "Example: an N16R8 module. The number after N is the flash size in MB; N4, N8 and N16 are supported.",
      unsure: "Not sure which board you have?",
      unsureText:
        "You don't have to know. The Connect & verify stage reads the chip and the flash size electronically and stops, before writing anything, if the board isn't supported. The marking on the metal module (for example N8R2) tells you the flash size too: the number after N.",
      hardwareCheck: "My board is an ESP32-S3 with a native USB connector and a BOOT button",
    },

    firmware: {
      description: "Choose the firmware release and, if you like, a name for your key.",
      personalize: "Personalize your MultiKeys",
      listFailed: "The firmware list couldn't be loaded",
      checkConnection: "Check your internet connection.",
      noReleaseText: "Prebuilt firmware isn't published yet. Check back later or use the developer method from the README.",
      version: (version: string, date: string | null) => (date ? `Version ${version} · ${date}` : `Version ${version}`),
      openpgp: {
        title: "MultiKeys OpenPGP — not published",
        text: "Not available in the web installer; build it from source with the developer script.",
      },
      nameOptions: {
        keep: { title: "Don't change the name", text: `New keys show "${FALLBACK_DEFAULT_NAME}"; updated keys keep their current name.` },
        custom: { title: "Custom name", text: `Up to ${DEVICE_NAME_MAX} plain ASCII characters. Applied after the firmware is installed.` },
        default: { title: "Reset to the default name", text: `Sets the name back to "${FALLBACK_DEFAULT_NAME}".` },
      } satisfies Record<NameRequest["mode"], { title: string; text: string }>,
      customPreview: "Your custom name",
      currentPreview: "your key's current name",
      usbKey: "USB security key",
    },

    connect: {
      requestDescription: "Connect the board in download mode. Nothing is written yet.",
      readingDescription: "Reading the board and the firmware. Nothing is written yet.",
      chooseDevice: "Choose device",
      boot: {
        intro: "Put the board in download mode so it can receive new firmware:",
        sequence: [
          "Unplug the board from the computer.",
          "Press and hold the BOOT button.",
          "While holding BOOT, plug the board into the computer using the connector labelled USB or OTG.",
          "Let go of BOOT.",
          "Click “Choose device” below and pick “USB JTAG/serial debug unit” or an entry that mentions ESP32-S3, then click Connect.",
        ],
        rstTip: "Board with an RST button? You can also keep it plugged in: hold BOOT, press and release RST, then release BOOT.",
        notListed: "The board isn't in the list",
      },
      rows: {
        permission: "Device permission",
        granted: "Granted",
        chip: "Chip",
        flash: "Flash",
        flashUnknown: "unknown",
        psram: "PSRAM",
        psramUnused: (mb: string) => `${mb} MB, not used`,
        psramNone: "None — not required",
        profile: "Firmware profile",
        compatibility: "Compatibility",
        download: "Download",
        downloadProgress: "Download progress",
        downloaded: (done: string, total: string) => `${done} of ${total}`,
        checksums: "Checksums",
        verified: "Verified",
        storage: "Storage layout",
        storageRead: "Read (read-only)",
      },
    },

    review: {
      description: "Check what will happen. Nothing has been written yet.",
      confirm: "Install firmware",
      rows: { board: "Board", flash: "Flash", compatibility: "Compatibility", installMode: "Install mode" },
      keepName: "Keep current name",
      resetName: (name: string) => `Reset to ${name}`,
      buildLine: (title: string, version: string, tag: string) => `${title}, version ${version} (${tag})`,
      modes: {
        "first-install": "First installation",
        update: "Update",
        "update-unverified": "Update (stored keys not guaranteed)",
        "switch-image": "Switch to a different MultiKeys firmware",
        "replace-compatible-layout": "Replace the firmware on this board",
        repurpose: "Repurpose this board",
        blocked: "Blocked",
      } satisfies Record<InstallMode, string>,
      writes: {
        title: "What will be written",
        address: "Address",
        size: "Size",
        what: "What",
        clear: (role: string) => `Clear the ${role} area`,
        // Looked up by the manifest's role; an unknown role is shown as is.
        roles: { bootloader: "Bootloader", "partition-table": "Partition table", app: "MultiKeys app" } as Record<string, string>,
        neverTouched: (partitions: string[]) =>
          `Never touched: ${[...partitions.map((p) => (p === "part0" ? "part0 (your keys)" : p)), "eFuses (permanent chip settings)"].join(", ")}.`,
      },
      data: { title: "Your data", why: "Why:", risk },
      untested: {
        title: "Not tested on this board",
        expectedCompatible:
          "This is the build that runs on the tested ESP32-S3 N16R8, but this exact board hasn't been tested with MultiKeys. It passes every image check.",
        buildVerified: (size: string) =>
          `MultiKeys has only been tested on ESP32-S3 N16R8. This ${size} build compiles and passes every image check, but nobody has run it on a ${size} board yet.`,
      },
      before: {
        legend: "Before installing",
        acks: {
          "dev-firmware": "I understand this is experimental development firmware and not suitable for protecting important accounts.",
          "update-unverified": "I understand keys stored by the installed version may not be usable after this update.",
          "switch-image": "I understand data from the other MultiKeys firmware will not be usable.",
          "replace-layout": "I understand the firmware currently on this board will be replaced.",
          "untested-hardware": "I understand this board type hasn't been tested with MultiKeys",
        } satisfies Record<Exclude<AckId, "repurpose-typed">, string>,
        repurposeLabel: "Type REPURPOSE to confirm that the nvs and part0 areas will be erased",
      },
    },

    installing: {
      description: "Writing the firmware to the board.",
      cancelTip: "Stopping half-way would leave the board unable to start, so cancelling is disabled while writing.",
      warning: "Don't unplug the board or close this tab.",
      rows: { flashing: "Writing firmware", "verifying-flash": "Reading it back to verify", rebooting: "Restarting the board" },
      written: (done: string, total: string, pct: number) => `Written ${done} of ${total} (${pct}%)`,
      verifying: "Verifying…",
      note: "Cancelling is disabled while writing: stopping half-way would leave the board unable to start.",
    },

    finish: {
      doneDescription: "The firmware is installed.",
      writtenDescription: "The firmware is written. Replug the board to continue.",
      firstUse: "First use →",
      firmware: {
        verified: "Written and verified",
        notVerified: "Not verified",
        line: (title: string, version: string, profile: string) => `${title}, version ${version} · ${profile}`,
      },
      key: {
        title: "Running key",
        detected: "Detected",
        notConfirmed: "Not confirmed",
        notChecked: "Not checked",
        replug: "Now unplug the board and plug it back in, without holding BOOT.",
        replugWhy:
          "The board usually stays in installer mode until it is replugged. After that its serial port is gone and it appears as a security key instead; that is expected.",
        checkHint: (name: string, appliesName: boolean) =>
          `“Check my key” asks the browser to show the key; pick the entry named after your key (by default “${name}”).${appliesName ? " It then applies the name you chose; you will be asked to press BOOT on the key." : ""}`,
        skip: "Skip this check",
        detectedTitle: (name: string) => `Key detected: ${name}`,
        landing: (url: string | null) =>
          `Landing page: ${url ?? "not checked (the browser couldn't read it; that is common on Windows and harmless)"}`,
        unverifiedTitle: "Flash verified; running key not checked",
        unverifiedText: "Firmware written and verified; key not yet detected.",
      },
    },
  },

  firstUse: {
    title: "First use",
    lead: "Six short steps after the installer has finished.",
    reconnect: {
      title: "Reconnect",
      text: "The serial (COM) port you used for installing disappears. That is normal: the board now presents itself as a security key. Unplug it and plug it into the native USB connector (usually labelled USB or OTG).",
    },
    presence: {
      title: "The BOOT button is user presence",
      text: "When a website or your browser asks you to touch your security key, press the BOOT button once. There is no status light on this firmware, so watch the browser's prompt instead.",
    },
    pin: {
      title: "Set a FIDO PIN",
      text: "Your operating system or browser sets the PIN, not this site.",
      // `os` is the bold operating-system name with its colon, supplied by the page.
      windows: (os: ReactNode) => <>{os} Settings → Accounts → Sign-in options → Security key → Manage.</>,
      macos: (os: ReactNode) => <>{os} in Chrome or Edge, open Settings → Privacy and security → Security → Manage security keys.</>,
      linux: (os: ReactNode) => <>{os} in Chrome or Edge, open Settings → Privacy and security → Security → Manage security keys.</>,
    },
    check: { title: "Check your key", text: "Reads the key's USB name and landing page. Nothing is changed." },
    rename: {
      title: "Rename your key",
      text: "Choose the name your computer shows for the key. You will press BOOT on the key to confirm.",
    },
    tryPasskeys: {
      title: "Try your passkeys",
      text: "The Passkey lab registers a test passkey on your key and signs in with it, so you can see that the key works. Nothing leaves your computer.",
      cta: "Open the Passkey lab",
    },
    more: {
      title: "More about your key",
      register: {
        title: "Registering vs. signing in",
        text: "First add the key to an account (often under Security → Passkeys or Two-step verification → Security key). Later, when you sign in, the site asks for the key again and you press BOOT. Use a test account first: this is experimental firmware.",
      },
      pin: {
        title: "Why a site may ask for a PIN",
        intro: (
          <>
            Pressing BOOT proves someone is present. Some sites also want proof that it is <em>you</em>, which this key does with a PIN. Once a PIN is set, it can
            only be removed by resetting the key, which deletes every stored credential.
          </>
        ),
        read: (link: ReactNode) => <>Read {link} before setting one.</>,
        link: "how the PIN works",
      },
      recovery: {
        title: "Recovery",
        text: "If the key stops responding, put the board in download mode (unplug, hold BOOT, plug in, release) and run the installer again. It detects the existing MultiKeys installation and doesn't write the area that holds your keys.",
      },
    },
  },

  // The Passkey lab (pages/PasskeyLab): WebAuthn tests that run in the browser.
  passkeyLab: {
    title: "Passkey lab",
    lead: "Try your key as a passkey without making an account. This page registers a test passkey on your key and signs in with it, so you can see what the key reports.",
    localOnly: "Local test only: the checks run in your browser, and nothing is sent or saved anywhere. The test passkey stays on your key until you delete it (see Cleaning up).",
    pressBoot: "Press BOOT",
    doNotPress: "Don't press BOOT",
    keyVisual: {
      title: "ESP32-S3 board with the BOOT button highlighted",
      desc: "A development board seen from above. The BOOT button next to the USB connector is the one you press when the key asks for a touch.",
      idle: "Your key",
      success: "Done",
      failed: "Something is off",
    },
    testsLabel: "Passkey tests",
    scoreLabel: "Passkey tests passed",
    tests: {
      register: {
        title: "Register a passkey",
        text: "Creates a test passkey on your key for this site. Press BOOT when the browser asks.",
      },
      signIn: {
        title: "Sign in with this passkey",
        text: "Asks the key to sign a fresh challenge with the passkey you just made. Press BOOT; the page checks the signature.",
      },
      discoverable: {
        title: "Sign in without choosing",
        text: "No account is named: the key finds the passkey by itself, as a “Sign in with a passkey” button does. Press BOOT.",
      },
      refusal: {
        title: "Don't touch",
        text: "Do not press BOOT. Wait 15 s or cancel the browser's dialog. A key that signs without a touch would be unsafe, so this test passes when nothing is signed.",
      },
    },
    needsRegister: "Register a passkey first.",
    status: {
      notRun: "Not run",
      waiting: "Waiting for touch",
      waitingRefusal: "Waiting, don't touch",
      passed: "Passed",
      failed: "Failed",
    },
    run: "Run",
    runAgain: "Run again",
    score: (n: number, total: number) => `${n} of ${total} passed`,
    allPassed: {
      title: "Your key works as a passkey",
      text: "It registered a passkey, signed in with and without naming an account, and refused to sign without a touch.",
    },
    refusal: {
      passed: "Nothing was signed: the key waited for BOOT and the browser gave up.",
      failed: "A signature came back. If you did not press BOOT, the key does not enforce user presence.",
    },
    inspector: {
      title: "What your key reported",
      empty: "Run a test to see what the key reported.",
      flagsLabel: "Flags",
      flags: {
        up: { label: "UP", tip: "User present: the key was touched, which on this key means the BOOT button was pressed." },
        uv: { label: "UV", tip: "User verified: the key checked a PIN. Expected only if you set a FIDO PIN." },
        be: { label: "BE", tip: "Backup eligible: the passkey may be copied elsewhere. A passkey that lives on a hardware key normally is not." },
        bs: { label: "BS", tip: "Backed up: the passkey currently has a copy elsewhere. Normally off for a hardware key." },
      },
      aaguid: "AAGUID",
      algorithm: "Algorithm",
      counter: "Sign counter",
      transports: "Transports",
      none: "None reported",
      credentialId: "Credential ID",
      copy: "Copy credential ID",
      copied: "Copied",
      discoverable: "Stored on key (discoverable)",
      yes: "Yes",
      no: "No",
      unknown: "Unknown",
      checksLabel: "Checks",
    },
    checks: {
      clientData: "Browser data matches the request",
      rpId: "Bound to this site",
      signature: "Signature is valid",
      userPresence: "Key reported a touch (UP)",
      credential: "Same passkey as registered",
      counter: "Sign counter went up",
      residentKey: "Stored on the key",
    } satisfies Record<LabCheck["id"], string>,
    errors: {
      cancelledOrTimeout: {
        title: "No touch, or the request was cancelled",
        what: "The browser reports that the request timed out or was cancelled. That is what happens when BOOT is not pressed in time or the dialog is closed.",
        next: ["Run the test again and press BOOT when the browser asks.", "If the browser never asked, check that the key is plugged into the USB or OTG connector."],
      },
      alreadyRegistered: {
        title: "The key already has this passkey",
        what: "The key says it already holds a matching passkey.",
        next: ["Use the sign-in tests, or delete the old test passkey (see Cleaning up) and register again."],
      },
      notSupported: {
        title: "This browser or key can't do that",
        what: "The browser or the key doesn't support the kind of passkey this test asks for (an ES256 passkey stored on the key).",
        next: ["Use a current desktop version of Chrome or Edge.", "Check that the key runs the MultiKeys FIDO firmware."],
      },
      security: {
        title: "The browser blocked this page",
        what: "Passkeys only work on a secure page whose address matches the site they belong to.",
        next: ["Open https://multikeys.mewis.me directly instead of a copy or a proxy."],
      },
      verification: {
        title: "The key's answer failed a check",
        what: "The key answered, but a value it returned could not be read or verified.",
        next: ["Run the test again.", "If it keeps failing, report it on GitHub."],
      },
      unknown: {
        title: "The test failed",
        what: "The browser reported an error this page does not recognise.",
        next: ["Unplug the key, plug it in again and run the test again."],
      },
    } satisfies Record<LabErrorId, { title: string; what: string; next: string[] }>,
    cleanup: {
      title: "Cleaning up",
      intro: "A web page can't delete passkeys from your key. The test passkey stays on the key until you remove it yourself:",
      // `os` is the bold operating-system name with its colon, supplied by the page.
      windows: (os: ReactNode) => <>{os} Settings → Accounts → Sign-in options → Security key → Manage (this only offers resetting the whole key).</>,
      chrome: (os: ReactNode) => <>{os} open Settings → Privacy and security → Security → Manage security keys → Sign-in data.</>,
      cli: (list: ReactNode, remove: ReactNode) => (
        <>
          Command line: {list}, then {remove}. Both ask for the FIDO PIN.
        </>
      ),
    },
    notSupported: {
      title: "This browser can't do passkeys",
      text: "WebAuthn isn't available here. Use a current version of Chrome or Edge on a computer.",
    },
  },

  device: {
    nameField: { restore: "Restore default" },
    nameResult: {
      kept: "Not requested — current name kept",
      willSet: (name: string) => `Will be set to “${name}” when you check your key.`,
      willReset: (name: string) => `Will be reset to “${name}” when you check your key.`,
      talking: "Talking to your key…",
      reconnecting: "Waiting for your key to reconnect…",
      applied: (name: string) => `Applied and verified: ${name}`,
      pressBoot: "Press the BOOT button on your key now",
      secondsLeft: (n: number) => `${n} s left`,
      pinLabel: "Management PIN",
      pinHint: (min: number, max: number) => `This key has a management PIN (${min}–${max} characters). It is sent to the key and never stored.`,
      triesLeft: (n: number) => (n === 1 ? "1 try left" : `${n} tries left`),
      sendPin: "Send PIN",
      status: (code: string) => `(status ${code})`,
      cli: "Or rename it from the command line with the host tools:",
    },
    keyCheck: {
      unsupported: "This browser can't check USB devices; use Chrome or Edge.",
      notFound: "No key was selected or found. Plug it in without holding BOOT and try again.",
      found: (name: string) => `Found: ${name}`,
      landing: (url: string | null) => `Landing page: ${url ?? "not checked"}`,
    },
    renameKey: { apply: "Apply name", reset: "Reset to default" },
  },

  flasher: {
    whatToDo: "What to do",
    milestones: {
      downloaded: "Downloaded",
      integrityVerified: "Checksums verified",
      written: "Written",
      flashVerified: "Flash contents verified",
      deviceDetected: "Key detected",
      state: (label: string, ok: boolean) => `${label}: ${ok ? "yes" : "not confirmed"}`,
    },
  },

  boardDiagram: {
    title: "ESP32-S3 N16R8 development board, top view",
    desc: "The metal module at the top carries the N16R8 marking. At the bottom edge are two USB-C connectors: the one labelled USB or OTG is the one to use; the other is labelled UART or COM. The BOOT and RST buttons sit next to the connectors.",
    // The next five are SVG labels: keep each line short (about 15 characters).
    flashSize: "= flash size in MB",
    useThisOne: "use this one",
    bootLine1: "BOOT = the",
    bootLine2: "touch button",
  },

  errors,

  errorGroups: {
    Browser: "Browser",
    Connecting: "Connecting",
    Board: "Board",
    Firmware: "Firmware",
    Flashing: "Flashing",
    "After install": "After install",
    Personalization: "Personalization",
  } satisfies Record<ErrorGroup, string>,

  // How well a connected board is known to work (installer badges and the Releases page).
  support: {
    "hardware-verified": "Hardware verified",
    "expected-compatible": "Expected compatible — not tested on this exact board",
    "build-verified": "Build verified — not hardware tested",
  } satisfies Record<Support, string>,

  // The home page's compatibility table; rows mirror docs/HARDWARE.md.
  levels: {
    "hardware-verified": "Hardware verified",
    "build-verified": "Build verified",
    "expected-compatible": "Expected compatible",
    experimental: "Experimental",
    unsupported: "Unsupported",
  } satisfies Record<MatrixLevel, string>,

  matrix: {
    "esp32s3-n16r8": { hardware: "ESP32-S3 N16R8", detail: "16 MB quad flash, 8 MB PSRAM (unused)" },
    "esp32s3-16mb": { hardware: "Other ESP32-S3 with 16 MB quad flash", detail: "Native USB connector and a BOOT button on GPIO0" },
    "esp32s3-8mb": { hardware: "ESP32-S3 with 8 MB quad flash (N8, N8R2, N8R8)", detail: "Builds and passes every image check; not run on a board yet" },
    "esp32s3-4mb": { hardware: "ESP32-S3 with 4 MB quad flash (N4, N4R2)", detail: "Builds and passes every image check; not run on a board yet" },
    "esp32s3-2mb": { hardware: "ESP32-S3 with 2 MB flash", detail: "Does not fit the 3 MB storage layout" },
    "esp32s3-octal": { hardware: "Octal-flash modules (ESP32-S3-WROOM-2, e.g. N16R8V, N32R8V)", detail: "Only quad-SPI flash is supported" },
    "other-chips": { hardware: "ESP32, ESP32-S2, -C3, -C6, -H2", detail: "MultiKeys only runs on the ESP32-S3" },
    "no-native-usb": { hardware: "Boards without a native USB connector", detail: "The key talks to the computer through the chip's own USB" },
  } satisfies Record<MatrixRowId, { hardware: string; detail: string }>,

  nameProblems: {
    empty: `Enter a name (1–${DEVICE_NAME_MAX} characters).`,
    "too-long": `Use at most ${DEVICE_NAME_MAX} characters.`,
    "not-ascii": "Use plain ASCII letters, digits, spaces and punctuation only (no accents or emoji).",
    "edge-space": "Remove spaces at the start or end.",
  } satisfies Record<NameProblem, string>,
};

export type Messages = typeof en;
