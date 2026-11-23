# 2026-11-23: build info (MKAUTH INS 07) and passkey events on a real key

Date: 2026-11-23. Board: the same ESP32-S3 N16R8 as the earlier reports (MAC 80:b5:4e:c8:22:78, chip revision v0.2, 16 MB quad flash,
8 MB PSRAM), Windows 11, desktop Chrome (WebUSB). Tools: `multikey` 0.3.0 built from this tree (`host/target/debug/multikey.exe`, no
elevation: build info uses PC/SC and the event stream uses the WinUSB interface, neither needs it), esptool from ESP-IDF v5.5.6.
Firmware: `fido` dev image, real pins, `build-fido-dev`, version stamp `0.3.0-dev`, built from commit `281fae077113` with uncommitted
changes (the work under test): the new `INS 07` command and `patches/pico-fido/0004-multikey-wcid-event-size.patch`.

The owner approved on a form, per operation: the flash of the local image (update in place), the read-only checks afterwards, and one
Passkey lab session. Written: `0x0` bootloader, `0x8000` partition table, `0x20000` app, nothing else. Not done: no eFuse, no `part0`
write, no FIDO PIN set, no `authenticatorReset`, no MKAUTH enrolment, no `--ci-pins` image, no image from a release.

Fuse state: not read in this session (that needs the board in download mode again). The image has no irreversible option:
`tools/check_no_irreversible.py fido-dev` printed PASS for it, and the new code only reads (`esp_flash_encryption_enabled`,
`esp_secure_boot_enabled`); the link map has the same 12 informational eFuse references as the image before this change.

## Hardware verified

| # | What | How | Result |
|---|---|---|---|
| 1 | Probe before writing | `esptool chip_id`, `flash_id` over the native port in download mode (303A:1001, COM6) | ESP32-S3 (QFN56) revision v0.2, PSRAM 8 MB, MAC 80:b5:4e:c8:22:78, flash 16 MB, "Flash type set in eFuse: quad" |
| 2 | Firmware before the flash: `device build`, `device version` | read-only | `device build` exits 1 with "this firmware does not report its build (INS 07); update the firmware"; `device version` prints `firmware : not reported (...)` and the note explaining that firmware from before the command cannot report it |
| 3 | Event stream of the firmware before the flash | `device watch --timeout 2` | claimed the WinUSB interface without elevation and decoded three events queued from earlier use: two BOOT waits for a sign-in and `FAILED signing in on multikeys.mewis.me: operation denied (0x27)` (printed with the read time, which is why backlog is marked `earlier` since). A second run read none: reading drains the queue |
| 4 | Flash | `esptool --chip esp32s3 -p COM6 -b 460800 --before default_reset --after watchdog_reset write_flash @flash_args` | 21,904 bytes at 0x0, 3,072 at 0x8000, 625,568 at 0x20000; "Hash of data verified" for each; watchdog reset |
| 5 | Enumeration after the flash | `tools/usb_identity.py` | 303A:4002, product `Mew's Security Key` (the stored name survived the flash), interfaces FIDO, Keyboard, CCID, WinUSB |
| 6 | `device build` on the new firmware | read-only | `multikey-fido 0.3.0-dev (ESP-IDF v5.5.6)`, commit `281fae077113+dirty`, flash built for 16MB and chip reports 16 MB, `ESP32-S3 revision 0.02, 2 core(s)`, flash encryption off, secure boot off, `power-on, up 24 s`, running from `factory at 0x20000` |
| 7 | The reported image hash is the file's hash | `sha256sum build-fido-dev/multikey-fido.bin` against the line `image sha-256` | both `8318c91c0996b487322674a90c50d56d87d737e1636405a38728871fa9d216b9`: the key hashed the flash it runs and got the SHA-256 of the file that was written |
| 8 | Match against a manifest | image packaged with `package_firmware.py` as release `local`, then `device build --manifest build-localfw-bi/firmware-manifest.json` | `published : IS the app image of local 0.3.0-dev (esp32s3-16mb-fido-dev, 16MB)` |
| 9 | No match against another release | `device build --manifest build-rel/firmware-manifest.json` (v0.3.0) | `published : NOT in ../build-rel/firmware-manifest.json: a local, modified or other release's image` |
| 10 | Live events on the new firmware | `device watch --json` while the owner ran the Passkey lab on `http://localhost:5173/passkeys` (register, sign in, discoverable sign in) | 8 events decoded, table below |
| 11 | The web page against the real key | `http://localhost:5173/key`, `MULTIKEYS_LOCAL_FIRMWARE=../build-localfw-bi`, Chrome's WebUSB chooser, "Connect key", "Start watching"; the owner reported what the page showed | connected; the firmware card read "Exactly the image published as local (16MB)"; the activity list showed the registration, the lookups, the sign-ins with "2 passkey khớp", and, under "Reported when you connected" without a time, one BOOT wait that the key had queued before the page listened (the owner's page was in Vietnamese; the strings are the Vietnamese ones of `messages/vi.tsx`) |

Events of row 10, as printed by the CLI (times UTC, fields with no value omitted):

| Time | `op` / `result` | Fields |
|---|---|---|
| 10:56:08 | `button_wait` / pending | rp `localhost`, waiting for `make_credential` |
| 10:56:09 | `make_credential` / ok | rp `localhost`, user `passkey-lab-test` ("MultiKeys test passkey"), ES256, user present, user verified |
| 10:56:22 | `get_assertion` / ok | `localhost`, `passkey-lab-test`, user verified, **no user presence**, 1 credential |
| 10:56:22 | `button_wait` / pending | `localhost`, waiting for `get_assertion` |
| 10:56:24 | `get_assertion` / ok | user present, user verified, 1 credential |
| 10:56:32 | `get_assertion` / ok | no user presence, user verified, 1 credential |
| 10:56:32 | `button_wait` / pending | `localhost`, waiting for `get_assertion` |
| 10:56:33 | `get_assertion` / ok | user present, user verified, 1 credential |

## Findings

- **The browser looks a passkey up before it asks for a touch.** Each sign-in began with a `get_assertion` that the key reported as `ok` with
  the user-presence flag clear (Windows/Chrome send `up=false` to find out whether a credential exists), then a BOOT wait, then the real
  assertion. Labelling the first as "signed in" would have been wrong; the CLI and the web page now say "passkey LOOKED UP / Looked up a
  passkey ... (no button press)" for a sign-in event without presence.
- **The user-verified flag is not proof of a PIN.** It was set on the registration and on every sign-in, including the lookups without presence,
  for a page that asked for `userVerification: "discouraged"`. Whether this key had a FIDO PIN was not checked in this run (it needs an elevated
  terminal), so the label "PIN verified" that the first version of the web page and the CLI used was withdrawn: they say "user verified". The
  firmware sets the flag from its PIN/UV-token state (`getUserVerifiedFlagValue`); why that state was true here was not investigated.
- **The Passkey lab leaves a passkey behind on every registration.** It was run twice (once for the CLI capture, once for the web page), so the
  key now holds at least two discoverable test credentials for `localhost` (user `passkey-lab-test`); the page's "2 passkeys matched" is that.
  They stay until `authenticatorReset` or a deletion with a FIDO PIN (`multikey fido credentials delete`).
- **The failure path was seen on the old firmware only.** The queued `operation denied (0x27)` event of row 3 shows a failed sign-in reaches the
  host with its CTAP2 code. In the web round the owner's pasted list has no failure event (whether the "don't touch" test ran to the end before
  the list was copied is not known); the first CLI capture had ended by timeout before that test. The decoder, the CLI line and the web row for a
  failure are unit and e2e tested only against built frames.
- **Patch 0004 was only exercised with short text.** Every event above fits the old 64-byte buffer too. That a long RP id, user name and display
  name now arrive cut instead of lost is verified by code reading and the build, not on the key.
- The reset reason read `power-on` after esptool's watchdog reset; not investigated.
- A key that has just been flashed answered `device build` on the first try, with no retry or delay.

## State of the key afterwards

Flashed with the local `0.3.0-dev` image (stored name `Mew's Security Key` kept). MKAUTH not enrolled (`mkauth status` before and after). FIDO PIN:
not read. Discoverable credentials: at least two Passkey-lab credentials for `localhost` created in this session; others were not listed.

## Status after this report

`INS 07` and the event stream: **Hardware verified** on one board (Windows 11, Chrome) for build info (rows 6-9, 11) and for success events
(rows 10-11); failure events on hardware: observed on the previous firmware only; truncation of long text: **Not verified on hardware**.
