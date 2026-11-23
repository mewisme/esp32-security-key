# Hardware reports

Place one report per hardware test session here, named `YYYY-MM-DD-<topic>.md`. A feature may only be marked
**Hardware verified** in `docs/ROADMAP.md` when a report here shows it passing on a real ESP32-S3.

Template:

```
Date:
Board / module (e.g. ESP32-S3-DevKitC-1 N16R8), flash size, PSRAM:
Image: app (fido|openpgp), profile (dev|prod), git commit, ESP-IDF version:
GPIOs used (button, LED):
Host OS / software versions:
Fuse state (tools/provision_check.py output):
Steps run and results (paste script output):
Unexpected behaviour:
```

Reports so far (all one ESP32-S3 N16R8 board, Windows 11, 2026-11-23): `2026-11-23-read-only-probe.md`, `2026-11-23-first-run.md`,
`2026-11-23-uv-and-identity.md`, `2026-11-23-management-cli-and-webusb.md`, `2026-11-23-web-installer.md`,
`2026-11-23-profiles-and-personalization.md`, `2026-11-23-build-info-and-passkey-events.md`, `2026-11-23-v0.3.4-flash-and-cancel.md`. Reports are historical: failed runs are kept and raw output is not edited.
