# R4 — Deploy restore (2026-10-24 → 2026-10-28)

**Status: RECOVERED** (2026-10-28). Both VPS deploy workflows run again; Ponder and svm-ingest serve on Node.js 24; commercial chains are at head.

Related: [#43](https://github.com/kargain-com/kargain/issues/43) · [ADR 0010](../../adr/0010-serialized-pinned-deploys.md) · [ADR 0011](../../adr/0011-ponder-0-18-upgrade.md) · [indexer OPERATIONS](../../indexer/OPERATIONS.md)

## Outage window

| | |
|---|---|
| Start | 2026-10-24 — every push to `master` failed deploy startup (`appleboy/ssh-action` blocked by the Actions allowlist from [#16](https://github.com/kargain-com/kargain/issues/16)) |
| End | 2026-10-28 07:41 UTC — `/status` at head on both commercial chains; `/ready` 200 |
| Last green before outage | Ponder `6c5cebc` (2026-10-02); svm-ingest `56cddcb` (2026-10-02) |
| Recovery tip | Ponder image `d4cc802` ([run 40582691842](https://github.com/kargain-com/kargain/actions/runs/40582691842)); svm-ingest image `b03a682` ([run 40228824610](https://github.com/kargain-com/kargain/actions/runs/40228824610)) |

Nothing merged after 2026-10-02 was live on the VPS until the recovery runs below. CI (`gates`) stayed green throughout: it uses GitHub-created actions only, so the allowlist block never appeared there.

## Causes and fixes (in order)

### 1. Actions allowlist ([#16](https://github.com/kargain-com/kargain/issues/16))

**Cause.** Repository Actions permissions were tightened so every non-GitHub action must be listed explicitly. The checklist under #16 did not name `appleboy/ssh-action@029f5b4aeeeb58fdfe1410a5d17f967dacf36262`, the only third-party action in the deploy jobs. Startup failure on every deploy after 2026-10-24; example run [40218892469](https://github.com/kargain-com/kargain/actions/runs/40218892469).

**Fix.** Allow that exact SHA in Settings → Actions → General. Recovery itself waited for [#44](https://github.com/kargain-com/kargain/issues/44) / [#46](https://github.com/kargain-com/kargain/pull/46) (ADR 0010): serialized deploys, SHA-pinned checkout, `deploy_evidence` lines in the log. No parallel manual redeploy on the server.

### 2. `MigrationError` after a `src/` change

**Cause.** Between `6c5cebc` and the first post-allowlist deploy tip, `ponder.config.ts`, `ponder.schema.ts`, handlers, and the ABI artifact were unchanged. The only indexing-source change was one import path in `src/lib/ponder-read-namespaces.ts` ([#31](https://github.com/kargain-com/kargain/pull/31)). Ponder hashes indexing sources into `build_id`; that line alone produced a new `build_id`. The first post-#46 Ponder deploy ([run 40228824648](https://github.com/kargain-com/kargain/actions/runs/40228824648)) failed readiness with `MigrationError`.

**Fix.** Drop schema `kargain` and restart (runbook path). Container then reported `node --version` = `v24.22.1`. Later upgrades follow ADR 0011: stop Ponder and drop schema `kargain` only before merge.

### 3. `ponder-reindex.sql` dropping the cache

**Cause.** The 2026-10-25 schema drop used `scripts/ponder-reindex.sql` as prescribed. That script also drops `ponder_sync`, which deleted the September–October RPC cache. After the drop, `ponder_sync` held Base intervals 46119719–46122050 only (plus Ethereum Sepolia 11591977–12005748), so the Base backfill restarted near the hub start block.

**Fix.** [#53](https://github.com/kargain-com/kargain/pull/53) / ADR 0011: `scripts/ponder-reindex.sql` now drops schema `kargain` only. Policy test `test/ponder-reindex-svm-isolation-policy.test.ts` asserts it never drops `ponder_sync` or `ponder_rpc_cache_1`. After Ponder 0.18.2 the active RPC cache is **`ponder_rpc_cache_1`** and must never be dropped.

### 4. Public RPC pruning and limits ([#48](https://github.com/kargain-com/kargain/issues/48))

**Cause.** After the forced reindex, Base Sepolia backfill could not finish on the configured public RPC:

`pruned history unavailable: requested 46119719, earliest available 46500000` (`eth_getBlockByNumber`).

Hub start block remains **46119704**. Ethereum Sepolia showed no such error. Public endpoints that still answered `eth_getLogs` for the old range often could not serve `eth_getBlockByNumber` at the start block, or rate-limited small automatic windows (~26 blocks).

**Fix.** [#49](https://github.com/kargain-com/kargain/pull/49) (closes #48): commercial provider lists, explicit `eth_getLogs` windows, and a capability probe (`pnpm ponder:rpc-probe`). Production Base Sepolia uses `base-sepolia.gateway.tenderly.co` with an explicit window.

**Probe (2026-10-27)** — `eth_getBlockByNumber` at `0x2bfbb18` (46119704) and `eth_getLogs` over `0x2bfbb18..0x2bfbb81`:

| Endpoint | Block at start | Logs at start |
|---|---|---|
| `sepolia.base.org` | pruned (earliest 46500000) | ok |
| `base-sepolia-rpc.publicnode.com` | pruned (earliest 46500000) | refused without an address filter |
| `base-sepolia.drpc.org` | pruned (earliest 46500000) | range limit on the free plan |
| `base-sepolia.blockpi.network` (public) | requires an API key | requires an API key |
| `base-sepolia.gateway.tenderly.co` | ok (hash `0xe4733459…`) | ok |
| `84532.rpc.thirdweb.com` | ok (same block hash) | ok |
| `base-sepolia.api.onfinality.io/public` | ok (same hash) | ok |
| Blockscout `eth-rpc` | rate-limited | rate-limited |

### 5. Ponder 0.16.6 request fan-out and step floor ([#51](https://github.com/kargain-com/kargain/issues/51))

**Cause.** Even on an RPC that serves full history, Ponder 0.16.6 issued one `eth_getLogs` per contract event and its backfill step did not grow past ~25 blocks under public rate limits. That kept Base stuck near the start block while Ethereum Sepolia waited under `ordering: "omnichain"`.

**Fix.** [#53](https://github.com/kargain-com/kargain/pull/53) / ADR 0011: upgrade to Ponder **0.18.2** (merged request filters; omnichain ordering fix from 0.18.0). Maintainer stopped Ponder and dropped schema `kargain` only before the merge. Deployed by [run 40582691842](https://github.com/kargain-com/kargain/actions/runs/40582691842) (success, 2026-10-27 20:58 UTC).

### 6. Missing env at deploy time ([#50](https://github.com/kargain-com/kargain/issues/50))

**Cause.** On the [#49](https://github.com/kargain-com/kargain/pull/49) merge, the Ponder deploy recreated the container while the server `.env` still lacked `PONDER_RPC_URLS_11155111`. The new config refused to build (`missing_rpc_urls`); readiness timed out; the indexer stayed down until the variable was set by hand. Deploy replaced the running container before proving the new image could start against the server's configuration.

**Fix (immediate).** Added `PONDER_RPC_URLS_11155111`, confirmed it with `pnpm ponder:rpc-probe` inside the image (`docker compose run --rm --no-deps ponder …`, verdict `ok` for both chains), then recreated the container. That probe-before-recreate step is the manual form of [#50](https://github.com/kargain-com/kargain/issues/50). **Product fix** remains #50: preflight must refuse before replacing the running container (ADR amendment — open at record time).

## Evidence

### svm-ingest — [run 40228824610](https://github.com/kargain-com/kargain/actions/runs/40228824610)

Triggered by [#46](https://github.com/kargain-com/kargain/pull/46) merge (2026-10-25). `gh run view 40228824610 --log | grep deploy_evidence`:

```
deploy_evidence outcome=recreated
deploy_evidence commit=b03a6826d293dc7bfa62d11d6792d348a32b705f
deploy_evidence node=v24.22.1
deploy_evidence ready=svm-ingest status=200
```

### Ponder — [run 40582691842](https://github.com/kargain-com/kargain/actions/runs/40582691842)

Triggered by [#53](https://github.com/kargain-com/kargain/pull/53) merge (2026-10-27 20:58 UTC). `gh run view 40582691842 --log | grep deploy_evidence`:

```
deploy_evidence outcome=recreated
deploy_evidence commit=d4cc802422589f6abc7823632fb5ab804ee1c8af
deploy_evidence node=v24.22.1
deploy_evidence ready=*** status=503
```

Ponder readiness line: `status=503` (backfill not yet at head at deploy time).

### Readiness after backfill (2026-10-28 07:41 UTC)

| Check | Result |
|---|---|
| `GET /status` | Base Sepolia **51257140**; Ethereum Sepolia **12010885** (both at head) |
| `GET /ready` | **200** |
| `pnpm ponder:rpc-probe` (inside running image) | **ok** — 84532 (Tenderly, window 50000); 11155111 (ethpandaops, window 30000) |

## Verdict

| Surface | State at recovery |
|---|---|
| Deploy workflows | Unblocked; serialized and SHA-pinned (ADR 0010) |
| svm-ingest | Live on Node.js 24 from `b03a682` |
| Ponder | Live on Node.js 24 / Ponder 0.18.2 from `d4cc802`; both commercial chains at head |
| Remaining open from this window | [#50](https://github.com/kargain-com/kargain/issues/50) (deploy preflight before container replace) |
