# MultiKeys web installer (`web/`)

The site at https://multikeys.mewis.me: a beginner installer that flashes MultiKeys firmware from desktop Chrome/Edge over
Web Serial, plus first-use, help and release pages.

Stack: React 19 + Vite 8 + TypeScript 6 + Tailwind CSS 4 + shadcn/ui (Radix), `esptool-js` 0.7.1 for the serial protocol,
hosted on Cloudflare Workers with static assets via `@cloudflare/vite-plugin`.

## Commands

```sh
pnpm install
pnpm dev                                         # http://localhost:5173 (Vite + local Worker)
MULTIKEYS_LOCAL_FIRMWARE=../build-pkgtest pnpm dev   # serve a locally packaged firmware as release "local"
pnpm typecheck && pnpm lint && pnpm test        # tsc, eslint, vitest (pure logic + components)
pnpm test:e2e                                    # Playwright against `vite build --mode e2e` + preview
pnpm build && pnpm preview                       # production build, served by the local Worker runtime
pnpm run deploy:staging                          # multikeys-web-staging.<account>.workers.dev
pnpm run deploy                                  # production Worker (multikeys-web)
```

`pnpm deploy` is a pnpm builtin; always use `pnpm run deploy`.

Local firmware for `MULTIKEYS_LOCAL_FIRMWARE`: build without `--release`, then

```sh
python tools/package_firmware.py package --build-dir build-fido-dev --sdkconfig sdkconfig.fido-dev.generated \
  --app fido --board esp32s3-n16r8-boot-button --version "$(python tools/package_firmware.py version)-dev" \
  --commit "$(git rev-parse HEAD)" --out build-pkgtest --source-date-epoch 0
python tools/package_firmware.py manifest --entries 'build-pkgtest/*.entry.json' \
  --version "$(python tools/package_firmware.py version)-dev" --tag local --commit "$(git rev-parse HEAD)" \
  --out build-pkgtest/firmware-manifest.json
```

Tag `local` is accepted only by the dev server (`import.meta.env.DEV`); production builds reject it.

## Worker routes (`worker/`)

| Route | Behaviour |
|---|---|
| `GET /api/releases` | releases from GitHub's `releases.atom` feed (drafts never appear; the REST API is avoided because unauthenticated calls from Workers' shared IPs are rate-limited) whose `firmware-manifest.json` exists (HEAD check, newest 10); cached 5 min |
| `GET /api/firmware/:tag/:asset` | proxies `releases/download/:tag/:asset`; `tag` must be `vX.Y.Z[-pre]`, `asset` must be `firmware-manifest.json`, `SHA256SUMS` or `multikey-firmware-v<tag version>-esp32s3-n16r8-<fido|openpgp>-dev.zip`; max 16 MiB; cached immutable |
| other `/api/*` | 404 (`405` for non-GET) |

GitHub release downloads have no CORS headers, hence the proxy. The Worker holds no secrets or tokens and builds upstream
URLs only from the two validated path segments (`worker/routes.ts`, unit-tested). Everything else is static assets with an SPA
fallback; `public/_headers` sets CSP (`connect-src 'self'`), `Permissions-Policy: serial=(self), usb=(self)` and friends.

## Known limitations

- Hardware coverage: one update on one board (`docs/hw-reports/2026-11-23-web-installer.md`). esptool-js only offers an RTS
  `hard_reset` after writing, which left the native-USB board in download mode (as with the developer script, which uses
  `--after watchdog_reset`); the reconnect step therefore tells the user to replug. No watchdog-reset workaround is
  implemented without a further hardware test.
- The WebUSB key check may not be able to open the device on Windows (HID/CCID drivers hold the interfaces); it then reports
  the landing page as "not checked". `python tools/check_usb_descriptors.py --live` is the check of record.

## Trust model

- The browser downloads firmware through the Worker, which fetches it over HTTPS from the GitHub release.
- `firmware-manifest.json` lists SHA-256 for the package and each image; the zip, every image and `firmware.json` are
  checked before anything is written. This detects corruption, not a compromised repository or release: nothing is signed.
- Writes are limited to the regions in `tools/flash_policy.json` (bootloader 0x0, partition table 0x8000, app 0x20000), the
  same file `tools/flash_dev.py` uses. The installer reads the board's partition table and app descriptor first and picks an
  install mode in `src/lib/flashing/install-mode.ts`. Only "repurpose" (a foreign layout, typed `REPURPOSE` confirmation)
  writes 0xFF over `nvs` and `part0`; it never erases the whole chip and never touches eFuses.
- After writing, every region is read back by MD5 before the installer reports success.

## Architecture

- `src/lib/flashing/machine.ts`: pure reducer for the wizard phases; `completed` needs a verified flash.
- `src/hooks/useInstaller.ts`: performs side effects (driver, download, decisions) and dispatches events.
- `src/lib/flashing/driver.ts`: `FlashDriver` interface; `esptool-driver.ts` implements it with esptool-js.
- E2E: `vite build --mode e2e` aliases `@/lib/flashing/create-driver` and `@/lib/device/create-usb-checker` to
  `tests/e2e/fake-*.ts` (a simulated board driven by `localStorage["multikeys-e2e-scenario"]`). Production builds never
  contain the fakes; check with `rg -l "multikeys-e2e-scenario" dist/client` (no output).

## Staging and the custom domain

1. `pnpm exec wrangler login` (once, by the account owner).
2. `pnpm run deploy:staging` → `multikeys-web-staging.<subdomain>.workers.dev`; check `/api/releases` and `/install`.
3. Production: `pnpm run deploy` → `multikeys-web.<subdomain>.workers.dev`.
4. Custom domain, only after approval: add to the top level of `wrangler.jsonc`
   `"routes": [{ "pattern": "multikeys.mewis.me", "custom_domain": true }]` (the `mewis.me` zone must be on the same
   Cloudflare account), then `pnpm run deploy`.

CI (`.github/workflows/web.yml`) runs typecheck, lint, unit and e2e tests on every push; deploys only from a manual
`workflow_dispatch` with `deploy: staging|production`, using the `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets
of the `cloudflare-<target>` environment.
