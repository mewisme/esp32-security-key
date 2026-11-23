# `multikey` command reference

`multikey` has three groups plus `readers`. The key exposes two independent interfaces and the tool addresses them separately:

| Group | Interface | Transport | Used for |
|---|---|---|---|
| `fido` | FIDO2/CTAP2 | USB HID | GetInfo, FIDO PIN, credential management |
| `mkauth` | MKAUTH v1 applet | CCID / PC/SC | enroll/auth/revoke (PAM login key), device name |
| `device` | both | both | inventory, combined info/status/version, naming |

## Command matrix

| Command | Reads / changes | `--json` | Needs |
|---|---|---|---|
| `device list` | reads (enumeration only) | yes | - |
| `device build [--manifest FILE]` | reads what firmware the key runs (INS 07; read-only) and optionally checks it against a release manifest | yes | PC/SC |
| `device watch [--usb VID:PID] [--count N] [--timeout S]` | reads passkey activity pushed by the key (one JSON object per line with `--json`) | yes | USB (the vendor interface) |
| `device info` / `status` / `version` | reads (GetInfo, SELECT, GET_INFO, PIN retries) | yes | - |
| `device show` | reads the device name | no | PC/SC |
| `device rename NAME [--reenumerate]` / `reset-name` / `reenumerate` | changes the USB name (button; MKAUTH PIN once enrolled) | no | PC/SC |
| `fido info`, `fido pin status` | reads | yes | HID |
| `fido pin set [--yes] [--pin-stdin]` | **sets the FIDO PIN** (see below) | no | HID, PIN |
| `fido pin change [--pin-stdin]` | changes the FIDO PIN (one attempt) | no | HID, PIN |
| `fido credentials list [--pin-stdin]` | reads discoverable credentials | yes | HID, PIN set |
| `fido credentials delete --id HEX [--yes] [--pin-stdin]` | deletes one credential (`--pin-stdin` needs `--yes`) | no | HID, PIN |
| `mkauth status`, `mkauth list` | reads | yes | PC/SC / trust store |
| `mkauth enroll --user U [--yes]` | creates the device key, sets the MKAUTH PIN, writes the trust store | no | PC/SC, button |
| `mkauth auth --user U [--timeout S]` | challenge-response | no | PC/SC, button |
| `mkauth revoke --user U` | deletes the device key | no | PC/SC, PIN, button |
| `readers` | lists PC/SC readers | yes | PC/SC |
| legacy `status`, `enroll`, `auth`, `list`, `revoke` | hidden aliases of the `mkauth` commands | read-only ones | first-match reader (`--reader`) |

The `mkauth enroll|auth|list|revoke` commands (and the legacy aliases) also take `--trust-store PATH` (default: `/etc/multikey/trusted.toml` on Linux,
`%ProgramData%\MultiKeys\trusted.toml` on Windows with a fallback to the legacy `%ProgramData%\MultiKey\trusted.toml`).

`--json` on any other command is refused with exit 2 before anything is sent. JSON is pretty-printed with stable snake_case field
names on stdout; prompts, warnings and the "touch the key" hint go to stderr.

## Choosing a device

With one key attached nothing is needed. With several, `device`, `fido` and `mkauth` commands **refuse to guess**: they print the
candidates and exit 2. Pick with `--device N` (the number from `multikey device list`), `--reader TEXT` (substring of the PC/SC reader
name) or `--hid-path PATH`; at most one of them. The legacy top-level commands keep the old first-match behavior and accept only `--reader`.

PC/SC exposes no serial number, so a HID interface and a reader are paired only when that is unambiguous: the reader name contains the
HID product name (the firmware names its interfaces `<name> FIDO`, `<name> CCID`), that name occurs once among the HID interfaces and the
reader name occurs once. Otherwise `device list` shows them as separate, unpaired entries. A key that shows up on only one transport is
still listed (`HID -` or `reader -`).

## Windows and FIDO HID

Windows lets only **elevated** processes open FIDO HID devices; from a normal terminal the FIDO interface is not visible at all
(the existing hardware tools needed `tools/run_elevated.ps1` for the same reason). If `multikey device list` shows a reader but `HID -`,
run `multikey fido ...` and `multikey device info` from an Administrator terminal. `mkauth` and the PC/SC side need no elevation.
On Linux, hidraw access needs a udev rule (or the `plugdev` group) for the key's VID:PID.

## The FIDO PIN is persistent

`fido pin set` is deliberately hard to run by accident. Before any PIN is read it checks the device state (a PIN that is already set
exits 2 and points at `pin change`), prints a warning, and requires typing `set pin` (or `--yes`, which `--pin-stdin` also requires;
without a terminal and without `--yes` it exits 2). The warning says:

- on this firmware a PIN ends touch-only use: browsers will ask for the PIN and the key is PIN-protected (`docs/FIDO_UV.md`);
- it can only be removed by `authenticatorReset`, which deletes every credential;
- it is the FIDO PIN, not the MKAUTH management PIN.

After the PIN command succeeds the tool reads the state back and reports success only if `clientPin` is now true. A wrong PIN in `pin
change` or `credentials ...` costs one retry; the tool never retries by itself, reports the remaining attempts, and warns when 3 or fewer
remain. PINs are read without echo (or one line from stdin with `--pin-stdin`), held in zeroizing buffers, never logged and never
part of any error text (tests assert this).

`credentials delete` lists the match, shows relying party and user, requires typing `delete` (or `--yes`), deletes, lists again and
prints "deleted and verified absent" only when the credential is gone. Credential management needs a PIN, so these commands only work
on a key that has one.

## Hardware status

On one board (Windows 11, elevated terminal for HID) the commands above were run against a real key, see
[hw-reports/2026-11-23-management-cli-and-webusb.md](hw-reports/2026-11-23-management-cli-and-webusb.md). Interactive typed confirmations
and no-echo FIDO PIN prompts were only unit-tested (the hardware runs used `--yes --pin-stdin`); Linux and macOS were not tested.

## `device version`

Reports the tool version, the MKAUTH protocol version byte, the firmware build the key reports about itself (see `device build`), the CTAP
`firmwareVersion` from GetInfo and the USB identity. That `firmwareVersion` is the upstream pico-fido core version, not the MultiKeys
version. A key whose firmware was built before the BUILD_INFO command (INS 07) cannot report its build: the tool says so and why
(`firmware_error` in `--json`) instead of guessing.

## `device build`

`multikey device build [--manifest FILE] [--json]` asks the key what it is running (MKAUTH INS 07, read-only, no button, no PIN): the
project and version, the ESP-IDF version, the source commit (12 hex digits, `+dirty` when the tree had uncommitted changes), the SHA-256
of the app image as flashed, the flash size it was built for and the chip reports, the chip and its revision, whether flash encryption
and Secure Boot are on, why and how long ago this boot started, and the partition it runs from. The MAC address and serial number are
not read.

`--manifest` takes a release's `firmware-manifest.json` (`gh release download vX.Y.Z -p firmware-manifest.json`) and says whether the
running image is exactly the app image of one of its builds. A match proves the key runs that published image; no match means a local,
modified or other release's image (it is not proof of tampering). The output ends with the matched release and build, or with
"NOT in <file>".

## `device watch`

`multikey device watch [--usb VID:PID] [--count N] [--timeout SECONDS] [--json]` prints passkey activity as the key reports it: every
registration (`passkey CREATED (ES256) for github.com as alice [user present, user verified]`), sign-in, and BOOT-button wait, and
every failure with its CTAP2 error (`FAILED signing in on example.org: no credentials (0x2e)`). With `--json` it prints one JSON object
per line (`op`, `result`, `rp_id`, `user_name`, `algorithm_name`, `user_present`, `user_verified`, `error_name`, `waiting_for`, `time_utc`,
`backlog`).

It claims the key's vendor-class (WinUSB) interface directly, so it needs no PC/SC and no HID rights, but only one program can hold the
interface: close the web page "Your key" first. On Linux the process needs access to the USB device (a udev rule for `303a:4002`).
Events the key had queued before the command started arrive first and are marked `earlier` (`backlog: true`) because their time is
unknown; everything after the first quiet half second is stamped with the time it was read (UTC). Text from a site is printed with
control and direction-override characters replaced. The events are described in `docs/PROTOCOLS.md` ("Live events") and what they expose
in `docs/SECURITY.md`.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | ok |
| 1 | failure |
| 2 | usage, ambiguous device selection, or an operation refused before anything was sent |
| 3 | no device, or PC/SC / HID unavailable |
| 4 | button not pressed in time (or user presence denied) |
| 5 | wrong PIN (remaining retries are printed) |
| 6 | PIN blocked or PIN entry temporarily blocked |
| 130 | cancelled at a prompt (EOF or a declined confirmation); nothing was changed |

Each `multikey` invocation is a fresh process and a fresh CTAPHID channel, which sidesteps the open same-channel `CTAPHID_CANCEL`
issue documented in `docs/FIDO_UV.md`.

## Operating systems

| OS | Supported | Notes |
|---|---|---|
| Windows 10/11 x86_64 | yes (prebuilt, statically linked CRT) | winscard for PC/SC; elevation for FIDO HID |
| Linux x86_64 | yes (prebuilt, built on Ubuntu 22.04) | `libpcsclite1`, `libudev1`, `pcscd`; hidraw permissions |
| Linux ARM64, Windows ARM64, macOS | not built, not claimed | `cargo build` may work; untested |
