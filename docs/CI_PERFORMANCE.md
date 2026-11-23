# CI performance

What was slow, what changed, and what the numbers are. Every number below comes from a GitHub Actions run listed next to it
(`gh run view <id> --json jobs`); a row without a run ID says "not measured".

## What changed

| Change | Where | Effect it is meant to have |
|---|---|---|
| Triggers: `push` to `main` and `v*` tags plus `pull_request` (no more push + pull request runs of one branch); `concurrency` cancels a superseded pull request run | `ci.yml` | one run per change instead of two |
| `changes` job (`dorny/paths-filter`): firmware, emulation, host and flash-script jobs run only when their inputs changed (a tag runs everything) | `ci.yml` | docs- or web-only changes skip ESP-IDF, Rust and the Windows job |
| ESP-IDF ccache (`IDF_CCACHE_ENABLE=1`, `CCACHE_BASEDIR`, `CCACHE_COMPILERCHECK=content`, 500 MB), restored from `main`'s last save, saved only from `main` | `ci.yml` `firmware`, `release.yml` `firmware` | recompiles only what changed; the three builds of a job (CI-pin compile, board build, "unset pins must fail") also share objects |
| `Swatinem/rust-cache` on `host -> target` | `ci.yml` `host`, `release.yml` `build` | dependency crates are not rebuilt |
| The fido dev board build, its irreversible-operation check and firmware packaging live only in `release.yml` (3 profiles); `ci.yml` keeps the openpgp board build | `ci.yml`, `release.yml` | no duplicate firmware packaging per push |
| `release.yml` `build` runs `fmt`/`clippy`/`test` only for a tag (`ci.yml` covers `main` and pull requests) | `release.yml` | one fewer test run per push |
| Playwright browsers cached by Playwright's version; `install-deps` only on a hit; no separate `pnpm typecheck` (`pnpm build` runs `tsc -b`) | `web.yml` | skips the 32 s browser download and one `tsc` |
| Every action is pinned by commit SHA | all | none (supply chain) |

Not changed: the `espressif/idf:v5.5.6` container is pulled on every firmware job ("Initialize containers", 81-95 s in the
baseline); no cache of the image was added.

Trust boundary of the caches (every run restores them except the release build of a tag; only `main` saves them):
[SECURITY.md](SECURITY.md), [RELEASES.md](RELEASES.md).

## Baseline (before this change)

Commit `5964a08`, the three workflows triggered by one push to `main`.

| Workflow | Run | Wall clock |
|---|---|---|
| ci | 45116367001 | 3 min 30 s |
| release | 45116366995 | 3 min 25 s |
| web | 45116366962 | 1 min 31 s |

| Run | Job | Duration |
|---|---|---|
| ci 45116367001 | firmware (fido, dev) | 191 s (container init 81 s, CI-pin build 59 s, real-pin build 22 s, unset-pins build 16 s) |
| ci 45116367001 | firmware (fido, prod) | 156 s |
| ci 45116367001 | firmware (openpgp, dev) | 206 s |
| ci 45116367001 | firmware (openpgp, prod) | 181 s |
| ci 45116367001 | host (windows-latest) | 112 s |
| ci 45116367001 | host (ubuntu-latest) | 68 s |
| ci 45116367001 | fido-emulation | 74 s |
| ci 45116367001 | flash-script | 21 s |
| release 45116366995 | meta | 7 s |
| release 45116366995 | build windows-x86_64 | 168 s |
| release 45116366995 | build linux-x86_64 | 114 s |
| release 45116366995 | build pam-linux-x86_64 | 82 s |
| release 45116366995 | firmware | 184 s (container init 95 s, image build 77 s) |
| release 45116366995 | assemble | 7 s |
| web 45116366962 | check | 88 s (`playwright install --with-deps chromium` 32 s, `pnpm test:e2e` 18 s, `pnpm typecheck` 3 s, `pnpm build` 5 s) |

## Measurements after the change

How they are taken: `gh run list -w <ci|release|web> -L 5 --json databaseId,headSha,createdAt,updatedAt,event`, then
`gh run view <id> --json jobs --jq '.jobs[] | {name, startedAt, completedAt, steps: [.steps[] | {name, startedAt, completedAt}]}'`;
ccache hit rates from the `ccache statistics` step (`gh run view <id> --log --job <job id> | grep -E "Hits|Misses|hit rate"`).

| Scenario | How it is produced |
|---|---|
| Cold | the first `ci`/`release`/`web` run on `main` after the workflow commit: no cache has been saved yet |
| Warm | `gh run rerun <release run id>` on the same SHA: restores the cache the cold run just saved |
| Small incremental | a later commit that touches only `tools/**` (the flash script's `--hw` support), so firmware objects should hit |

Results: not measured yet. The tables are filled in when the runs exist.

| Run | Scenario | Run ID | Wall clock | ccache hit rate | Notes |
|---|---|---|---|---|---|
| release | cold | not measured | | | |
| release | warm (rerun) | not measured | | | |
| release | small incremental | not measured | | | |
| ci | cold | not measured | | | |
| ci | warm | not measured | | | |
| web | cold (Playwright cache miss) | not measured | | n/a | |
| web | warm (rerun, Playwright cache hit) | not measured | | n/a | |
