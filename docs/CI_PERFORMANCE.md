# CI performance

What was slow, what changed, and what the numbers are. Every number below comes from a GitHub Actions run listed next to it
(`gh run view <id> --json jobs`); a row without a run ID says "not measured".

## What changed

| Change | Where | Effect it is meant to have |
|---|---|---|
| Triggers: `push` to `main` and `v*` tags plus `pull_request` (no more push + pull request runs of one branch); `concurrency` cancels a superseded pull request run | `ci.yml` | one run per change instead of two |
| `changes` job (`dorny/paths-filter`): firmware, emulation, host and flash-script jobs run only when their inputs changed (a tag runs everything) | `ci.yml` | docs- or web-only changes skip ESP-IDF, Rust and the Windows job |
| ESP-IDF ccache (`IDF_CCACHE_ENABLE=1`, `CCACHE_COMPILERCHECK=content`, 500 MB), restored from `main`'s last save (exact key, then the key prefix), saved only from `main`; statistics zeroed after the restore | `ci.yml` `firmware`, `release.yml` `firmware` | recompiles only what changed; the builds of one job also share objects |
| `Swatinem/rust-cache` on `host -> target` | `ci.yml` `host`, `release.yml` `build` | dependency crates are not rebuilt |
| The fido dev board build, its irreversible-operation check and firmware packaging live only in `release.yml` (3 profiles); `ci.yml` keeps the openpgp board build | `ci.yml`, `release.yml` | no duplicate firmware packaging per push |
| `release.yml` `build` runs `fmt`/`clippy`/`test` only for a tag (`ci.yml` covers `main` and pull requests) | `release.yml` | one fewer test run per push |
| Playwright browsers cached by Playwright's version; `install-deps` only on a hit; no separate `pnpm typecheck` (`pnpm build` runs `tsc -b`) | `web.yml` | skips the browser download and one `tsc` |
| Every action is pinned by commit SHA | all | none (supply chain) |

Not changed: the `espressif/idf:v5.5.6` container is pulled on every firmware job ("Initialize containers", 59-95 s in every run below,
about half of a warm firmware leg); no cache of the image was added.

Trust boundary of the caches (every run restores them except the release build of a tag; only `main` saves them):
[SECURITY.md](SECURITY.md), [RELEASES.md](RELEASES.md).

Two facts about the cache wiring that were checked in the logs, not assumed:

- In a container job `${{ github.workspace }}` evaluates to the host path (`/home/runner/work/esp32-security-key/esp32-security-key`) while the
  checkout is at `/__w/esp32-security-key/esp32-security-key`. `CCACHE_DIR` therefore points at a directory in the container's own
  filesystem, and `actions/cache` saves and restores that same path string. It works (hit rates below); `CCACHE_BASEDIR` does not match the
  real source path, which is harmless because the checkout path is the same in every run.
- The saved cache carries the statistics of the run that saved it. The first version zeroed them before the restore, so a warm run printed
  cumulative numbers (it showed 50 % hits for 100 %). `f195cb6` zeroes them after the restore; the rows below say which numbers are
  per-run and which were computed by subtracting the saved ones.

## Baseline (before this change)

Commit `5964a08`, the three workflows triggered by one push to `main`. Wall clock = first job start to last job end.

| Workflow | Run | Wall clock |
|---|---|---|
| ci | 45116367001 | 207 s |
| release | 45116366995 | 202 s |
| web | 45116366962 | 88 s |

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
| release 45116366995 | build windows-x86_64 | 168 s |
| release 45116366995 | build linux-x86_64 | 114 s |
| release 45116366995 | build pam-linux-x86_64 | 82 s |
| release 45116366995 | firmware (one image, 16 MB) | 184 s (container init 95 s, image build 77 s) |
| web 45116366962 | check | 88 s (`playwright install --with-deps chromium` 32 s, `pnpm test:e2e` 18 s, `pnpm typecheck` 3 s, `pnpm build` 5 s) |

## Measurements after the change

| Label | Runs | Commit | What it is |
|---|---|---|---|
| cold | ci 45127379011, release 45127379004, web 45127378997 (attempt 1) | `2508afe` | first run on `main` after the workflow commit: no cache existed |
| warm | the same three runs, attempt 2 (`gh run rerun`) | `2508afe` | exact-key restore of what the cold run saved |
| no firmware change | ci 45138973264, release 45138973315, web 45138973294 | `1c905dc` | web and docs only: ccache restored through the key prefix (new SHA) |
| tools change | ci 45139907554, release 45139907557, web 45139907508 | `f195cb6` | `tools/**` and `ci.yml` changed, so every job ran; ccache restored through the prefix |

Wall clock (seconds):

| Workflow | Baseline | Cold | Warm | No firmware change | Tools change |
|---|---|---|---|---|---|
| ci | 207 | 227 | 175 | 8 (only `changes` ran) | 160 |
| release | 202 | 221 | 167 | 157 | 188 |
| web | 88 | 98 | 102 | 101 | 140 (the commit under it added the Vietnamese interface: 47 e2e tests instead of 41) |

Jobs (seconds):

| Job | Baseline | Cold | Warm | No firmware change | Tools change |
|---|---|---|---|---|---|
| ci firmware fido dev | 191 | 191 | 127 | skipped | 146 |
| ci firmware fido prod | 156 | 159 | 121 | skipped | 129 |
| ci firmware openpgp dev | 206 | 218 | 162 | skipped | 147 |
| ci firmware openpgp prod | 181 | 182 | 145 | skipped | 130 |
| ci host windows | 112 | 126 | 57 | skipped | 75 |
| ci host ubuntu | 68 | 80 | 49 | skipped | 31 |
| ci fido-emulation (not cached) | 74 | 100 | 74 | skipped | 79 |
| release firmware 16 MB | 184 (only image) | 189 | 137 | 135 | 131 |
| release firmware 8 MB | n/a | 197 | 149 | 128 | 127 |
| release firmware 4 MB | n/a | 183 | 127 | 136 | 165 |
| release build windows | 168 | 108 | 62 | 63 | 70 |
| release build linux | 114 | 92 | 39 | 41 | 47 |
| release build pam | 82 | 72 | 35 | 87 | 51 |

Steps that explain them (seconds; release firmware 16 MB leg, ci fido dev, ci host windows):

| Step | Baseline | Cold | Warm | Prefix restore |
|---|---|---|---|---|
| release 16 MB: image build (CMake + ninja) | 77 | 95 | 41 | 41 (`1c905dc`) |
| release 16 MB: initialize containers | 95 | 73 | 77 | 74 |
| ci fido dev: compile-check build | 59 | 72 | 40 | n/a |
| ci host windows: `cargo clippy` | n/a | 58 | 19 | n/a |
| ci host windows: `cargo test` | n/a | 33 | 10 | n/a |
| web: Playwright browser and system packages | 32 | 21 (miss) | 4 (cache) + 13 (system packages) | 18 (`1c905dc`, hit) |
| web: `pnpm test:e2e` | 18 | 40 | 45 | 47 |

ccache (compiler calls of the job; one release leg compiles once, a ci job two or three times):

| Run | Restore | Calls | Hits | Rate | Source of the number |
|---|---|---|---|---|---|
| cold, release 4/8/16 MB | none found | 707 each | 0 | 0 % | per run (zeroed before an empty restore) |
| cold, ci fido dev / fido prod | none found | 1361 / 1362 | 652 / 653 | 48 % | per run; builds 2 and 3 of the job hit the objects of build 1 |
| cold, ci openpgp dev / prod | none found | 2090 / 1372 | 1363 / 650 | 65 % / 47 % | per run |
| warm, release 4/8/16 MB | exact key | 707 each | 707 | 100 % | cumulative output minus the saved statistics |
| warm, ci (4 jobs) | exact key | 1368-2096 | 1364-2090 | 99.7 % | cumulative output minus the saved statistics |
| `1c905dc`, release 4/8/16 MB | prefix of `2508afe` | 707 each | 705 | 99.7 % | cumulative output minus the saved statistics |
| `f195cb6`, release 4/8/16 MB | prefix of `1c905dc` | 707 each | 705 | 99.72 % | per run |
| `f195cb6`, ci (4 jobs) | prefix of `2508afe` | 1368, 1368, 2094, 1376 | 1364, 1364, 2088, 1372 | 99.71 % | per run |

The two misses per build were not investigated; a plausible cause is a file that embeds the commit or version, but that is an inference.

What the numbers say:

- A cold run is not faster than the baseline (ci 227 s against 207 s, release 221 s against 202 s: the `changes`/`meta` jobs, cache saves and the
  three release firmware legs). The gain starts with the second run.
- With a warm cache single jobs are 25-55 % faster (firmware legs -38 to -64 s, windows host -69 s, release windows build -46 s, linux -53 s) and the
  compiler hit rate is 99.7 % even when only the key prefix of an older commit matches, so a one-line source change would recompile only what it touches.
- The workflow wall clock improves less than its jobs (ci warm 175 s against 207 s, release warm 167 s against 202 s, about -15 %), because
  it is the slowest job that counts: a firmware leg is about 60-77 s of container initialization, 25 s of CMake configure and the compile.
  The container pull is the biggest cost left and was not addressed.
- A change that touches only `web/**` or docs now costs 8 s in `ci` (run 45138973264) instead of 207 s. `release` has no path filter (a tag
  push must always build) and still runs on every push to `main`.
- Playwright: a hit costs 17-18 s (4 s cache restore plus 13-18 s for the system packages) against 32 s in the baseline, so the rule set for this
  work (keep the cache if a warm run saves at least 10 s) is met. The miss path of the same runs took 21 s, so the cache itself saves 3-4 s over a
  miss; the system packages (`install-deps`) are the larger part and cannot be cached by `actions/cache`. The e2e step grew from 18 s to 40-47 s
  because the suite grew (41 to 47 tests), not because of the cache, so the `web` workflow is not faster than its baseline: 88 s against 98-140 s.
- Cache storage after three pushes that saved caches (24 entries): each ccache entry 14-16 MB, one per push and leg (7 per push); the Playwright browsers 292 MB per
  Playwright version; Rust 54-212 MB per job; the pnpm store 192 MB. The repository limit is 10 GB with least-recently-used eviction.

Not measured: cancellation of a superseded pull request run (no pull request was opened), the tag path of `release.yml` (it restores no
cache; asserted by `tests/release/test_workflows.py`, never run on a tag with this change), eviction behaviour after the 10 GB limit.
