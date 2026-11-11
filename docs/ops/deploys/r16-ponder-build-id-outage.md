# R16 — Ponder `build_id` outage (2026-10-28 → 2026-10-29)

**Status: RECOVERED** (2026-10-29). Schema `kargain` was dropped under the deploy lock; Ponder returned to `/ready` 200; the failed deploy run’s attempt 2 wrote the fingerprint state, and the next dispatch took the unchanged path.

Related: [#66](https://github.com/kargain-com/kargain/issues/66) · [#58](https://github.com/kargain-com/kargain/pull/58) · [#61](https://github.com/kargain-com/kargain/pull/61) · [#65](https://github.com/kargain-com/kargain/pull/65) · [#70](https://github.com/kargain-com/kargain/issues/70) / [#78](https://github.com/kargain-com/kargain/pull/78) · [#83](https://github.com/kargain-com/kargain/pull/83) · [#77](https://github.com/kargain-com/kargain/issues/77) · [r4 cause 2](./r4-deploy-restore.md) · [indexer OPERATIONS](../../indexer/OPERATIONS.md)

## Outage window

| | |
|---|---|
| Start | About 21:46 UTC on 2026-10-28 — Ponder recreate on [run 40773454611](https://github.com/kargain-com/kargain/actions/runs/40773454611) (push, `20f0e67`, merge of [#65](https://github.com/kargain-com/kargain/pull/65)) |
| End | About 07:57 UTC on 2026-10-29 — `/status` blocks timestamped 07:57:12–07:57:19 UTC; `/ready` 200 when checked shortly after 08:00 UTC |
| Trigger tip | `20f0e67` ([#65](https://github.com/kargain-com/kargain/pull/65)) |
| Last recreate before outage | `d4cc802` ([#53](https://github.com/kargain-com/kargain/pull/53)); stored executable digest `9659399a…` as measured in [#65](https://github.com/kargain-com/kargain/pull/65) |

Exact recreate second is unknown beyond the readiness failure at **21:47:55 UTC** and the deploy job failure at **21:47:58 UTC** on attempt 1 of [run 40773454611](https://github.com/kargain-com/kargain/actions/runs/40773454611).

## Cause

**Trigger.** [Run 40773454611](https://github.com/kargain-com/kargain/actions/runs/40773454611) (“Deploy Ponder to VPS”, push, `20f0e67`):

- `gates` passed (21:37:18–21:45:31 UTC).
- The corrected executable fingerprint from [#61](https://github.com/kargain-com/kargain/pull/61) differed from the stored one, so the deploy took the recreate path.
- The ADR 0012/0013 preflight ran on the server for the first time: `deploy_preflight service=ponder chain=84532 provider=0 verdict=ok` and `chain=11155111 provider=0 verdict=ok`.
- The container was recreated; readiness failed: `ponder_did_not_become_ready: GET http://127.0.0.1:42069/ready did not answer within 90000ms` (21:47:55 UTC). The deploy job failed at 21:47:58 UTC.

**Why.** The container crash-looped with `MigrationError: Schema "kargain" was previously used by a different Ponder app`. Between `d4cc802` and `20f0e67`, the only change under `src/` was `src/svm-ingest/main.ts` ([#58](https://github.com/kargain-com/kargain/pull/58)). Ponder hashes every indexing source under `src/**` outside `src/api` into `build_id`, so that svm-ingest change alone produced a new `build_id`. The identity fingerprint did not cover `src/svm-ingest/`, so the deploy printed no reindex warning. Same class as [r4 cause 2](./r4-deploy-restore.md) (2026-10-25).

## Recovery (2026-10-29)

1. Under `.deploy.lock`, the maintainer ran `docker compose stop ponder`, then `scripts/ponder-reindex.sql`. That printed `DROP SCHEMA`, with 68 objects, all in schema `kargain`; `ponder_rpc_cache_1` and `ponder_sync` were untouched.
2. `docker compose start ponder`. The container started at 07:56:26 UTC with `restarts=0`.
3. `/status` reported both chains at blocks timestamped 07:57:12–07:57:19 UTC; `/ready` returned 200 when checked shortly after 08:00 UTC. With the RPC cache intact, the full backfill took about a minute (against about 11 hours on 2026-10-27/28 when the cache had been dropped — [r4](./r4-deploy-restore.md)).
4. **Last recovery step.** [Run 40773454611](https://github.com/kargain-com/kargain/actions/runs/40773454611) was re-run after recovery (**attempt 2**, finished 2026-10-29 08:02:36 UTC) and succeeded: rebuilt the image, passed preflight and readiness, and wrote the deploy state file ([#66 comment](https://github.com/kargain-com/kargain/issues/66#issuecomment-6492374797)).
5. The next deploy, `workflow_dispatch` [run 40844969305](https://github.com/kargain-com/kargain/actions/runs/40844969305) on `732a95f`, took the `unchanged` path with `deploy_evidence executable=49054916…` and `ready=ponder status=200`.

## Evidence

### Failed recreate — [run 40773454611](https://github.com/kargain-com/kargain/actions/runs/40773454611) attempt 1

| | |
|---|---|
| Commit | `20f0e67` ([#65](https://github.com/kargain-com/kargain/pull/65)) |
| Gates | 21:37:18–21:45:31 UTC |
| Preflight | `verdict=ok` for 84532 and 11155111 |
| Outcome | Recreate; readiness timeout at 21:47:55 UTC; job failed 21:47:58 UTC |
| Crash | `MigrationError: Schema "kargain" was previously used by a different Ponder app` |

### Successful re-run — [run 40773454611](https://github.com/kargain-com/kargain/actions/runs/40773454611) attempt 2

Finished 2026-10-29 08:02:36 UTC. Image rebuild, preflight, readiness, and deploy state write all succeeded.

### Unchanged path after recovery — [run 40844969305](https://github.com/kargain-com/kargain/actions/runs/40844969305)

`workflow_dispatch` on `732a95f`: `outcome` unchanged; `deploy_evidence executable=49054916…`; `ready=ponder status=200`.

## What prevents a repeat (on `master` today)

- **[#70](https://github.com/kargain-com/kargain/issues/70) / [#78](https://github.com/kargain-com/kargain/pull/78)** (squash `64b7b99`): svm-ingest-owned modules live under `svm-ingest/`, outside Ponder’s indexing directory. [`scripts/lib/ponder-indexing-glob.ts`](../../../scripts/lib/ponder-indexing-glob.ts) is the sole owner of the indexing-file set; policy tests pin that the svm-ingest static-import closure ∩ indexing glob is empty. **Prevents** a non-indexing svm-ingest edit from changing Ponder’s `build_id`.
- **[#83](https://github.com/kargain-com/kargain/pull/83)**: the executable fingerprint walks the full Ponder deploy-input graph ([`scripts/lib/ponder-executable-fingerprint.ts`](../../../scripts/lib/ponder-executable-fingerprint.ts)); deploy workflow `paths` must cover every deploy input ([`.github/workflows/deploy-ponder.yml`](../../../.github/workflows/deploy-ponder.yml), [`test/deploy-ponder-svm-ingest-ci-policy.test.ts`](../../../test/deploy-ponder-svm-ingest-ci-policy.test.ts)). **Prevents** a deploy-input change from shipping without the matching workflow seeing it, or from being missing from the recreate graph.
- **Remaining open class.** Changes to Ponder’s own build inputs (schema, contracts, start blocks, indexing sources under `src/`) still change `build_id` and still need a planned reindex / manual schema drop on today’s model. That class is owned by [#77](https://github.com/kargain-com/kargain/issues/77) (ADR 0016: one writer, one schema per commit, automatic switch).

## Verdict

| Surface | State after recovery |
|---|---|
| Ponder | Live after schema drop + start; `/ready` 200; fingerprint state written by attempt 2 of [run 40773454611](https://github.com/kargain-com/kargain/actions/runs/40773454611) |
| Next deploy | [Run 40844969305](https://github.com/kargain-com/kargain/actions/runs/40844969305) took `unchanged` |
| svm-ingest → `build_id` class | Closed by [#78](https://github.com/kargain-com/kargain/pull/78) |
| Remaining open | [#77](https://github.com/kargain-com/kargain/issues/77) — legitimate Ponder build-input `build_id` changes still require a planned reindex until ADR 0016 |
