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
import { DEVICE_NAME_MAX, type NameProblem } from "@/lib/device/device-name";
import type { NameRequest } from "@/lib/device/mkauth";
import type { ErrorCode, ErrorGroup, ErrorText } from "@/lib/errors/catalog";
import type { AckId, InstallMode, TypedAckId } from "@/lib/flashing/install-mode";
import type { AppUpdateOutcome, AppUpdateReason, TypedUpdateAckId, UpdateAckId } from "@/lib/flashing/app-update";
import type { UpdateVerdict } from "@/lib/flashing/update-report";
import type { UpdateStep } from "@/lib/update-steps";
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
  "unknown-flash-mode": {
    title: "The flash type couldn't be read",
    what: "The board's flash interface (quad or octal) couldn't be read, so nothing can tell that this firmware matches the board. Nothing was written.",
    next: [DOWNLOAD_MODE, "Press Try again. If it keeps failing, check that the module isn't an octal-flash part such as N16R8V."],
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
  "update-forced": (from) =>
    `Warning: the installed firmware is outside the range this release declares it can read (from version ${from}). The installer rewrites the bootloader, partition table and app but not the storage area (part0). The keys stored there may stop working or be lost. Back up first.`,
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
    nav: { install: "Install", update: "Update", firstUse: "First use", passkeys: "Passkeys", keyInfo: "Your key", help: "Help", releases: "Releases" },
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
    updateFirmware: "Update firmware",
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
    images: {
      title: "Two firmware images",
      note: "A key runs one image at a time, FIDO2 or OpenPGP. They are separate builds: to switch, install the other one.",
      fido: {
        title: "FIDO2",
        text: "Passkeys and WebAuthn sign-in, with a BOOT-button press for every use. The image the installer offers first.",
        status: "Hardware verified on 16 MB",
      },
      openpgp: {
        title: "OpenPGP",
        text: "An OpenPGP smart card (GnuPG sign, decrypt, authenticate) and PIV over CCID. Read the warning in the installer before choosing it.",
        status: "Experimental",
      },
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
    search: {
      label: "Search help",
      placeholder: "Search by message or error code",
      clear: "Clear search",
      results: (n: number) => (n === 1 ? "1 entry" : `${n} entries`),
      emptyTitle: "Nothing matches that search",
      emptyText: "Try a shorter word, or clear the search to see every entry.",
    },
  },

  notFound: {
    title: "Page not found",
    text: "That address doesn't exist on this site.",
    home: "Go home",
    help: "Open Help",
  },

  releases: {
    title: "Releases",
    intro: (link: ReactNode) => <>Download MultiKeys firmware and see what each release contains. Releases are published on {link}.</>,
    githubReleases: "GitHub Releases",
    loadingLatest: "Loading latest release",
    allReleases: "All releases",
    skipped: (n: number) => `${n} release(s) skipped because their manifest failed validation:`,
    history: "Release history",
    unpublished: "unpublished",
    loadFailed: "The release list couldn't be loaded",
    copy: "Copy",
    copied: "Copied",
    imageNames: { fido: "FIDO2", openpgp: "OpenPGP" } satisfies Record<"fido" | "openpgp", string>,
    facts: (images: string, sizes: string, chip: string) => `${images} · ${sizes} · ${chip}`,
    installCta: "Install firmware",
    updateCta: "Update firmware",
    sourceCommit: "Source commit",
    downloadsTitle: "Download firmware",
    firmwareType: "Firmware type",
    flashSize: "Flash size",
    version: "Version",
    copySha: "Copy SHA-256",
    notAvailable: (image: string, size: string, tag: string) => `${tag} has no ${image} build for ${size} of flash.`,
    noReleaseHas: (image: string, size: string) => `No release in the list has a ${image} build for ${size} of flash.`,
    showRelease: (tag: string) => `Show ${tag}`,
    showFirmware: "Firmware",
    showFirmwareFor: (tag: string) => `Show the firmware of ${tag}`,
    scope: (link: ReactNode) => (
      <>
        This list holds the newest 10 releases that carry firmware. Releases that only hold host tools (those before v0.2.0, for instance) or whose manifest failed validation are not in it; the full history is on {link}.
      </>
    ),
    details: {
      sha256: "SHA-256",
      board: "Board",
      chip: "Chip",
      flash: "Flash",
      psram: "PSRAM",
      psramRequired: "required",
      psramOptional: "not required",
      idf: "ESP-IDF",
      usb: "USB ID",
      layout: "Partition layout",
      presence: "User-presence button",
      manifest: "Manifest",
      schemaCurrent: "Schema 2",
      schemaLegacy: "Schema 1 (legacy)",
    },
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
      latest: "Latest",
      chooseVersion: "Choose another version",
      released: (date: string) => `Released ${date}`,
      flashSizes: (sizes: string) => `${sizes} · board size is detected in the next step`,
      imageLegend: "Firmware type",
      experimental: "Experimental",
      openpgpUnavailable: "An OpenPGP image has not been published for this release.",
      images: {
        fido: {
          title: "MultiKeys FIDO2",
          text: "Passkeys, FIDO2/U2F security key with the BOOT button as user presence. The recommended image.",
        },
        openpgp: {
          title: "MultiKeys OpenPGP",
          text: "OpenPGP smart card (GnuPG: sign, decrypt, authenticate) and PIV over CCID. A separate image: it replaces FIDO2.",
        },
      },
      openpgpWarning: {
        title: "Read this before choosing OpenPGP",
        items: [
          "Experimental: built and checked, but not yet run on real hardware.",
          "No FIDO2 or passkeys while it is installed, and no device renaming.",
          "It is a separate firmware, not an add-on. Changing between it and FIDO2 makes the other one's stored keys unusable.",
          "Default PINs apply until you change them (user 123456, admin 12345678).",
        ],
      },
      nameOptions: {
        keep: { title: "Keep current" },
        custom: { title: "Custom name" },
        default: { title: "Default" },
      } satisfies Record<NameRequest["mode"], { title: string }>,
      nameHints: {
        keep: (defaultName: string) =>
          `The name already on the key is preserved. A key that has none yet uses the firmware default, “${defaultName}”. Nothing is read until your key is connected.`,
        custom: `Up to ${DEVICE_NAME_MAX} plain ASCII characters, no space at the start or end. Applied after the firmware is installed.`,
        default: (defaultName: string) => `The USB product name is set to the firmware default, “${defaultName}”.`,
      },
      preview: {
        title: "USB identity",
        notApplied: "Not applied yet",
        keep: "Current name kept",
        custom: "Your custom name",
        vidPid: (vidPid: string) => `USB ${vidPid}`,
      },
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
        "update-forced": "Forced update (outside the declared range)",
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
      switchWarning: {
        title: "FIDO2 and OpenPGP keep separate data",
        text: "Both firmwares use the same storage area (part0), but each one reads it in its own format. Nothing is erased by this installer, yet the keys and credentials made by the firmware being replaced will not be usable, and may be overwritten once the new firmware starts. Back up what you need first. Switching back later means installing the other firmware again; the credentials do not return.",
      },
      data: { title: "Your data", why: "Why:", risk },
      updateHint: {
        title: "A smaller update is available",
        text: "This key already runs MultiKeys. The Update firmware page replaces only the application and leaves the bootloader and the partition table alone.",
        link: "Open Update firmware",
      },
      untested: {
        title: "Not tested on this board",
        referenceConfig:
          "This board reports the same flash size and PSRAM as the tested ESP32-S3 N16R8, so it gets the build that was hardware verified on that board. Nothing in the board identifies it as that unit, and this exact board hasn't been tested with MultiKeys.",
        expectedCompatible:
          "This is the build that runs on the tested ESP32-S3 N16R8, but this exact board hasn't been tested with MultiKeys. It passes every image check.",
        buildVerified: (size: string) =>
          `MultiKeys has only been tested on ESP32-S3 N16R8. This ${size} build compiles and passes every image check, but nobody has run it on a ${size} board yet.`,
      },
      before: {
        legend: "Before installing",
        acks: {
          "dev-firmware": "I understand this is experimental development firmware and not suitable for protecting important accounts.",
          "switch-image": "I understand data from the other MultiKeys firmware will not be usable.",
          "experimental-image":
            "I understand the OpenPGP firmware is experimental, has not been tested on hardware, and is not suitable for keys I rely on.",
          "replace-layout": "I understand the firmware currently on this board will be replaced.",
          "untested-hardware": "I understand this exact board hasn't been tested with MultiKeys",
          "force-storage":
            "I understand this release is not shown to read the keys stored on this board. The keys are not erased by the installer, but they may become unusable or be lost, and the old firmware may not return them. I have backed up what I need.",
        } satisfies Record<Exclude<AckId, TypedAckId>, string>,
        typedLabels: {
          "repurpose-typed": "Type REPURPOSE to confirm that the nvs and part0 areas will be erased",
          "switch-image-typed": "Type SWITCH to confirm that you are changing between the FIDO2 and OpenPGP firmware",
          "force-typed": "Type FORCE to confirm that you are installing over keys this release is not known to read",
        } satisfies Record<TypedAckId, string>,
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
        unverifiedTitle: "Flash verified; running key not checked",
        unverifiedText: "Firmware written and verified; key not yet detected.",
      },
      openpgp: {
        title: "Flash verified. The OpenPGP card is not checked from the browser.",
        text: "This image has no WebUSB page and cannot be renamed. Plug it into the native USB connector and read the card with GnuPG (it needs a smart-card service: pcscd on Linux, built in on Windows):",
        pins: "Change the default PINs (user 123456, admin 12345678) before generating keys: gpg --edit-card, admin, passwd. This image is experimental and has not been run on hardware yet.",
        replugHint: "After the replug the board appears as a smart-card reader (CCID), not as a security key.",
        done: "I replugged it",
      },
    },
  },

  update: {
    title: "Update firmware",
    lead: "Replace only the MultiKeys application on a key that already runs MultiKeys. The bootloader, the partition table and the storage areas (part0 holds your credentials, PIN and name) are not written.",
    steps: {
      connect: "Connect key",
      check: "Check for updates",
      review: "Review",
      update: "Update",
      verify: "Verify",
    } satisfies Record<UpdateStep, string>,
    stepper: {
      label: "Update progress",
      completed: ", completed",
      stepOf: (n: number, total: number) => `Step ${n} of ${total}`,
    },
    notAtomic: {
      title: "Not atomic, no rollback",
      text: "The application is written into a single slot. If the write is interrupted, the key cannot start until this update is run again from download mode. This is not an over-the-air update and it cannot undo itself.",
    },
    connect: {
      description: "Read what the key runs now. This is read-only: no button press, no PIN, nothing is written.",
      hint: "Plug the key in normally (not in download mode), click “Choose key” and pick the MultiKeys entry.",
      choose: "Choose key",
      reading: "Reading the key…",
      notChosen: "No key was chosen.",
      failed: "The key could not be read over WebUSB. Its firmware may be too old, or another program may be using it.",
      unsupported: "This browser cannot talk to the key over WebUSB.",
      skip: "Continue without reading the key",
      skipNote: "Without this reading the page cannot compare the key before and after the update.",
      reported: "The key reports",
      rows: { firmware: "Firmware", commit: "Commit", image: "Image SHA-256", name: "USB name", pin: "Management PIN" },
      pinSet: "Set up",
      pinNotSet: "Not set up",
      unreadable: "Not readable",
      outdated: "This firmware is older than v0.3.1 and cannot report its build. Its version is read in download mode instead.",
    },
    check: {
      description: "Choose the version to update to. Only releases newer than the one on the key are listed; the one right after it is selected first.",
      loading: "Loading releases…",
      installed: "Installed",
      offered: "Offered",
      notRead: "Not read yet",
      versionLine: (title: string, version: string, tag: string) => `${title}, version ${version} (${tag})`,
      upToDate: { title: "Already up to date", text: "The application on the key is byte-identical to the newest release. Nothing to update." },
      unsupported: {
        title: "This release has no application-only update",
        text: (tag: string) =>
          `Release ${tag} was published before application-only updates existed, so it does not declare that one is safe. The installer can still update the key; it rewrites the bootloader and partition table as well and keeps part0.`,
      },
      noRelease: "No release has a build for this firmware.",
      nothingNewer: "No published release is newer than the version on the key.",
      useInstaller: "Open the installer",
    },
    review: {
      bootDescription: "Put the key in download mode. Nothing is written yet.",
      workingDescription: "Reading the key and the release. Nothing is written yet.",
      rows: { connect: "Key in download mode", download: "Download and verify the release", read: "Read the key (read-only)" },
      description: "Check what will happen. Nothing has been written yet.",
      confirm: "Update application",
      table: { installed: "Installed", offered: "New version", type: "Update type", flash: "Flash" },
      type: "Application-only update",
      unreadable: "Not readable",
      untouched:
        "Never touched: bootloader, partition table, nvs, phy_init, part0 (your credentials, PIN and name), eFuses (permanent chip settings).",
      data: {
        title: "Your data",
        text: "This update is designed to keep your credentials, PIN and key name: they live in part0, which is not written. This page cannot read them, so it does not promise they are intact; after the update it checks what it can.",
      },
      labels: {
        "safe-update": "Compatible",
        repair: "Repair",
        "already-current": "Up to date",
        downgrade: "Downgrade",
        incompatible: "Incompatible",
        unknown: "Not shown safe",
        "different-family": "Other firmware",
        "not-multikeys": "Not MultiKeys",
        "release-unsupported": "Not offered",
      } satisfies Record<AppUpdateOutcome, string>,
      outcomes: {
        ok: { title: "Compatible update", text: "This release declares that it can use the data stored by the installed version. Only the application is replaced." },
        "interrupted-write": {
          title: "An earlier update did not finish",
          text: "This browser recorded an application write of this same release that was started and never verified, on a chip with the same MAC address as this one. Writing the application again repairs it. Nothing else is written.",
        },
        "same-version-different-image": {
          title: "Same version, different content",
          text: "The installed application has this version number but its content differs from the published build. Writing the published build replaces only the application.",
        },
        current: { title: "Already up to date", text: "The application on the key is byte-identical to this release. There is nothing to write." },
        downgrade: {
          title: "That would be a downgrade",
          text: "The installed version is newer than this release. Downgrades are not offered, because the newer version may have changed how it stores data. Nothing was written.",
        },
        storage: {
          title: "Stored data not shown compatible",
          text: "The installed version is older than the oldest version this release declares compatible, so the keys it stored may not be usable. Nothing was written.",
        },
        layout: {
          title: "Different storage layout",
          text: "The partition table on this key is not the one this release uses, so an application-only update cannot be shown safe. Nothing was written.",
        },
        "app-too-large": { title: "The application does not fit", text: "The new application is larger than the app partition on this key. Nothing was written." },
        "protected-overlap": {
          title: "The write would reach protected storage",
          text: "The update was refused because its write would touch the bootloader, the partition table or a storage area. Nothing was written.",
        },
        "flash-profile": {
          title: "Different flash size",
          text: "The bootloader on this key was built for a different flash size than this build. Nothing was written.",
        },
        "different-family": {
          title: "The other MultiKeys firmware",
          text: "The key runs the other MultiKeys firmware (FIDO2 or OpenPGP). Switching changes how stored data is read, so it is not an application-only update. The installer can switch after you confirm it. Nothing was written.",
        },
        "different-key": {
          title: "This is not the key you read",
          text: "The key in download mode reports another version, firmware or flash size than the key read in the first step. Unplug other keys and start over. Nothing was written.",
        },
        "not-multikeys": {
          title: "Not a MultiKeys key",
          text: "This board does not run MultiKeys, or its flash is empty. An update replaces an existing MultiKeys application; use the installer for anything else. Nothing was written.",
        },
        "release-unsupported": {
          title: "This release has no application-only update",
          text: "A release must declare that the update is safe, and this one does not. Use the installer, or wait for a newer release. Nothing was written.",
        },
        "unreadable-bootloader": { title: "The bootloader could not be read", text: "The first bytes of the flash are not a valid bootloader image. Nothing was written." },
        "unreadable-descriptor": {
          title: "The installed application could not be read",
          text: "The key has no readable application description. That can follow an interrupted write, but this browser has no record of one, so nothing was written.",
        },
        "recovery-unverified": {
          title: "Recovery cannot be tied to this chip",
          text: "The key has no readable application, and this browser has a record of an interrupted write. That record cannot be matched to this chip, release and image, so nothing was written. This page can't link the running key to the chip in download mode, so it only repairs a chip it saw the write start on. To recover, use the installer: it replaces the firmware after you confirm, keeps the key storage when the partition table is intact, and warns when it is not. If the record is old or belongs to another key, discard it.",
        },
        "unparsable-version": {
          title: "The installed version is not a version number",
          text: "It cannot be compared with this release, so compatibility cannot be shown. Nothing was written.",
        },
      } satisfies Record<AppUpdateReason, { title: string; text: string }>,
      openInstaller: "Open the installer",
      discardRecord: "Discard the record and start over",
      seeReleases: "See releases",
      before: {
        legend: "Before updating",
        acks: {
          "update-confirm":
            "I understand that only the MultiKeys application is replaced, that the write is not atomic, and that an interrupted write means running this update again.",
          "untested-hardware": "I understand this exact board hasn't been tested with MultiKeys",
          "experimental-image":
            "I understand the OpenPGP firmware is experimental, has not been tested on hardware, and is not suitable for keys I rely on.",
        } satisfies Record<Exclude<UpdateAckId, TypedUpdateAckId>, string>,
        typedLabels: {
          "repair-typed": "Type REPAIR to confirm that the application will be written again",
        } satisfies Record<TypedUpdateAckId, string>,
      },
    },
    updating: {
      description: "Writing the application only. The bootloader, partition table and storage are not written.",
    },
    verify: {
      replugDescription: "The application is written and verified. Replug the key to check it.",
      checking: "Checking the key…",
      doneDescription: "The update has finished. This is what the page could check.",
      table: { check: "Check", result: "Result" },
      rows: {
        image: "Running image matches the release",
        version: "Version matches the release",
        name: "USB name unchanged",
        mkauth: "Management PIN state and device id unchanged",
        fido: "FIDO credentials and PIN",
      },
      results: { yes: "Verified", no: "Does not match", unknown: "Not checked" },
      fidoNote: "Not read by this page. To use a credential, run the optional passkey test.",
      passkeyTest: "Open the passkey test",
      verdicts: {
        verified: { title: "Update verified", text: "The key runs the published image and kept its name and management PIN state." },
        partial: { title: "Update written; some checks were not possible", text: "Everything that could be read matches. The rows marked not checked could not be compared." },
        unchecked: { title: "Update written; the key was not checked", text: "The flash was verified when it was written. The running key was not read." },
        mismatch: { title: "The key does not match what was expected", text: "Something differs from the release or from the key before the update. Replug the key and check again; if it persists, see the details below." },
      } satisfies Record<UpdateVerdict, { title: string; text: string }>,
      again: "Update another key",
    },
    failed: {
      recoveryTitle: "If the key does not start",
      recoveryText:
        "The application may be partly written. Put the key in download mode and run this update again: it rewrites only the application. This browser keeps a record of the unfinished write so the update can offer that repair.",
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
    check: { title: "Check your key", text: "The Your key page shows which firmware the key runs and what it reports. It only reads: nothing is changed.", cta: "Open Your key" },
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
    renameKey: { apply: "Apply name", reset: "Reset to default" },
  },

  keyInfo: {
    title: "Your key",
    intro:
      "See which firmware your MultiKeys key runs and what its passkeys are doing, read straight from the key. This page only reads: nothing on the key is changed.",
    unsupported: "This browser can't reach USB devices; use desktop Chrome or Edge.",
    connect: {
      title: "Connect your key",
      description: "Plug it into the native USB connector, then choose it in the browser's device list.",
      button: "Connect key",
      connecting: "Connecting…",
      connected: (name: string) => `Connected: ${name}`,
      notChosen: "No key was chosen. Plug it in without holding BOOT and try again.",
      disconnect: "Disconnect",
    },
    firmware: {
      title: "Firmware on this key",
      description: "What the key itself reports. Its MAC address and serial number are not read.",
      reading: "Reading the key…",
      readAgain: "Read again",
      outdatedTitle: "This firmware can't say what it is",
      outdatedBody: "It was built before keys could report their build. Install a newer release to see its version and commit here.",
      installLink: "Install a newer release",
      failedTitle: "Couldn't read the firmware",
      failedBody: "The key did not answer on its management interface. Unplug it, plug it in again without holding BOOT, and try again.",
      rows: {
        firmware: "Firmware",
        commit: "Source commit",
        image: "Image SHA-256",
        flash: "Flash",
        chip: "Chip",
        security: "Security",
        boot: "This boot",
        partition: "Running from",
      },
      flash: (built: string, chip: string) => `built for ${built}, the chip reports ${chip}`,
      chip: (name: string, revision: string, cores: number) => `${name} revision ${revision}, ${cores === 1 ? "1 core" : `${cores} cores`}`,
      security: (encryption: string, secureBoot: string) => `flash encryption ${encryption}, secure boot ${secureBoot}`,
      on: "on",
      off: "off",
      notReported: "not reported",
      boot: (reason: string, uptime: string) => `${reason}, up ${uptime}`,
      dirty: "Built from files with uncommitted changes.",
      copy: "Copy",
      copied: "Copied",
    },
    published: {
      checking: "Comparing with the published releases…",
      matches: (tag: string, flash: string) => `Exactly the image published as ${tag} (${flash})`,
      noMatch: "Not the image of any published release",
      noMatchHint: "It may be a local or modified build, or a release this page could not load. That is not proof of tampering.",
      catalogFailed: "The release list could not be loaded, so the image could not be compared.",
    },
    activity: {
      title: "Passkey activity",
      description: "Every passkey registered or used on this key, as the key reports it. Keep this page open while you use your passkeys.",
      start: "Start watching",
      stop: "Stop watching",
      watching: "Watching for passkey activity…",
      idle: "Not watching.",
      empty: "Nothing yet. Register or use a passkey on any site and it appears here.",
      earlierTitle: "Reported when you connected",
      earlierNote: "The key kept these while nobody was listening, so when they happened is unknown.",
      liveTitle: "While you watched",
      watchStopped: "Watching stopped because the key stopped answering. Connect again.",
      unknownSite: "(unknown site)",
      created: (site: string) => `Passkey created for ${site}`,
      signedIn: (site: string) => `Signed in to ${site}`,
      lookedUp: (site: string) => `Looked up a passkey for ${site} (no button press)`,
      waitCreate: (site: string) => `Waiting for the BOOT button to create a passkey on ${site}`,
      waitSignIn: (site: string) => `Waiting for the BOOT button to sign in to ${site}`,
      waitOther: (site: string) => `Waiting for the BOOT button on ${site}`,
      failedCreate: (site: string) => `Creating a passkey on ${site} failed`,
      failedSignIn: (site: string) => `Signing in to ${site} failed`,
      failedOther: (site: string) => `An operation on ${site} failed`,
      account: (name: string) => `Account: ${name}`,
      buttonPressed: "Button pressed",
      noButton: "No button press",
      userVerified: "User verified",
      matched: (n: number) => `${n} passkeys matched`,
    },
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
    "reference-config": "Same configuration as the hardware-verified N16R8 — this board itself isn't identified",
    "expected-compatible": "Expected compatible — not tested on this exact board",
    "build-verified": "Build verified — not hardware tested",
  } satisfies Record<Support, string>,

  // Whether a release's manifest carries a valid signature (installer and updater review tables).
  authentication: {
    row: "Release signature",
    signed: "Signed",
    unsigned: "Not authenticated",
    unsignedNote:
      "This release has no signature. Its checksums show that the files match its manifest, not who published it.",
  },

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
