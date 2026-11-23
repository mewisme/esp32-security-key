# 2026-11-23 — web installer, first hardware run

**Scope:** one install through the web installer on one board, on Windows with Chrome. It was served by the local dev server
(`MULTIKEYS_LOCAL_FIRMWARE=../build-localfw pnpm dev`) from commit `54a6a57`. This was not the deployed site and not a
published release.

| Item | Value |
|---|---|
| Board | ESP32-S3 N16R8 devkit, MAC `80:b5:4e:c8:22:78` (same board as the earlier reports) |
| State before | Pre-0.2.0 development FIDO firmware with a matching partition table; no FIDO PIN, 0 credentials, MKAUTH not enrolled |
| Firmware | `multikey-firmware-v0.2.0-dev-esp32s3-n16r8-fido-dev.zip`, sha256 `994f48b2fb7d37aa0f94dd5f1287095c7808fa3676613bcab2162d9d12278d4b`, packaged with `tools/package_firmware.py` (manifest tag `local`) |
| Browser / OS | Chrome, Windows 11 |
| Operator | The maintainer operated the browser and the board, including the serial chooser and the BOOT button |

## Result

| Step | Observed |
|---|---|
| Install type on the Confirm screen | "Update (stored keys not guaranteed)", i.e. `update-unverified`. This is expected: the installed pre-0.2.0 firmware declares no compatible data version |
| Writes listed | only 0x00000 (bootloader), 0x08000 (partition table), 0x20000 (app); the operator was told to cancel if anything else appeared and did not need to |
| Install, read-back verification | completed without an error panel |
| Reboot | **the board did not come back by itself; the operator had to replug it.** This matches the earlier finding that esptool's `hard_reset` leaves the native port in download mode (`docs/FLASHING_ADVANCED.md`). The reconnect step now tells the user to replug |
| "Check my key" (WebUSB) | key detected |
| `tools/usb_identity.py` (afterwards, read-only) | `MultiKeys Security Key`; HID FIDO, HID keyboard, CCID (Usbccid), WinUSB; PC/SC reader present |
| `tools/check_usb_descriptors.py --live` | PASS: BOS 57 bytes, 2 capabilities, landing URL `https://multikeys.mewis.me`. This proves the new firmware is running, because the old firmware advertised the GitHub URL |
| `multikey fido info` (elevated) | FIDO_2_0..2_3, AAGUID `0a63b994-8ba6-5e74-9e5a-0f894cc35c4d`, `clientPin=false` |
| `multikey device info` (elevated) | MKAUTH protocol v1, `enrolled=false`, name `MultiKeys Security Key (default)` |

## Not covered

- The first-install, switch-image, replace-compatible-layout and repurpose modes on hardware.
- A credential-persistence check across the update. The board held no credentials before the install.
- The deployed Worker. Downloads came from the dev-server plugin, not from GitHub releases through the Worker.
- Other browsers or operating systems, the UART-bridge path, and disconnect or error paths on hardware.

## Changes made because of this run

- `web/src/components/flasher/ReconnectStep.tsx`: replugging is now the primary instruction, not a fallback.
- `web/src/lib/status.ts`: `INSTALLER_HARDWARE_VERIFIED = true`. README and ROADMAP were updated to this scope.
