# 0010 — Serialized, SHA-pinned, self-evidencing deploys

## Context

Measured on `bed720b` with:

```bash
rg -n 'concurrency|command_timeout|set -euo pipefail|git pull|git checkout|workflow_dispatch|ponder-ready-probe' \
  .github/workflows/deploy-ponder.yml .github/workflows/deploy-svm-ingest.yml
nl -ba .github/workflows/ci.yml | sed -n '15,22p'
nl -ba .gitignore | sed -n '40p'
nl -ba scripts/lib/ponder-readiness-probe.ts | sed -n '8,9p'
nl -ba src/svm-ingest/http-health.ts | sed -n '67,75p;88,94p'
nl -ba test/deploy-vps-secret-policy.test.ts | sed -n '33p;325,326p;658p'
```

Deploy job durations (Actions API, six most recent successful deploy jobs before this ADR):

- Ponder: 2m15s, 2m08s, 2m53s
- svm-ingest: 1m50s, 1m52s, 2m13s

- `deploy-ponder.yml` and `deploy-svm-ingest.yml` declare no `concurrency`. A push that matches both path lists starts both, and both SSH into the same checkout. This already happened on `56cddcb` (2026-10-02): the two deploy jobs overlapped and both happened to succeed — Ponder run [36989998121](https://github.com/kargain-com/kargain/actions/runs/36989998121) deploy `09:38:23`–`09:40:31` UTC, svm-ingest run [36989998221](https://github.com/kargain-com/kargain/actions/runs/36989998221) deploy `09:38:26`–`09:40:16` UTC. #42 matched both path lists again; those runs failed at startup for an unrelated reason (#43).
- `ci.yml:15–22` keeps a per-workflow concurrency group on purpose. Its comment records that a group shared with the deploy callers made caller runs vanish. Any deploy serialization therefore has to live on the deploy jobs and leave `ci.yml` alone.
- `deploy-ponder.yml:84–87`: `set -euo pipefail`, then `git checkout --force "$DEPLOY_SHA"` (`github.sha`). After `docker compose up -d ponder` (`:115`, without `--force-recreate`), it runs the readiness probe (`:117–120`) and skips the recreate when the executable digest is unchanged.
- Ponder readiness owner: `scripts/lib/ponder-readiness-probe.ts:8–9` (`PONDER_READY_DEFAULT_URL` = `http://127.0.0.1:42069/ready`, `PONDER_READY_TIMEOUT_MS` = `90_000`, `PONDER_READY_INTERVAL_MS` = `2_000`). CLI: `scripts/ponder-ready-probe.ts`. Success is any HTTP status (process answered).
- `deploy-svm-ingest.yml:37–40`: `git pull … master`, `docker compose build`, `up -d --force-recreate`. There is no `set -e`, no pinned SHA and no readiness check. svm-ingest serves `/ready` on `127.0.0.1:42100` (`src/svm-ingest/http-health.ts:88–94`). HTTP 200 only when caught up; otherwise 503. `classifySvmIngestReadySurface` (`:67–75`) maps the payload to `caught_up`, `bootstrap_incomplete`, or `incident`.
- Neither deploy sets `command_timeout` on `appleboy/ssh-action@029f5b4aeeeb58fdfe1410a5d17f967dacf36262`. The action default is **10m** ([action.yml](https://github.com/appleboy/ssh-action/blob/029f5b4aeeeb58fdfe1410a5d17f967dacf36262/action.yml); [README](https://github.com/appleboy/ssh-action/blob/029f5b4aeeeb58fdfe1410a5d17f967dacf36262/README.md) input table).
- `.ponder-deploy-fingerprints` is gitignored (`.gitignore:40`). That is the precedent for an untracked file in the server checkout.
- Triggers: svm-ingest has `workflow_dispatch`; Ponder has push only, so a failed Ponder deploy cannot be re-run without a new merge. Neither deploy log shows the deployed commit or the runtime version.
- `test/deploy-vps-secret-policy.test.ts:33` allows only `push` to `master` and `workflow_dispatch`, and forbids `if:` on deploy jobs (`:325–326`; constructed red at `:658`).
- GitHub concurrency groups keep one running job or workflow and one pending per group; a newer pending run cancels and replaces the older pending one ([Control the concurrency of workflows and jobs](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/control-the-concurrency-of-workflows-and-jobs)).
- Interpolating `${{ github.ref }}` into a `run:` script is the script-injection pattern warned against in [Security hardening for GitHub Actions](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions#understanding-the-risk-of-script-injections).

## Decision

Serialize each deploy, pin it to the triggering commit, and make every successful start self-evidencing.

- **Per-service job-level concurrency** on each `deploy` job, with `cancel-in-progress: false`:
  - group `deploy-ponder`
  - group `deploy-svm-ingest`
  Within one service, superseding a pending run is safe: the newer run deploys a newer `master` `github.sha` that already contains the older commit. Leave `ci.yml` unchanged.
- **A server-side lock** around the whole SSH deploy script:
  - Lock file: `.deploy.lock` at the repository checkout root (same directory as `.ponder-deploy-fingerprints`).
  - Kept out of git: the implementation adds `.deploy.lock` to `.gitignore` (precedent `.gitignore:40`).
  - Acquire with `flock -w 900` (900 seconds). Measured successful deploy jobs topped out near 3 minutes (Ponder 2m53s; svm-ingest 2m13s). The first deploy after #42 also pulls `node:24.22.1-alpine` once. **900s** is about five times the observed maximum plus room for that one-off base-image pull and readiness polling, so a waiter fails closed instead of overlapping `git` or `docker compose` while a cold peer finishes.
  - If the lock is not acquired in time, print exactly `deploy_lock_not_acquired: waited 900s for .deploy.lock` and exit non-zero.
  - Set SSH `command_timeout: 30m` on both deploy steps. That covers the 900s lock wait plus the deployer's own work (observed ≤ ~3 minutes, or a few minutes more with a cold base-image pull) plus readiness. The action default of 10m cannot cover wait plus work.
- **Both deploys** check out `github.sha` (`git checkout --force "$DEPLOY_SHA"`) — no `git pull` — and run under `set -euo pipefail`.
- **Both** have `workflow_dispatch`. A fail-fast master-only first step accepts the dispatch; job-level `if:` is forbidden by `test/deploy-vps-secret-policy.test.ts`. Compare the runner-provided environment variable — no `${{ … }}` in the `run:` line:

  ```yaml
  - name: Require master
    run: test "$GITHUB_REF" = "refs/heads/master"
  ```

- **Evidence**, printed after every path that finishes the script successfully, in these exact formats so a policy can assert them. Readiness runs on both outcomes (on `unchanged`, against the already-running container; read-only).

  **recreated** (new image built and started; svm-ingest always takes this path):

  ```text
  deploy_evidence outcome=recreated
  deploy_evidence commit=<sha the new image was built from>
  deploy_evidence node=<node --version from the new container>
  deploy_evidence ready=<ponder|svm-ingest> ok
  ```

  **unchanged** (Ponder skip-on-unchanged-executable; checkout may be at `github.sha` while the running image is older):

  ```text
  deploy_evidence outcome=unchanged
  deploy_evidence executable=<stored executable digest>
  deploy_evidence node=<node --version from the running container>
  deploy_evidence ready=ponder ok
  ```

- **svm-ingest readiness** (implementation must match this contract):
  - Mechanism: the service image's own `node`, with host networking to reach `http://127.0.0.1:42100/ready` — the same pattern as the Ponder probe (`deploy-ponder.yml:117–120`). Do not assume host `curl` or `wget`.
  - Success: HTTP **200** only (caught up). Unlike Ponder, any other answered status is not success.
  - Poll every **2s**; give up after **90s**. That matches Ponder's interval and is enough for a recreate on an already-synced ingest to answer caught-up; a prolonged `bootstrap_incomplete` or `incident` fails the deploy rather than waiting out a cold catch-up inside the SSH step.
  - On timeout: print the `classifySvmIngestReadySurface` classification and the payload `status`, then exit non-zero. The new container keeps running (same failure stance as Ponder).

**Unchanged:** the Ponder fingerprint logic, the skip-on-unchanged-executable rule, `ci.yml`, `docker-compose.yml`, server configuration, keys and secrets.

## One rejected alternative and why

One concurrency group shared by both deploy jobs. Rejected: under the one-pending rule a later deploy of one service cancels the pending deploy of the other, which then silently misses its change.

## Consequences

- Precondition the maintainer confirms on the server before the implementation merges: `flock --version` succeeds. Read-only; no configuration change.
- The implementation PR changes both deploy workflow files, so its merge runs both deploys. That is the recovery for #43. If Ponder exits with `MigrationError`, the maintainer reindexes, then re-runs the Ponder deploy through its new `workflow_dispatch`.
- The implementation extends `test/deploy-vps-secret-policy.test.ts` / `test/deploy-ponder-svm-ingest-ci-policy.test.ts`. Negative controls, red before green:
  - a deploy job without its per-service group;
  - a deploy script without the lock;
  - a deploy script using `git pull`;
  - a deploy script without `set -euo pipefail`;
  - `workflow_dispatch` without the master guard;
  - a master guard that interpolates `${{ github.ref }}` into `run:`;
  - a deploy without the evidence lines (including both `outcome=recreated` and `outcome=unchanged` shapes where applicable).
- #24 builds on this: `gates` path filters must not skip the svm-ingest gate when called from the svm-ingest deploy.

## Status

Accepted
