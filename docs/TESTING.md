# Testing

| Level | How | Status |
|---|---|---|
| Firmware build | `python tools/build.py dev --ci-pins` / `prod --ci-pins` | pending |
| Rust unit tests | `cd host && cargo test` | not started |
| Hardware | `python tools/ctap_smoke.py`, `gpg --card-status`, `multikey auth` | pending hardware |

Hardware results go to `docs/hw-reports/` with date, board, IDF/firmware commit. Anything not run on hardware is
reported as pending, never as passed.
