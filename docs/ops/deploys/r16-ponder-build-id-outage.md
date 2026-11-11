# R16 — Ponder `build_id` outage (2026-10-28 → 2026-10-29)

**Status: RECOVERED** (2026-10-29). Schema `kargain` was dropped under the deploy lock; Ponder returned to `/ready` 200 after a manual start; attempt 2 of the failed deploy run then **recreated** the container again, wrote the fingerprint state, and the next dispatch took the unchanged path.

Related: [#66](https://github.com/kargain-com/kargain/issues/66) · [#58](https://github.com/kargain-com/kargain/pull/58) · [#61](https://github.com/kargain-com/kargain/issues/61) · [#65](https://github.com/kargain-com/kargain/pull/65) · [#70](https://github.com/kargain-com/kargain/issues/70) / [#78](https://github.com/kargain-com/kargain/pull/78) · [#83](https://github.com/kargain-com/kargain/pull/83) · [#77](https://github.com/kargain-com/kargain/issues/77) · [r4 cause 2](./r4-deploy-restore.md) · [indexer OPERATIONS](../../indexer/OPERATIONS.md)

## Outage window

| | |
|---|---|
| Start | After executable-change log at **21:46:10 UTC** and both preflights `verdict=ok` at **21:46:22 UTC** on [run 40773454611](https://github.com/kargain-com/kargain/actions/runs/40773454611) attempt 1 (push, `20f0e67`, merge of [#65](https://github.com/kargain-com/kargain/pull/65)); recreate followed the preflight; readiness timed out at **21:47:55 UTC** after the 90 s wait |
| Manual recovery | Container started at 07:56:26 UTC; `/status` blocks timestamped 07:57:12–07:57:19 UTC; `/ready` 200 when checked shortly after 08:00 UTC ([#66](https://github.com/kargain-com/kargain/issues/66)) |
| End | **08:02:32 UTC** — attempt 2 of [run 40773454611](https://github.com/kargain-com/kargain/actions/runs/40773454611) logged `ready=ponder status=200` after a second recreate. Any gap while that recreate replaced the manual start was **not measured**; 08:02:32 is the bound in the logs |
| Trigger tip | `20f0e67` ([#65](https://github.com/kargain-com/kargain/pull/65)) |
| Last recreate before outage | `d4cc802` ([#53](https://github.com/kargain-com/kargain/pull/53)); stored executable digest `9659399a…` (attempt 1 log `prior_executable=9659399a…`, also measured in [#65](https://github.com/kargain-com/kargain/pull/65)) |

## Cause

**Trigger.** [Run 40773454611](https://github.com/kargain-com/kargain/actions/runs/40773454611) attempt 1 (“Deploy Ponder to VPS”, push, `20f0e67`):

- `gates` passed (21:37:18–21:45:31 UTC per [#66](https://github.com/kargain-com/kargain/issues/66)).
- The corrected executable fingerprint from [#61](https://github.com/kargain-com/kargain/issues/61) differed from the stored one (`prior_executable=9659399a…` → `new_executable=49054916…` at 21:46:10), so the deploy took the recreate path.
- The ADR 0012/0013 preflight ran on the server for the first time (both chains `verdict=ok` at 21:46:22).
- The container was recreated; readiness failed at 21:47:55 UTC (`ponder_did_not_become_ready`).

**Why.** The container crash-looped with `MigrationError: Schema "kargain" was previously used by a different Ponder app` ([#66](https://github.com/kargain-com/kargain/issues/66)). Between `d4cc802` and `20f0e67`, the only change under `src/` was `src/svm-ingest/main.ts` ([#58](https://github.com/kargain-com/kargain/pull/58)). Ponder hashes every indexing source under `src/**` outside `src/api` into `build_id`, so that svm-ingest change alone produced a new `build_id`. The identity fingerprint did not cover `src/svm-ingest/`, so the deploy printed no reindex warning (`Ponder identity fingerprint=bca1a526… (no prior identity change detected)`). Same class as [r4 cause 2](./r4-deploy-restore.md) (2026-10-25).

## Recovery (2026-10-29)

1. Under `.deploy.lock`, the maintainer ran `docker compose stop ponder`, then `scripts/ponder-reindex.sql`. That printed `DROP SCHEMA`, with 68 objects, all in schema `kargain`; `ponder_rpc_cache_1` and `ponder_sync` were untouched ([#66](https://github.com/kargain-com/kargain/issues/66)).
2. `docker compose start ponder`. The container started at 07:56:26 UTC with `restarts=0`. `/status` reported both chains at blocks timestamped 07:57:12–07:57:19 UTC; `/ready` returned 200 when checked shortly after 08:00 UTC. With the RPC cache intact, the full backfill took about a minute ([#66](https://github.com/kargain-com/kargain/issues/66)).
3. **Second recreate (attempt 2).** [Run 40773454611](https://github.com/kargain-com/kargain/actions/runs/40773454611) was re-run after recovery (**attempt 2**, finished 2026-10-29 08:02:36 UTC). The executable still differed from the stored state (`prior_executable=9659399a…` → `new_executable=49054916…`), so the job **recreated** Ponder again (`deploy_evidence outcome=recreated`, `ready=ponder status=200`, `preflight=ok` at **08:02:32 UTC**) and wrote the deploy state file ([#66 comment](https://github.com/kargain-com/kargain/issues/66#issuecomment-6492374797)). Any unavailability during that replacement was not measured; 08:02:32 is the log bound.
4. The next deploy, `workflow_dispatch` [run 40844969305](https://github.com/kargain-com/kargain/actions/runs/40844969305) on `732a95f`, took the unchanged path.

## Evidence

### Attempt 1 (failed) — [run 40773454611](https://github.com/kargain-com/kargain/actions/runs/40773454611) attempt 1

`gh run view 40773454611 --attempt 1 --log` (fingerprint / preflight / readiness):

```
Ponder identity fingerprint=bca1a526880de93398406c6fc79088a208f72ee5ee9bdd0ec76880a6bf9c40b7 (no prior identity change detected)
Ponder executable fingerprint changed — recreating container
prior_executable=9659399ae58812f42ae27cb8da6d798cd1e8d0a6ed2c1bcb2b6aef2224d9c1f9 new_executable=49054916d054604c9ce0582d689e92c446df76a5dea6b22a1b68969e3f74a16e
deploy_preflight service=ponder chain=84532 provider=0 verdict=ok
deploy_preflight service=ponder chain=11155111 provider=0 verdict=ok
ponder_did_not_become_ready: GET http://127.0.0.1:42069/ready did not answer within 90000ms
```

Timestamps in that log: executable-change line **21:46:10 UTC**; both preflights **21:46:22 UTC**; readiness error **21:47:55 UTC**. No `deploy_evidence` lines were written (the job failed before that step).

### Attempt 2 (success, second recreate) — [run 40773454611](https://github.com/kargain-com/kargain/actions/runs/40773454611) attempt 2

`gh run view 40773454611 --attempt 2 --log | grep deploy_evidence` (and preceding fingerprint lines):

```
Ponder identity fingerprint=bca1a526880de93398406c6fc79088a208f72ee5ee9bdd0ec76880a6bf9c40b7 (no prior identity change detected)
Ponder executable fingerprint changed — recreating container
prior_executable=9659399ae58812f42ae27cb8da6d798cd1e8d0a6ed2c1bcb2b6aef2224d9c1f9 new_executable=49054916d054604c9ce0582d689e92c446df76a5dea6b22a1b68969e3f74a16e
deploy_preflight service=ponder chain=84532 provider=0 verdict=ok
deploy_preflight service=ponder chain=11155111 provider=0 verdict=ok
deploy_evidence outcome=recreated
deploy_evidence commit=20f0e675ccc2e35ee26340bd246b03ce4430c6cb
deploy_evidence node=v24.22.1
deploy_evidence ready=ponder status=200
deploy_evidence preflight=ok
```

`deploy_evidence` lines at **08:02:32 UTC**.

### Unchanged path after recovery — [run 40844969305](https://github.com/kargain-com/kargain/actions/runs/40844969305)

`workflow_dispatch` on `732a95f`. `gh run view 40844969305 --log | grep deploy_evidence`:

```
deploy_evidence outcome=unchanged
deploy_evidence executable=49054916d054604c9ce0582d689e92c446df76a5dea6b22a1b68969e3f74a16e
deploy_evidence node=v24.22.1
deploy_evidence ready=ponder status=200
```

## What prevents a repeat (on `master` today)

- **[#70](https://github.com/kargain-com/kargain/issues/70) / [#78](https://github.com/kargain-com/kargain/pull/78)** (squash `64b7b99`): svm-ingest-owned modules live under `svm-ingest/`, outside Ponder’s indexing directory. [`scripts/lib/ponder-indexing-glob.ts`](../../../scripts/lib/ponder-indexing-glob.ts) is the sole owner of the indexing-file set; policy tests pin that the svm-ingest static-import closure ∩ indexing glob is empty. **Prevents** a non-indexing svm-ingest edit from changing Ponder’s `build_id`.
- **[#83](https://github.com/kargain-com/kargain/pull/83)**: the executable fingerprint walks the full Ponder deploy-input graph ([`scripts/lib/ponder-executable-fingerprint.ts`](../../../scripts/lib/ponder-executable-fingerprint.ts)); deploy workflow `paths` must cover every deploy input ([`.github/workflows/deploy-ponder.yml`](../../../.github/workflows/deploy-ponder.yml), [`test/deploy-ponder-svm-ingest-ci-policy.test.ts`](../../../test/deploy-ponder-svm-ingest-ci-policy.test.ts)). **Prevents** a deploy-input change from shipping without the matching workflow seeing it, or from being missing from the recreate graph.
- **Remaining open class.** Changes to the inputs owned by [`scripts/lib/ponder-identity-fingerprint.ts`](../../../scripts/lib/ponder-identity-fingerprint.ts) (the digest that decides “a reindex may be required”) still change Ponder’s `build_id` and still need a planned reindex / manual schema drop on today’s model. That class is owned by [#77](https://github.com/kargain-com/kargain/issues/77) (ADR 0016: one writer, one schema per commit, automatic switch).

## Verdict

| Surface | State after recovery |
|---|---|
| Ponder | Schema dropped; manual start at 07:56:26; then **recreated** again by attempt 2 with `ready=ponder status=200` at 08:02:32 |
| Fingerprint state | Written by attempt 2 of [run 40773454611](https://github.com/kargain-com/kargain/actions/runs/40773454611) |
| Next deploy | [Run 40844969305](https://github.com/kargain-com/kargain/actions/runs/40844969305) took `unchanged` |
| svm-ingest → `build_id` class | Closed by [#78](https://github.com/kargain-com/kargain/pull/78) |
| Remaining open | [#77](https://github.com/kargain-com/kargain/issues/77) — changes to identity-fingerprint inputs still require a planned reindex until ADR 0016 |
