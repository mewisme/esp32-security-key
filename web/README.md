# MultiKeys web installer (`web/`)

The site at https://multikeys.mewis.me: a beginner installer that flashes MultiKeys firmware from desktop Chrome/Edge over
Web Serial, plus first-use, help and release pages.

Stack: React 19 + Vite 8 + TypeScript 6 + Tailwind CSS 4 + shadcn/ui (Radix) with [ReUI](https://reui.io) components
(`src/components/reui/`, installed as shipped), `esptool-js` 0.7.1 for the serial protocol, hosted on Cloudflare Workers with
static assets via `@cloudflare/vite-plugin`.

## Commands

```sh
pnpm install
pnpm dev                                         # http://localhost:5173 (Vite + local Worker)
MULTIKEYS_LOCAL_FIRMWARE=../build-localfw pnpm dev  # serve a locally packaged firmware as release "local" (see below)
pnpm typecheck && pnpm lint && pnpm test        # tsc, eslint, vitest (pure logic + components)
pnpm test:e2e                                    # Playwright against `vite build --mode e2e` + preview
pnpm build && pnpm preview                       # production build, served by the local Worker runtime
pnpm run deploy:staging                          # multikeys-web-staging.<account>.workers.dev
pnpm run deploy                                  # production Worker (multikeys-web)
```

`pnpm deploy` is a pnpm builtin; always use `pnpm run deploy`.

Local firmware for `MULTIKEYS_LOCAL_FIRMWARE`: build one image per flash size (without `--release`), package each and write a
manifest (schema 2, all three release profiles):

```sh
V="$(python tools/package_firmware.py version)-dev"
for hw in esp32s3-4mb esp32s3-8mb esp32s3-16mb; do
  python tools/build.py dev --app fido --hw $hw --board esp32s3-boot-button --clean
  tag="$(python -c "import sys; sys.path.insert(0, 'tools'); import flash_dev as f; print(f.build_tag('fido', 'dev', '$hw'))")"
  python tools/package_firmware.py package --build-dir "build-$tag" --sdkconfig "sdkconfig.$tag.generated" --app fido \
    --hw $hw --version "$V" --commit "$(git rev-parse HEAD)" --out build-localfw --source-date-epoch 0
done
python tools/package_firmware.py manifest --entries 'build-localfw/*.entry.json' --version "$V" --tag local \
  --commit "$(git rev-parse HEAD)" --out build-localfw/firmware-manifest.json --require-release-profiles
MULTIKEYS_LOCAL_FIRMWARE=../build-localfw pnpm dev
```

Tag `local` is accepted only by the dev server (`import.meta.env.DEV`); production builds reject it.

## Worker routes (`worker/`)

| Route | Behaviour |
|---|---|
| `GET /api/releases` | releases from GitHub's `releases.atom` feed (drafts never appear; the REST API is avoided because unauthenticated calls from Workers' shared IPs are rate-limited) whose `firmware-manifest.json` exists (HEAD check, newest 10); cached 5 min |
| `GET /api/firmware/:tag/:asset` | proxies `releases/download/:tag/:asset`; `tag` must be `vX.Y.Z[-pre]`, `asset` must be `firmware-manifest.json`, `SHA256SUMS` or `multikey-firmware-v<tag version>-esp32s3-<4mb\|8mb\|16mb>-<fido\|openpgp>-dev.zip` (`n16r8` instead of the size only for the v0.2.0 assets published before the profiles); max 16 MiB; cached immutable |
| other `/api/*` | 404 (`405` for non-GET) |

GitHub release downloads have no CORS headers, hence the proxy. The Worker holds no secrets or tokens and builds upstream
URLs only from the two validated path segments (`worker/routes.ts`, unit-tested). Everything else is static assets with an SPA
fallback; `public/_headers` sets CSP (`connect-src 'self'`), `Permissions-Policy: serial=(self), usb=(self)` and friends.

## Known limitations

- Hardware coverage: updates on one board, 16 MB (`docs/hw-reports/2026-11-23-web-installer.md`,
  `docs/hw-reports/2026-11-23-profiles-and-personalization.md`), and renaming from the browser on that board (Windows 11, Chrome).
  4 and 8 MB builds were never run on a board; a key with a management PIN was only run against the simulated key. esptool-js only
  offers an RTS `hard_reset` after writing, which left the native-USB board in download mode (as with the developer script, which
  uses `--after watchdog_reset`); the finish stage therefore tells the user to replug. No watchdog-reset workaround is
  implemented without a further hardware test.
- The WebUSB identity read may not be able to open the device on Windows (HID/CCID drivers hold the interfaces); it then
  reports the landing page as "not checked". `python tools/check_usb_descriptors.py --live` is the check of record. Renaming uses
  the vendor-class interface instead; if the browser cannot claim it the page says so and shows the `multikey device rename`
  command (`name-transport-unavailable`). Linux/macOS are unverified (Linux may need a udev rule for 303A:4002).

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

- `src/lib/flashing/machine.ts`: pure reducer for the six installer stages' phases; `completed` needs a verified flash.
- `src/hooks/useInstaller.ts`: performs side effects (driver, download, decisions) and dispatches events; the choices made
  before connecting (release, device name) live in `config`, persisted per tab in `sessionStorage`
  (`src/lib/installer-config.ts`: release tag, image, requested name; never a PIN).
- `src/lib/flashing/driver.ts`: `FlashDriver` interface; `esptool-driver.ts` implements it with esptool-js and also reads the
  flash type (quad/octal) from eFuse `EFUSE_RD_REPEAT_DATA3_REG` bit 9 on the ESP32-S3.
- `src/lib/compatibility/profiles.ts`: `selectProfile(chip, builds, image)` picks the build by exact flash size and says how well
  that board is known to work (`hardware-verified`, `expected-compatible`, `build-verified`); `matrix.ts` is the table on the home
  page (same rows as `docs/HARDWARE.md`; the words of both are in `src/i18n/messages`). The hardware profiles themselves are in `tools/flash_policy.json`
  (`src/lib/firmware/policy.ts`), shared with the Python tools.
- `src/lib/firmware/manifest.ts` validates `firmware-manifest.json`: schema 2 (`profile_id` per build) and, through an explicit
  mapping, the published v0.2.0 schema 1 (`legacy: true`, treated as the 16 MB profile; its asset name still says `n16r8`).
- Personalization (`src/lib/device/`): `mkauth.ts` builds and parses the MKAUTH APDUs (byte-exact port of
  `host/multikey-proto`), `webccid.ts` speaks CCID over the vendor-class (0xFF) WebUSB interface, `key-connector.ts` is the
  `KeyConnector`/`KeyConnection` seam (identity, transmit, wait for re-enumeration), `personalize.ts` applies a requested name and
  verifies it, `hooks/useKeyName.ts` tracks the outcome for the UI. Flow: after the verified flash the person presses **Check my
  key**, picks the key in the browser's USB chooser, and the page reads the current name; if it differs it sends SET (or CLEAR for
  "reset to the default name") with the re-enumerate flag, asks for the BOOT button (15 s) and, if the key has a management PIN,
  for the PIN (never stored), waits for the key to reappear, pauses 1 s and reads the name and the USB product string back (up to
  6 reads, each on a fresh claim of the interface: on hardware the first command sent right after the key came back was never
  answered). "Applied and verified" is shown only when both match; a key that says nothing is never reported as a missed BOOT press
  (only its own status word 6300 is), and a write that got no answer is checked by reading the name. Failures show the same change
  as a `multikey device rename ...` command.
- Languages (`src/i18n/`): English and Vietnamese, no library. The header's language menu saves the choice in
  `localStorage["multikeys-locale"]`; without a choice the site follows `navigator.languages` (the first `vi` or `en` entry,
  otherwise English) and never saves that guess. `I18nProvider` keeps `<html lang>`, the title and the meta description in step.
  Every user-visible string is in `messages/en.tsx`, whose type (`Messages`) `messages/vi.tsx` must satisfy: a missing key or a
  different function signature fails `tsc`. Components read `const { t, locale } = useI18n()`; a sentence with a number, a plural
  or a link is a function in the dictionary, never fragments joined in a component. Error, support-level, compatibility-matrix
  and name-problem text is keyed by the ids in `lib/errors/catalog.ts`, `lib/compatibility/` and `lib/device/device-name.ts`,
  which hold no text. Identity values (the default device name, error codes and their `/help#code` anchors, `REPURPOSE`, CLI
  commands) and machine diagnostics (the technical-details block, the install decision's reason, release-list errors) stay in
  English, the diagnostics marked `lang="en"`. Sizes and dates go through `INTL_LOCALE` (`lib/format.ts`,
  `components/releases/format-date.ts`). Playwright runs with `locale: "en-US"`, so the English selectors do not depend on the
  machine's language. A new language: add it to `Locale`, `LOCALES` and `INTL_LOCALE`, write `messages/<code>.tsx`, register it in
  `messages/index.ts` and in `components/layout/LanguageToggle.tsx`.
- E2E: `vite build --mode e2e` aliases `@/lib/flashing/create-driver` and `@/lib/device/create-key-connector` to
  `tests/e2e/fake-create-driver.ts` and `tests/e2e/fake-create-key-connector.ts` (a simulated board and an in-memory MKAUTH key
  driven by `localStorage["multikeys-e2e-scenario"]`; scenario fields in `tests/e2e/scenario.ts`: chip, flash size/type,
  PSRAM features, installed firmware, which release is published, key name/PIN/button/re-enumeration). Production builds never
  contain the fakes; check with `rg -l "multikeys-e2e-scenario|FakeDriver|FakeKeyConnector" dist/client` (no output).

## Motion

CSS first, no animation library; the installed `components/ui` and `components/reui` keep their own motion, and the kit below lives
in `src/styles/index.css`. One curve (`--ease-house`, `cubic-bezier(0.22, 1, 0.36, 1)`) and three speeds: 150 ms for hover
(`transition-colors`), 200 ms for entrances and reveals, 300 ms for the largest surface. Only `transform` and `opacity` move;
the exceptions are one-shots (a check mark drawn with `stroke-dashoffset`, the click-started height of a disclosure). A view has
at most one entrance: what is already there when it opens rides on it, and only what arrives later (a load finishing, a result,
a state change) is revealed, which `hooks/useChangedSinceMount` decides. Reduced motion swaps every movement for a fade of 150 ms
or an instant change; progress bars, loaders (they pulse) and chevrons keep going.

| Piece | What it does | Reduced motion |
|---|---|---|
| `.enter-page` (`Page`) | a page rises 8 px when its route mounts; `Layout` also scrolls a page entered by a link to its top (not on back/forward, not with a hash) | fade |
| `.enter-stage` + `data-direction` (`pages/Install`) | a wizard stage comes in from the side it was reached from (Back: from the left); the first stage rides on the page entrance; a failure or the device chooser enters with a plain rise | fade |
| `.enter-reveal` | content that replaces a skeleton (releases, latest release, firmware list), the custom-name field, key-check and rename results, name-state changes, the Finish outcome, field errors | fade |
| `DrawnCheck` (`.draw-check`) | a check that draws itself: stepper step, checklist row, milestone, "Copied" | instant |
| stepper separator | an overlay sweeps over it when its step completes | instant |
| `Disclosure` (`.collapse-content`) | height reveal of the four "details" blocks, with a turning chevron | instant height, chevron still turns |
| `Spinner` | busy checklist rows and name-state waits | pulses |
| `.countdown` | the BOOT-button wait: a linear bar over the firmware's 15 s window | kept (progress bar) |
| `.pulse-ring`, `.pulse-ring-svg` | 2.4 s attention rings: the BOOT prompt, the connector to use on the board diagram | hidden |
| `.shake-on-invalid` | a refused management PIN shakes once | none |
| theme icon, install progress | the icon turns into the new one; the full bar pulses while the key is read back and restarted | fade; pulse kept |
| `GroupRail` | the installed `Scrollspy` scrolls smoothly unless the OS asks otherwise (`usePrefersReducedMotion`) | instant |

Installed overlays (menus, tooltips, the sheet, dialogs) keep their 100 to 200 ms fade, zoom and slide; under reduced motion a block
at the end of `index.css` zeroes their zoom and slide (WCAG 2.3.3) and the accordion opens at once. New motion reuses the kit,
uses only 100, 150, 200 or 300 ms, never `transition-all`, and has a reduced-motion path;
`tests/e2e/motion.spec.ts` fails if a page, stage, disclosure or menu moves under `reducedMotion: "reduce"`.

## Staging, production and the custom domain

1. `pnpm exec wrangler login` (once, by the account owner). All deploys so far ran locally with that OAuth login: no GitHub
   environment (`cloudflare-staging`, `cloudflare-production`) exists yet, so the manual CI deploy job below cannot run.
2. `pnpm run deploy:staging` → `multikeys-web-staging.<subdomain>.workers.dev`; check `/api/releases` and `/install`. Staging sets
   `routes: []` in `wrangler.jsonc`, so it can never take the custom domain over (the Vite-generated config of each environment
   was checked).
3. Production: `pnpm run deploy` (never bare `pnpm deploy`, which is pnpm's own command) deploys the Worker `multikeys-web` to
   `https://multikeys-web.mewisme.workers.dev` and to the custom domain `https://multikeys.mewis.me`, the `routes` entry of
   `wrangler.jsonc` (`custom_domain: true`). Cloudflare created the DNS record and the certificate on the first deploy because the
   `mewis.me` zone is on the same account; the domain answered over HTTPS at once.
4. A new firmware release needs no redeploy: the Worker lists releases from GitHub's `releases.atom` (cached 5 minutes) and
   proxies their assets.
5. On the custom domain Cloudflare's Web Analytics injects `static.cloudflareinsights.com/beacon.min.js`. The strict CSP
   (`default-src 'self'`) blocks it, which shows as one console error per page; nothing else is affected, and it does not happen on
   `workers.dev`. It is a zone setting, not part of this repo: turn off automatic injection for the hostname in the dashboard to
   silence it. The CSP is not loosened for it.

CI (`.github/workflows/web.yml`) runs lint, unit tests, the production build (`tsc -b` then `vite build`, then a grep that the
bundle holds no test double: `multikeys-e2e-scenario`, `FakeDriver`, `FakeKeyConnector`) and the e2e tests on every push that touches `web/**` or
`tools/flash_policy.json` (the browser is installed with `playwright install --with-deps chromium` on every run; a browser cache was measured and gave no reliable gain,
`docs/CI_PERFORMANCE.md`); it deploys only from a manual `workflow_dispatch` with
`deploy: staging|production`, using the `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets of the `cloudflare-<target>`
environment.
