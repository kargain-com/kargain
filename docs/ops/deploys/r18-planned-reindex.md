# R18 — Planned reindex at the merge of #78 (2026-10-30)

**Status: COMPLETE** (2026-10-30; post-checks 2026-10-31). Schema `kargain` was dropped under the deploy lock before the squash-merge of [#78](https://github.com/kargain-com/kargain/pull/78); both deploy workflows recreated; backfill finished with the RPC cache intact; both writers stayed up.

Related: [#70](https://github.com/kargain-com/kargain/issues/70) (merge procedure) · [#78](https://github.com/kargain-com/kargain/pull/78) · [#66](https://github.com/kargain-com/kargain/issues/66) · [#81](https://github.com/kargain-com/kargain/pull/81) (window lower bound) · [r16](./r16-ponder-build-id-outage.md)

## Unavailability window

| | |
|---|---|
| Stop | Exact clock time **unknown**. Bounded: after about 11:54 UTC (post-[#81](https://github.com/kargain-com/kargain/pull/81) check showed Ponder up and `/ready` 200) and before 12:22 UTC (`master` and the stopped writer were observed) |
| Merge | 12:25:12 UTC — [#78](https://github.com/kargain-com/kargain/pull/78) squash `64b7b99` |
| End | 12:37:13 UTC — `Started live indexing` on both chains |
| Bound | From that stop to 12:37:13 — at most about 43 minutes, of which the deploy (`gates`, build, backfill) took about 12 minutes after the 12:25 merge |

A separate first `/ready` 200 clock time was not recorded beyond that end bound.

## Procedure

### 1. Before the merge

Under `.deploy.lock`, the maintainer ran `docker compose stop ponder`, then `scripts/ponder-reindex.sql`.

- Output: `DROP SCHEMA`, cascading to 68 objects, all in schema `kargain`.
- Afterwards `\dn` listed `kargain_svm_projection`, `kargain_svm_raw`, `ponder_rpc_cache_1`, `ponder_sync` and `public`.

### 2. Merge

[#78](https://github.com/kargain-com/kargain/pull/78), squash `64b7b99`, 12:25:12 UTC. Procedure source: [maintainer merge steps on #70](https://github.com/kargain-com/kargain/issues/70#issuecomment-6520500504); facts and timeline on [#66](https://github.com/kargain-com/kargain/issues/66).

### 3. Deploy runs

**Ponder — [run 41055197485](https://github.com/kargain-com/kargain/actions/runs/41055197485)**

- Identity-change warning: `prior_identity=bca1a526…`, `new_identity=35153260…`.
- `prior_executable=65f06efa…`, `new_executable=60da3ff3…`, `outcome=recreated`, `preflight=ok`.
- `ready=ponder status=503` at 12:37:02 UTC (during backfill).
- State file written with `35153260…` / `60da3ff3…`.

**svm-ingest — [run 41055197499](https://github.com/kargain-com/kargain/actions/runs/41055197499)**

- Built from the new `svm-ingest/` root.
- All six program preflights `verdict=ok`.
- `outcome=recreated` and `ready=svm-ingest status=200` at 12:36:39 UTC.

## Backfill timeline (2026-10-30, UTC)

From Ponder logs ([#66](https://github.com/kargain-com/kargain/issues/66#issuecomment-6541115121)):

| Time | Event |
|---|---|
| 12:37:00 | `Started backfill indexing`. Base Sepolia `[46119719,52208845]` (`cache_rate=99.9%`); Ethereum Sepolia `[11591977,12026702]` (`cache_rate=100%`) |
| 12:37:01 | Backfill JSON-RPC fetch finished for Ethereum Sepolia (1s) |
| 12:37:12 | Backfill JSON-RPC fetch finished for Base Sepolia (12s); `Completed backfill indexing across all chains (12s)` |
| 12:37:13 | `Started live indexing` on both chains (finalized blocks 52208845 and 12026702) |

## Evidence after backfill

Checked 2026-10-31 ([#66](https://github.com/kargain-com/kargain/issues/66#issuecomment-6541097731)):

- Zero `MigrationError` lines since 12:25 UTC.
- Ponder `/ready` 200 and svm-ingest `/ready` 200.
- Both containers up without restarts.

## Procedure lesson

The schema drop and the merge were separated in time. The [#70](https://github.com/kargain-com/kargain/issues/70) maintainer procedure says: step 1 stop + `ponder-reindex.sql`, then step 2 squash-merge immediately. Merging immediately after step 1 bounds the unavailability window to the deploy duration (`gates`, build, backfill). This operation left a gap between the stop (after ~11:54 / before 12:22) and the 12:25:12 merge.

## Verdict

| Surface | State |
|---|---|
| Schema | `kargain` dropped once before merge; SVM raw/projection and RPC cache schemas left intact |
| Ponder | Recreated from `64b7b99`; live indexing from 12:37:13 UTC |
| svm-ingest | Recreated from the new `svm-ingest/` root; `/ready` 200 at 12:36:39 UTC |
| Lesson | Stop/drop and merge must not drift apart |
