# Beginner UX audit

Question: can someone who has an ESP32-S3 N16R8 board, a desktop computer and Chrome/Edge — but no ESP-IDF, Python, Rust or
Git — get a working MultiKeys key from this repository?

**Answer before this work: no.** Every path required ESP-IDF, Python and Git, and no firmware was published. This audit lists
each step of the journey, what blocked a beginner, and what changed. References marked `@b60c31a` point at the repository
as it was before the change (commit `b60c31a`); others point at the current tree.

**No beginner end-to-end install has been tested.** The web installer has unit tests, e2e tests with a simulated board
(Playwright) and one hardware run by the maintainer (update path, one board, local dev server:
[hw-reports/2026-11-23-web-installer.md](hw-reports/2026-11-23-web-installer.md)); it runs on a staging URL, not yet on multikeys.mewis.me. Statuses below use the project vocabulary
(Implemented / Build verified / Unit tested / Integration tested / Hardware verified / Not implemented).

| Step | User goal | Prior knowledge required (before) | Missing information (before) | Failure a beginner hits | Recovery difficulty | Severity | Source reference | Correction | Status after this work |
|---|---|---|---|---|---|---|---|---|---|
| README | Understand what this is and whether it is for them | Firmware/ESP-IDF vocabulary: the first screen talked about images, CTAP2, CCID, Kconfig | A plain statement of what the key does and who it is for | Leaves, or follows developer instructions they cannot complete | — | High | `README.md:1-32 @b60c31a` | README rewritten: what it is, hardware, warning, install, first use, troubleshooting first; jargon moved into a `<details>` developer section | Implemented |
| Hardware | Know whether their board works | What "N16R8", "native USB OTG" and "GPIO0" mean | How to read the module marking; which connector is which; what is unsupported | Buys/uses a 4/8 MB or non-S3 board, or uses the UART connector | Medium (needs another board) | High | `README.md:3-4,75-81 @b60c31a`, `docs/HARDWARE.md:1-8` | README "Supported hardware" in plain words; compatibility levels table in `docs/HARDWARE.md` and on the site; board diagram with the module marking and connector labels; installer checks chip and flash size electronically | Implemented |
| Install links | Find "the install button" | — | There was none: the only path was "Flash in 3 steps" with ESP-IDF | Stops at "install ESP-IDF v5.5.6" | High | Blocker | `README.md:34-56 @b60c31a` | Prominent "Install MultiKeys → multikeys.mewis.me" link, then the developer script, then manual; README states the site is not live yet and the installer's hardware coverage (one run) | Implemented; site not deployed |
| Releases | Download something that runs | That releases contained host tools only | Firmware availability | Downloads `multikey.exe`, finds it can't install firmware | Medium | High | `docs/RELEASES.md:3 @b60c31a`, `README.md:73,85-86 @b60c31a` ("once a release exists", outdated: v0.1.0 existed) | One release per version carries host tools + firmware + manifest from v0.2.0; README/RELEASES state v0.1.0 = host tools only | Implemented; v0.2.0 published with 6 assets, checksums verified after download |
| Firmware download | Get a firmware file | Building with ESP-IDF | No prebuilt image existed | Cannot proceed without a toolchain | High | Blocker | `docs/RELEASES.md:3 @b60c31a` | `multikey-firmware-v<ver>-esp32s3-n16r8-fido-dev.zip` with `README.txt`, `SHA256SUMS`, `NOTICE.txt`; `firmware-manifest.json` | Implemented, unit tested; published in v0.2.0 (the published zip itself has not been flashed) |
| Web flasher | Install without tools | — | No web flasher existed | — | — | Blocker | — | `web/`: guided wizard (welcome, hardware, firmware, connect, checks, confirmation, install, verify, first use) | Implemented, unit + e2e tested (simulated board); one hardware run (update path); deployed to staging only |
| USB connection | Get the board into download mode and pick it | Download mode, COM ports, BOOT+RST | Which connector, which chooser entry, power-only cables | Empty chooser, wrong port, "failed to connect" | Medium | High | `README.md:58-67 @b60c31a` (troubleshooting assumed the script) | Illustrated sequence in the Connect step; chooser help (power-only cable, wrong connector, several boards); `not-download-mode` error with steps and retry; UART-port notice | Implemented, e2e tested |
| First install | Write firmware safely | What a partition table is | What will be written, what is kept | Fear of bricking; no idea what is overwritten | — | Medium | `docs/FLASHING_ADVANCED.md:40-46` | Confirmation screen lists every write (address, size, purpose), what is never touched, data risk in plain words, required acknowledgements | Implemented, e2e tested |
| Updates | Update without losing keys | That `part0` holds credentials and is preserved only with a matching layout | Whether an update keeps keys | Unsure; or the script refuses for a non-obvious reason | Medium | Medium | `tools/flash_dev.py:434 @b60c31a` | Install modes: update within the declared compatible range; outside it (e.g. 0.1.0-dev firmware has no data-compatibility declaration) an explicit acknowledgement; firmware version now stamped into the app descriptor | Implemented, unit tested |
| Post-install | Know it worked and how to use it | That the COM port disappears; that BOOT is the touch button | Registration vs sign-in, PIN trade-off, no LED | Thinks the install failed when the COM port vanishes | Low | Medium | `README.md:66-67 @b60c31a` | "Reconnect & verify" step with milestones (downloaded, checksums, written, flash verified, key detected) and an optional read-only key check; `/first-use` page | Implemented, e2e tested |
| Troubleshooting | Fix a failure | Reading esptool/PowerShell output | Plain-language causes and next steps | Stuck on a raw error | Medium | High | `README.md:58-69 @b60c31a` | Error catalog with 24 plain-language errors, next steps, retry where it helps, technical details collapsed; `/help` page anchored by error | Implemented, unit + e2e tested |
| Recovery | Reuse a board that had factory/demo firmware | That the script refuses foreign partition tables and why | Any instructions: no doc explained erasing or repurposing | Script stops with "storage-safety stop"; no way forward | High | High | `tools/flash_dev.py:434 @b60c31a`; no erase guidance anywhere in `docs/` | Web installer "Repurpose this board" (typed `REPURPOSE`, clears only `nvs` and `part0`, never full-chip erase); manual `erase_region` instructions in `docs/FLASHING_ADVANCED.md` | Implemented, e2e tested |

## Remaining gaps

- Hardware coverage of the web installer is one update on one board. First install, switch, replace and repurpose modes
  were not run on hardware. esptool-js's `hard_reset` left the board in download mode (as it did for the developer script,
  which uses `watchdog_reset`); the installer now tells the user to replug, which worked in that run.
- Production site: https://multikeys.mewis.me is not attached yet; the installer runs at
  https://multikeys-web-staging.mewisme.workers.dev (staging).
- The published v0.2.0 firmware zip has not itself been flashed; the hardware run used an equivalent local 0.2.0-dev build.
- No usability test with an actual beginner.
- Only desktop Chromium browsers can install (Web Serial); Firefox/Safari/mobile users get an explanation, not an install.
