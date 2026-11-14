# R24 — ADR 0016 first production switch (2026-11-14)

**Status: COMPLETE** (2026-11-14). The first ADR 0016 deploy adopted the legacy writer on schema `kargain`, then switched to `k_<indexing>`. Schema `kargain` remains `previous` (rollback target).

Related: [#88](https://github.com/kargain-com/kargain/issues/88) · [#87](https://github.com/kargain-com/kargain/issues/87) / [#89](https://github.com/kargain-com/kargain/pull/89) · [ADR 0016](../../adr/0016-one-writer-schema-per-indexing-identity.md) · [indexer OPERATIONS](../../indexer/OPERATIONS.md)

## Window

| | |
|---|---|
| Merge tip | `3ac4f8b83ff3839b7850acc43283c0bc5f6487ef` — squash-merge of [#89](https://github.com/kargain-com/kargain/pull/89) (implements [#87](https://github.com/kargain-com/kargain/issues/87)) |
| Deploy run | [43624857952](https://github.com/kargain-com/kargain/actions/runs/43624857952) (push; two attempts) |
| Attempt 1 job | [132540101826](https://github.com/kargain-com/kargain/actions/runs/43624857952/job/132540101826) — `deploy`, failure (2026-11-14 18:14:07–18:16:54 UTC) |
| Attempt 2 job | [132544628713](https://github.com/kargain-com/kargain/actions/runs/43624857952/job/132544628713) — `deploy` re-run only, success (2026-11-14 18:29:25–18:31:09 UTC); reuses green `gates` from attempt 1 |
| Schemas | before: `kargain` → after: `k_aef572585c5b185339c97edf4a94a57a30d1b0e9` (`kargain` retained as `previous`) |
| Manual `docker compose up` | none |

## Attempt 1 — first run adopted legacy; env check stopped the switch

Job [132540101826](https://github.com/kargain-com/kargain/actions/runs/43624857952/job/132540101826). The first-run path adopted the running writer on schema `kargain` (`adopted=legacy`, then `ready=ponder status=503`). Preflight then refused on `PONDER_START_BLOCK_11155111` (`reason=removed_env_key`). Cause: [#88](https://github.com/kargain-com/kargain/issues/88) step 1 was incomplete at merge — that commercial start-block key was still set in the server `.env`. The refusal fired before any schema switch, as ADR 0016 §a requires. No values from `.env` are recorded here; only the key name.

Evidence lines (UTC):

```
2026-11-14T18:16:15Z  deploy_evidence operation=deploy
2026-11-14T18:16:42Z  deploy_evidence adopted=legacy schema=kargain
2026-11-14T18:16:42Z  deploy_evidence ready=ponder status=503
2026-11-14T18:16:52Z  deploy_preflight service=ponder verdict=refused reason=removed_env_key key=PONDER_START_BLOCK_11155111
2026-11-14T18:16:52Z  deploy_evidence outcome=refused
```

## Attempt 2 — switch completed after env cleanup

Job [132544628713](https://github.com/kargain-com/kargain/actions/runs/43624857952/job/132544628713), same commit `3ac4f8b`. After the removed keys left `.env`, the job resumed from `state.json`. Preflight passed; the writer recreated onto `k_aef572585c5b185339c97edf4a94a57a30d1b0e9`. `switch=ready status=200` 57 s after the recreate evidence (`18:30:10` → `18:31:07` UTC). Schema `kargain` is `previous` and is the rollback target.

Evidence lines (UTC):

```
2026-11-14T18:29:37Z  deploy_evidence operation=deploy
2026-11-14T18:29:46Z  deploy_preflight service=ponder chain=84532 provider=0 verdict=ok
2026-11-14T18:29:47Z  deploy_preflight service=ponder chain=11155111 provider=0 verdict=ok
2026-11-14T18:30:10Z  deploy_evidence preflight=ok
2026-11-14T18:30:10Z  deploy_evidence outcome=recreated
2026-11-14T18:30:10Z  deploy_evidence commit=3ac4f8b83ff3839b7850acc43283c0bc5f6487ef
2026-11-14T18:30:16Z  deploy_evidence schema=k_aef572585c5b185339c97edf4a94a57a30d1b0e9
2026-11-14T18:30:16Z  deploy_evidence indexing=aef572585c5b185339c97edf4a94a57a30d1b0e9b21b84208ae91e9b3100bccb
2026-11-14T18:30:16Z  deploy_evidence executable=24912a00ded99fdd67d10f5d163504030ec782d8386c65f090a4004aa56eb2d7
2026-11-14T18:30:16Z  deploy_evidence build_id=993c0f701a
2026-11-14T18:30:21Z  deploy_evidence node=v24.22.1
2026-11-14T18:30:21Z  deploy_evidence ready=ponder status=503
2026-11-14T18:31:07Z  deploy_evidence switch=ready status=200
```

## Notes from verification ([#88](https://github.com/kargain-com/kargain/issues/88))

- Step 1.4 empty-output comment was not posted. `preflight=ok` on attempt 2 is accepted in its place: that check reads the env Compose resolves for `ponder` (removed keys and local-mode keys included), and attempt 1 shows the check can fail.
- `indexing` and `executable` on attempt 2 match rehearsal run 1 at `f086850` (same tree as the squash merge). Identities depend only on the commit's files.
- No manual schema drop. No RPC URLs or `.env` values in this record.
