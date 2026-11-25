# Web deployment controls

The installer site (`web/`) is deployed to Cloudflare Workers. Code in `.github/workflows/web.yml` limits **how** a deploy can start;
who may approve it and what the credentials can do are GitHub and Cloudflare settings that a repository file cannot enforce. Both
halves are listed here.

## What the workflow enforces (tested by `tests/release/test_workflows.py`)

- `web.yml` has two jobs: `check` (lint, unit, build, e2e; runs on push/PR for `web/**`) and `deploy-production`.
- The deploy jobs run **only** for `workflow_dispatch`. No push, pull request, tag, `ci.yml`, `release.yml` or `workflow_run` can
  reach them, and no other workflow contains Cloudflare credentials or `wrangler`.
- `deploy-production` needs all of: input `deploy = production`, input `confirm_production = deploy-production` (typed), the run's
  ref is `refs/heads/main`, and `check` succeeded in the same run.
- The deploy job has `permissions: contents: read`, `environment: production`, and its own `concurrency` group
  (`web-deploy-production`) with `cancel-in-progress: false`, so two deploys never overlap and a
  running deploy is never cancelled. The workflow-level group no longer cancels a manual run when another run starts on the ref.
- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are read only in the deploy jobs' final step (never in `check`, never in pull
  request runs). Checkout uses `persist-credentials: false`.
- Dependencies install with `pnpm install --frozen-lockfile`; every action is SHA-pinned (`docs/DEPENDENCIES.md`).

Operating it: Actions, `web`, Run workflow, branch `main`, `deploy` = `production`, and type
`deploy-production`. Local `pnpm run deploy` (see `web/README.md`) remains possible for an operator with
a token and bypass all of the above; keep the token out of shared machines.

## Settings to apply in GitHub (not enforceable from code)

Repository, Settings, Environments. The environment is named `production`; the former `staging` environment (and its token) is no
longer used by anything and can be deleted.

| Environment | Setting |
|---|---|
| `production` | **Required reviewers**: at least one person other than the one who dispatches; enable "Prevent self-review" |
| `production` | **Deployment branches and tags**: selected branches only, `main` (this is the real branch restriction; the workflow `if` is a second check) |
| `production` | Secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` stored **as environment secrets**, not repository secrets |
| `production` | Optional wait timer (for example 5 minutes) to allow cancelling |
| Repository | Remove any repository-level `CLOUDFLARE_*` secret so that only the `production` environment holds credentials |
| Repository | Branch protection on `main`: required status checks (`ci`, `web`), no force pushes, required review |
| Repository | Actions, General: workflow permissions default to **read**; "Allow GitHub Actions to create and approve pull requests" off; allow only actions from this repository and verified/selected owners |

Until these exist the typed confirmation and the `main` condition are the only gates: a collaborator with write access can still
dispatch a production deploy. State this in release notes rather than claiming protected deployment.

## Cloudflare token scope

Create a dedicated **API token** for the production deploy (Cloudflare dashboard, My Profile, API Tokens, custom token):

- Permissions: Account, **Workers Scripts, Edit**, plus Zone, Workers Routes, Edit (and Zone, Read) because `wrangler.jsonc` declares a
  route for the production worker. Nothing else (no DNS edit, no account-wide admin, no R2/KV
  unless the worker binds them).
- Resources: restrict to the single account, and for zone permissions to the single zone (`multikeys.mewis.me`'s zone).
- Set an expiry and rotate it; revoke it when a maintainer leaves.
- `CLOUDFLARE_ACCOUNT_ID` is an identifier, not a secret, but is stored next to the token for convenience.

## Not done here

No workflow was dispatched and no setting was changed while writing this. Whether the GitHub Environments exist and have reviewers
cannot be read from the repository; verify under Settings, Environments.
