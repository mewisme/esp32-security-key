# Web installer update and browser rename report 2026-11-23

- Board: ESP32-S3 N16R8 devkit (16 MB quad flash, 8 MB PSRAM), native USB connector, one board, the one of the earlier reports.
- Image: fido   Config: dev   Profile: esp32s3-16mb
- Firmware: local build `build-localfw` (manifest schema 2, tag `local`, version `0.2.0-dev`, `source_commit` field
  `5964a08de0da…`), 16 MB package `multikey-firmware-v0.2.0-dev-esp32s3-16mb-fido-dev.zip`, 430713 bytes,
  sha256 `d2f0ef4d124c9d7f82a560c00a9631048c466ba7572a00c1f3450d65a9b74c5a`. It was built from the working tree on top of 5964a08
  before the profile commit `f23e03b`; between the two nothing that goes into the firmware changed (`git diff 5964a08 f23e03b` over
  `components patches CMakeLists.txt sdkconfig.* partitions*.csv dependencies.lock` is empty; only the board file was renamed).
  ESP-IDF v5.5.6.
- Host: Windows 11, desktop Chrome driven by the board's owner (version not recorded), Chromium 159.0.8154.6 driven by the author
  (Playwright), Python 3.14 with pyusb 1.3.1 and libusb-package, `multikey` host CLI from `host/target/debug`.
- Pages: the dev server of `web/` (`MULTIKEYS_LOCAL_FIRMWARE=../build-localfw pnpm dev`, `http://localhost:5173`) for phases 1-3, then the
  staging Worker `https://multikeys-web-staging.mewisme.workers.dev` (version `b9e3cdb2-401d-40ac-8b08-e8291ecd5e84`, built from commit
  `1c905dc`) for the final check.
- GPIO pins used: button=0 (BOOT, active low) led=none (`boards/esp32s3-boot-button.board`)
- Approvals asked and given before each write: web flash, name write, reset to the default name, a diagnostic round, a browser-level
  reproduction, and a final check on staging. No eFuse, no FIDO PIN, no `authenticatorReset`, no MKAUTH enrollment was touched.

## What was and was not verified

| Claim | Evidence | Status |
|---|---|---|
| Web flash of the 16 MB build (update of a running 0.2.0-dev) | the owner reports the installer reached Finish with "Written and verified"; the key then enumerated and answered MKAUTH. The six on-screen values the owner was asked to tick (flash `16MB · quad`, PSRAM, profile, compatibility, install mode, the three writes) were **not** ticked, so they are not confirmed on hardware; no independent flash read-back was made | partial: flash outcome user-reported, screen contents unconfirmed |
| Name write from the browser (installer Finish stage) | page said "Applied and verified: Mew's Security Key"; read-only checks of the key agree (below) | Hardware verified |
| Reset to the default name and set again from the browser, shipped bundle on staging | the owner reports "Applied and verified" for both; read-only checks of the key agree | Hardware verified (one board, Windows 11, Chrome) |
| First attempt of "Reset to default" on First use | page showed "The BOOT button wasn't pressed in time" although the key had been reset and had re-enumerated | **FAIL (page bug), fixed in `1c905dc`** |
| 4 MB and 8 MB builds, other boards, Linux/macOS | not run | not tested |
| Browser rename of a key with a management PIN | the key is not enrolled, so only the simulated key covers it | not tested on hardware |

## Commands run and raw output (verbatim; lines removed are named)

### 1. Before (read-only)

```
> multikey device show
device name     : MultiKeys Security Key (default)
pending         : false
rename enabled  : true
> multikey device info
device           : [0] HID -; reader "MultiKeys MultiKeys Security Key CCID 0"
MKAUTH           : protocol v1, enrolled=false
device name      : MultiKeys Security Key (default)
> python tools/usb_identity.py
iProduct (bus reported)   : 'MultiKeys Security Key'
  MI_00 iInterface       : 'MultiKeys Security Key FIDO'                 Windows shows 'USB Input Device' [HIDClass]
  MI_01 iInterface       : 'MultiKeys Security Key Keyboard'             Windows shows 'USB Input Device' [HIDClass]
  MI_02 iInterface       : 'MultiKeys Security Key CCID'                 Windows shows 'Microsoft Usbccid Smartcard Reader (WUDF)' [SmartCardReader]
  MI_03 iInterface       : ''                                            Windows shows 'WinUsb Device' [USBDevice]
```

### 2. Phase 1: web flash and name write (owner, Chrome, `/install`, custom name "Mew's Security Key"), then read-only checks

```
> multikey device show
device name     : Mew's Security Key (custom)
pending         : false
rename enabled  : true
> python tools/usb_identity.py --expect-product "Mew's Security Key"
iProduct (bus reported)   : "Mew's Security Key"
  MI_00 iInterface       : "Mew's Security Key FIDO"                     Windows shows 'USB Input Device' [HIDClass]
  MI_01 iInterface       : "Mew's Security Key Keyboard"                 Windows shows 'USB Input Device' [HIDClass]
  MI_02 iInterface       : "Mew's Security Key CCID"                     Windows shows 'Microsoft Usbccid Smartcard Reader (WUDF)' [SmartCardReader]
  MI_03 iInterface       : ''                                            Windows shows 'WinUsb Device' [USBDevice]
PASS  product_matches_expected
> python tools/check_usb_descriptors.py --live
landing URL: https://multikeys.mewis.me
MS OS 2.0 set: 178 bytes
PASS
```

### 3. Phase 2: "Reset to default" on First use (owner, Chrome, dev server): FAIL

Owner's note, verbatim: "The BOOT button wasn't pressed in time\n\nThe BOOT button wasn't pressed within 15 seconds; the name was not changed.\n\nnó hiển
thị warning này nhưng thực tế thì nó đã đổi rồi" (Vietnamese: it shows this warning but in fact it has already changed). Read-only check right afterwards:

```
> multikey device show
device name     : MultiKeys Security Key (default)
pending         : false
> python tools/usb_identity.py --expect-product "MultiKeys Security Key"
iProduct (bus reported)   : 'MultiKeys Security Key'   ... PASS  product_matches_expected
```

The owner added, verbatim: "both apply name and reset to default, after i pressed boot, it process in many seconds then maybe reboot my board and my
board start with new name, but web return the boot button wasnot pressed in the time, i dont know why. please add animation anywhere if needed".

### 4. Diagnosis

Read-only WebCCID probe over libusb (IccPowerOn, SELECT, name GET, GET_INFO, ten more GETs): every answer 9.9-10.1 ms.

Write probe over libusb (`build-diag/webccid_write_probe.py`, not committed; round A without touching BOOT, B and C with a BOOT press at the cue).
Round B started from the default name, so it re-enumerated the key without changing the name; round C set "Mew's Security Key":

```
[   0.246 s] start state: flags=0x04 name='MultiKeys Security Key'
[   0.247 s] OUT seq=3 CLEAR P2=0 (no press expected)
[   0.256 s]   IN  type=0x7f len=3 seq=0 b7=0x00 at +0.010 s 030003
[   1.756 s]   time extension #1 at +1.510 s
 ... (#2 .. #8 every 1.510 s)
[  13.836 s]   time extension #9 at +13.589 s
[  15.276 s]   IN  type=0x80 len=2 seq=3 b7=0x00 at +15.029 s 6300
[  15.276 s] Round A result: sw=6300 after 15.03 s
[  16.517 s] OUT seq=3 B: CLEAR (reset to default), P2=1
[  17.656 s]   IN  type=0x80 len=25 seq=3 b7=0x00 at +1.139 s 044d756c74694b65797320536563757269747920
[  18.012 s]   device gone at +0.36 s
[  19.345 s]   device back at +1.69 s
[  21.086 s] after: flags=0x04 name='MultiKeys Security Key' custom=False (expected custom=False)
[  22.326 s] OUT seq=3 C: SET Mew's Security Key, P2=1
[  23.165 s]   IN  type=0x80 len=21 seq=3 b7=0x00 at +0.840 s 074d65772773205365637572697479204b657990
[  23.520 s]   device gone at +0.35 s
[  24.852 s]   device back at +1.69 s
[  26.595 s] after: flags=0x05 name="Mew's Security Key" custom=True (expected custom=True)
```

So the firmware answers within a second of the press and the whole sequence works over libusb (with a pause after the key comes back).

Chromium window driven by the author, with temporary timestamped logging in the page (not committed), "Reset to default"; the key was
pressed by the owner at about 5.9 s. Lines removed: `transferIn pending`, the chooser lines:

```
[3.406 s] status press-button
[3.406 s] send 8006020101 timeout=25000
[6.276 s] IN type=0x80 seq=4 b7=0x0 len=25 064d756c74694b657973205365637572
[6.276 s] send done sw=9000
[6.276 s] status reconnecting
[6.855 s] usb disconnect event 7822C84EB5800000
[8.063 s] usb connect event 7822C84EB5800000 MultiKeys Security Key
[8.063 s] send 00a4040008 timeout=5000
[8.064 s] claimed interface 3 in 2 out 2
[8.064 s] OUT type=0x62 seq=0 len=0
[8.065 s] IN type=0x80 seq=0 b7=0x0 len=24 3bfe1800008131fe458031815448534d
[8.065 s] OUT type=0x6f seq=1 len=13 00a4040008
[13.070 s] TIMEOUT transmit 5000
[13.119 s] RESULT: BOOT button wasn't pressed in time
```

The key had answered the write with `9000` and re-enumerated; the page's first SELECT, sent 1 ms after the connect event, was never answered
(the IccPowerOn before it was) and the 5 s timeout was mapped to "BOOT button wasn't pressed". The same page with a 1 s pause and the repeat logic
(Chromium, "Apply name"):

```
[18.049 s] send done sw=9000
[18.049 s] status reconnecting
[18.643 s] usb disconnect event 7822C84EB5800000
[19.854 s] usb connect event 7822C84EB5800000 Mew's Security Key
[19.854 s] status connecting
[20.857 s] send 00a4040008 timeout=2000
[20.869 s] send done sw=9000
[20.879 s] IN type=0x80 seq=2 b7=0x0 len=21 054d6577277320536563757269747920
[20.919 s] RESULT: Applied and verified: Mew's Security Key
```

Cause of the unanswered command: not established by a trace. Hypothesis from reading `pico-keys-sdk/src/usb/usb.c` (`card_start` / `card_exit` flush
queued commands when another interface sends one, and Windows' smart-card stack probes the CCID interface right after enumeration), recorded in
`docs/PROTOCOLS.md` as unconfirmed.

### 5. Final check on staging (owner, Chrome, shipped bundle, commit `1c905dc`) and read-only checks

Owner's report: "Reset: Applied and verified: MultiKeys Security Key", "Set: Applied and verified: Mew's Security Key".

```
> multikey device show
device name     : Mew's Security Key (custom)
pending         : false
rename enabled  : true
> multikey device info
MKAUTH           : protocol v1, enrolled=false
device name      : Mew's Security Key (custom)
> python tools/usb_identity.py --expect-product "Mew's Security Key"   ... PASS  product_matches_expected
> python tools/check_usb_descriptors.py --live                          ... PASS
```

## Result

partial. PASS: name write, reset and set again from the browser on one board (Windows 11, Chrome), shipped bundle on staging; the key ended with the
custom name, unenrolled, no FIDO PIN set by this session. FAIL kept: the first "Reset to default" showed a wrong error (fixed). Not verified: the on-screen
values of the web flash, 4 and 8 MB boards, other operating systems, a key with a management PIN.

Notes: the owner was at the board and pressed BOOT at every cue; some of the presses were made on prompts of the Chromium window I opened, which
changed the key's name between my read-only checks (the first write probe found the custom name, the second run found the default one). Every
state quoted above was read from the key at the time.
