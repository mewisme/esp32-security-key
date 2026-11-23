# USB identity, device name and FIDO authenticator identity

Status words: **hardware** = observed on the board, **source** = read from code, **inference** = reasoning, not observed.
Report with the raw outputs: `docs/hw-reports/2026-11-23-uv-and-identity.md`.

## Where every identity string comes from

| What the host shows | Source | Configurable |
|---|---|---|
| USB VID:PID | `MULTIKEY_USB_VID` / `MULTIKEY_USB_PID` (placeholder `303A:4002`, development only) | Kconfig. A persisted upstream `phy_data` VID/PID (rescue interface) would override it; not set on this key |
| iManufacturer | `MULTIKEY_USB_MANUFACTURER` (default `MultiKeys`) | Kconfig only |
| iProduct (device name) | `MULTIKEY_USB_PRODUCT_NAME` (default `MultiKeys Security Key`) **or the user name stored by MKAUTH INS 06** | Kconfig default, user rename at run time |
| iSerialNumber | derived from the chip (`pico_serial_str`; the board's reads `7822C84EB5800000`) | no |
| iInterface: FIDO HID, keyboard HID, CCID | `<name> FIDO` / `<name> Keyboard` / `<name> CCID`; the name is shortened (never the suffix) to fit 31 characters | follows the name |
| iInterface: WinUSB (WebCCID) | **none**: esp_tinyusb keeps only 8 string slots (0..7), the WinUSB interface would be index 8, so Windows uses its generic name | not possible without patching the managed component |
| PC/SC reader name | `<iManufacturer> <CCID iInterface> <index>`, e.g. `MultiKeys MultiKeys Security Key CCID 0` | follows manufacturer and name |
| Windows Device Manager names (`USB Composite Device`, `USB Input Device`, `Microsoft Usbccid Smartcard Reader (WUDF)`, `WinUsb Device`) | the Windows drivers' INF names, **not** the device's strings | no |
| python-fido2 / libfido2 "product" | the FIDO HID interface string (`<name> FIDO`): hardware: `'MultiKeys Security Key FIDO'` | follows the name |
| `phy_data.usb_product` (upstream persisted override) | **ignored on ESP builds**. It can only be written through the upstream rescue applet; honouring it would create a second, unauthenticated rename path and make `reset-name` unable to restore the default | removed from the picture on purpose |
| Upstream branding (`Pol Henarejos`, `Pico Key`, `HID Interface`) | removed from the ESP descriptors (patch `pico-keys-sdk/0001`, `0003`); the binary no longer contains them | |

esp_tinyusb converts string descriptors byte for byte (`_desc_str[1+i] = str[i]`, 31 character buffer), so **only printable ASCII
(0x20..0x7E, 1..31 characters, no leading/trailing space) is representable**. Non-ASCII UTF-8 would be silently corrupted, so it is
rejected: by the Rust CLI (`NameError::NotPrintableAscii`), by the firmware (`multikey_name_valid`, status `6A80`) and by the
build for the Kconfig strings (`components/multikey_platform/CMakeLists.txt`).

## Configurable defaults (Kconfig, menu "MultiKey board and USB identity")

`CONFIG_MULTIKEY_USB_MANUFACTURER`, `CONFIG_MULTIKEY_USB_PRODUCT_NAME`, `CONFIG_MULTIKEY_USB_CUSTOM_NAME_ENABLED` (y), and
`CONFIG_MULTIKEY_AAGUID`. The host tool finds the key by `multikey` or `esp32` in the reader name; the manufacturer is part of the
reader name and a rename does not change it, so renaming never hides the device from `multikey`. If you change the manufacturer
to something without "MultiKey", pass `--reader`.

## Renaming at run time

```
multikey device show                         # name, custom or default, pending re-enumeration, rename enabled
multikey device rename "Mew's Security Key"  # button press; MKAUTH PIN too once the device is enrolled
multikey device rename "Name" --reenumerate  # ...and re-attach USB right away (reader/HID reappear for ~1.5 s)
multikey device reenumerate                  # apply a stored name now (button; PIN once enrolled)
multikey device reset-name [--reenumerate]   # back to MULTIKEY_USB_PRODUCT_NAME
```

Protocol: MKAUTH INS `06` (docs/PROTOCOLS.md). Properties:

- **Authorization.** Read: none. Change: a BOOT press always; the MKAUTH PIN as well once MKAUTH is enrolled. An unenrolled key has
  no PIN, so a press is the only possible check. A host that can reach the key can therefore rename an unenrolled key after a
  press; the name is a label only (it grants nothing, changes no key, and VID/PID/AAGUID stay as built), see SECURITY.md.
  The FIDO PIN is not used for this: the MKAUTH applet cannot verify it.
- **Persistence.** The name lives in its own flash file `0xBC01`. Hardware: it survives reboot/replug and a firmware reflash (a name
  stored by one build was shown by the next build right after flashing). By code inspection only (not run): it also survives MKAUTH
  revoke (`cmd_revoke` deletes only `0xBC00`) and `authenticatorReset` (`fido_reset_should_clear` does not list prefix `0xBC`).
  Only `reset-name` removes it.
- **When it applies.** Strings are built at boot and rebuilt in place after a rename, so the next enumeration reports the new
  name; `reenumerate` forces one by detaching and re-attaching the USB pull-up (`tud_disconnect`/`tud_connect`).
- **Never touched:** private keys, credentials, PINs, the FIDO/MKAUTH state, VID/PID, AAGUID, the attestation certificate.
- A firmware built with `MULTIKEY_USB_CUSTOM_NAME_ENABLED=n` answers read-only requests and refuses changes (`6985`), and the
  CLI says so.

### Windows behaviour (hardware, Windows 11)

- The bus-reported strings (`DEVPKEY_Device_BusReportedDeviceDesc`, shown by `python tools/usb_identity.py`) changed at every
  enumeration for the same device instance; no stale string was observed after a firmware change or a stored-name change.
- The driver-provided names in Device Manager never change (table above), so the new name is seen in the PC/SC reader name,
  `usb_identity.py` output, Device Manager > Details > "Bus reported device description" and FIDO tools, not in the main
  Device Manager tree.
- USB descriptor caching: Windows keeps a per-device-instance registry entry (keyed by VID/PID/serial); the generic names above
  are stored there. Nothing in this test required clearing it. If a tool still shows an old name, unplug and replug (or
  `multikey device reenumerate`), and as a last resort remove the device instance in Device Manager.

## WebUSB landing page

The BOS descriptor advertises a WebUSB landing page so Chromium-based browsers can show a notification that links to the project page
when the key is plugged in. It is only a link: the device never fetches it and the page gets no access to the key.

| Kconfig | Default | Meaning |
|---|---|---|
| `MULTIKEY_WEBUSB_LANDING_ENABLED` | `y` | `n` removes the WebUSB capability from the BOS descriptor (BOS 33 bytes, 1 capability; the Microsoft OS 2.0 descriptor that binds WinUSB stays) |
| `MULTIKEY_WEBUSB_LANDING_URL` | `https://github.com/mewisme/esp32-security-key` | must be `https://` plus 1..200 printable ASCII characters without spaces; `http://` is rejected at configure time |

Enabled, the BOS is 57 bytes with 2 capabilities (5 header + 24 WebUSB + 28 Microsoft OS 2.0). The WebUSB `GET_URL` request is
answered only for `wValue == 1` (iLandingPage) and `wIndex == 2`; anything else stalls. Previously the firmware advertised upstream's
`www.picokeys.com`. Check a build with `python tools/check_usb_descriptors.py` (static, prints the expected descriptor) and a running key
with `python tools/check_usb_descriptors.py --live` (read-only requests; needs pyusb/libusb access to the WinUSB interface). The static check
is verified on both configurations; the live check and the browser notification have not been run on hardware.

## FIDO authenticator identity (AAGUID and attestation)

- Before this change the key reported **Pico FIDO's AAGUID** `89fb94b7-06c9-3673-9b7e-30526d968145` (first 16 bytes of
  `SHA256("Pico FIDO2")`), i.e. the upstream project's identifier. It is not a registered value for this firmware.
- Now: `CONFIG_MULTIKEY_AAGUID` = `0a63b994-8ba6-5e74-9e5a-0f894cc35c4d`, a UUIDv5 of
  `https://github.com/mewisme/esp32-security-key#dev-aaguid-v1` in the URL namespace. It is a **development value**: not registered
  with the FIDO Alliance Metadata Service, not certified, no vendor claim. A distributed product must generate and own its own
  (the build refuses the upstream value and anything that is not 32 hex digits).
- The AAGUID is used only in `GetInfo` and in the attested credential data of makeCredential (and as the CSR extension of the
  optional vendor attestation CSR command). It is not part of any key derivation: hardware: a non-resident credential created
  with the old AAGUID still signed correctly after flashing the new one (`tools/ctap_survival.py`).
- Attestation: `packed` with a per-device self-signed certificate (the device key is unique per device, so attestation is
  device-identifying; RPs asking for `none` attestation strip it). New devices get the subject
  `O=MultiKeys development,CN=MultiKeys Dev Attestation`; a certificate already stored in flash (`C=ES,O=Pico HSM,CN=Pico FIDO` on
  this board) is **not** replaced, because replacing it would mean erasing a flash file. Residual upstream strings remain only in
  the optional CSR subject and the Vault CA test certificates (`PicoKeys Vault CA`), none of which an RP sees.
- Where site/browser names come from (inference from source and public behaviour, not tested against every site): the label
  shown for a hardware key during registration is chosen by the browser/OS ("security key", transport icon) or typed by the user
  at the RP; it does **not** come from the USB product string. Names/icons tied to a model come from AAGUID lookups in metadata
  lists (FIDO MDS, community AAGUID lists); an unknown AAGUID simply shows the generic security-key label. FIDO metadata for this
  project does not exist.
- No impersonation: the key never reports another vendor's AAGUID, VID/PID (apart from the placeholder VID noted in HARDWARE.md)
  or attestation chain, and nothing here claims FIDO certification.

## Tests

| Test | Needs | Command |
|---|---|---|
| Rust: name validation, APDU encodings, authorization/PIN/button/no-change rules (mock) | nothing | `cd host && cargo test` |
| USB strings on the bus, per interface | board (Windows, no elevation) | `python tools/usb_identity.py --expect-product "<name>"` |
| Device-side validation (bad names, lengths, P1/P2, no-press timeout) | board, no press | `python tools/mkauth_name_test.py --nobutton` |
| Full rename flow with re-enumeration, replug persistence, restore | board, 3 presses, 1 replug | `python tools/name_flow_test.py` |
| Credentials survive update/rename | board, elevated | `tools\run_elevated.ps1 tools\ctap_survival.py snapshot` / `verify` |
