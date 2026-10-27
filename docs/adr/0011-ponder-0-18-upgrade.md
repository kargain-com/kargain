# 0011 — Ponder 0.18.2 upgrade

## Context

Measured on `905a908` with Ponder **0.16.6** from the installed npm package (`node_modules/ponder`, same contents as `npm pack ponder@0.16.6`) and Ponder **0.18.2** from `npm pack ponder@0.18.2`. Official guides: [Migration guide · 0.17](https://ponder.sh/docs/migration-guide#017), [Migration guide · 0.18](https://ponder.sh/docs/migration-guide#018). Changelog: `ponder@0.18.2` `CHANGELOG.md`.

```bash
rg -n 'ponder\.on\("|onOptionalContractEvent\(\s*"' src/index.ts src/commerce-handlers.ts src/bridge-handlers.ts
rg -n 'ordering:|ethGetLogsBlockRange|rpc:' ponder.config.ts scripts/lib/ponder-env.ts
rg -n 'event\.trace|disableCache|networks:|context\.network|transfer:from|transfer:to|experimental_isolated|factory:' \
  ponder.config.ts ponder.schema.ts src/ --glob '*.ts'
rg -n 'from ["'\'']ponder|from ["'\'']ponder:' --glob '*.{ts,tsx}'
rg -n 'from ["'\'']ponder' lib/ scripts/ --glob '*.ts'
nl -ba scripts/ponder-reindex.sql | sed -n '25,26p'
```

### Request fan-out on 0.16.6

Unfiltered event filters set `topic1` / `topic2` / `topic3` to `null`:

```568:581:node_modules/ponder/src/build/config.ts
      let topic1: LogTopic;
      let topic2: LogTopic;
      let topic3: LogTopic;
      // ...
      } else {
        topic1 = null;
        topic2 = null;
        topic3 = null;
      }
```

Historical sync merges by address only when those topics are **`undefined`**, not when they are `null`:

```485:490:node_modules/ponder/src/sync-historical/index.ts
        const hasAddress = filter.address !== undefined;
        const hasTopic1 = filter.topic1 !== undefined;
        const hasTopic2 = filter.topic2 !== undefined;
        const hasTopic3 = filter.topic3 !== undefined;

        if (hasAddress === false || hasTopic1 || hasTopic2 || hasTopic3) {
```

`null !== undefined`, so every unfiltered handler takes the single-request path: **one `eth_getLogs` per (contract, event)**.

**Counting method (our tree, commercial config with all six contracts resolved):** unique registrations of `ponder.on("…")` in `src/index.ts` plus `onOptionalContractEvent("…")` in `src/commerce-handlers.ts` and `src/bridge-handlers.ts`.

| Contract | Handled events |
|----------|----------------|
| KarPassport | 17 |
| KarProPass | 3 |
| KarProStaking | 5 |
| FixedPriceConsignment | 21 |
| AscendingConsignment | 30 |
| KarPassportBridgeGateway | 2 |
| **Total** | **78** |

Both commercial chains (84532 / 11155111) resolve the same six contracts from `COMMERCIAL_ACTIVE`. Result: **78 `eth_getLogs` per chain per backfill step**.

### Step estimator stays at 25

```1120:1122:node_modules/ponder/src/runtime/historical.ts
  // Estimate optimal range (blocks) to sync at a time, eventually to be used to
  // determine `interval` passed to `historicalSync.sync()`.
  let estimateRange = 25;
```

```1340:1348:node_modules/ponder/src/runtime/historical.ts
      estimateRange = estimate({
        from: interval[0],
        to: interval[1],
        target: params.common.options.command === "dev" ? 2_000 : 10_000,
        result: duration,
        min: 25,
        max: 100_000,
        prev: estimateRange,
        maxIncrease: 1.5,
      });
```

```1:26:node_modules/ponder/src/utils/estimate.ts
export const estimate = ({
  from, to, target, result, min, max, prev, maxIncrease,
}: { /* ... */ }) => {
  const density = (to - from) / (result || 1);
  // min <= estimate <= prev * maxIncrease or max
  return Math.min(
    Math.max(min, Math.round(target * density)),
    Math.round(prev * maxIncrease),
    max,
  );
};
```

Production numbers from [#51](https://github.com/kargain-com/kargain/issues/51): ~3.5 req/s per public provider, 78 requests per step → about **22 s** per step. With target **10_000 ms** and a 25-block window: `10_000 × 25 / 22_000 ≈ 11`, then `Math.max(25, 11) = 25`. Growth is capped at `prev × 1.5`, so the step never leaves 25. `#48` `ethGetLogsBlockRange` only caps chunk size **inside** a step; it cannot grow the step.

### What 0.17.6 / 0.17.8 change (measured in 0.18.2)

From `ponder@0.18.2` `CHANGELOG.md`:

- **0.17.6:** “Improved backfill sync performance by combining compatible JSON-RPC `eth_getLogs` requests.”
- **0.17.8:** “Improved backfill sync performance by merging more compatible JSON-RPC `eth_getLogs` requests.”

Owner in 0.18.2: `src/runtime/filter.ts` `mergeLogFiltersToRequests` (quoted from `npm pack ponder@0.18.2`, lines 114–122):

```ts
/**
 * Merge `LogFilter`s into the smallest possible set of "eth_getLogs" requests.
 *
 * @dev Two filters are merged into a single request when:
 *   1. their required intervals overlap by at least 80% (of the smaller
 *      interval's length), and
 *   2. at most one of `address`, `topic0`, `topic1`, `topic2`, or `topic3`
 *      differs between them.
 * The one differing dimension (if any) is unioned into an array.
```

For our unfiltered handlers (`topic1/2/3` null/absent after sanitize), filters that share a contract **address** and differ only in `topic0` merge into one request with a `topic0` array. Filters that differ in **both** address and `topic0` do not merge (two differences).

**After the change, for our config:** **6 `eth_getLogs` per chain per step** — one per distinct contract address (KarPassport, KarProPass, KarProStaking, FixedPriceConsignment, AscendingConsignment, KarPassportBridgeGateway). Same interval for all filters in a step. The implementation Docker run records the observed count (may be ≤6 if same-signature cross-address merges also fire).

### Omnichain fix (0.18.0)

`ponder@0.18.2` `CHANGELOG.md` **0.18.0:** “Fixed a bug with `ordering: \"omnichain\"` that caused backfill events to be ordered incorrectly or skipped.”

We set that mode explicitly:

```76:76:ponder.config.ts
  ordering: "omnichain",
```

### Production state (from #51)

Since the #49 deploy: `/status` Base around **46119762** (unchanged), `progress=0.0%`, requests spanning **25** blocks, 429s from Tenderly. `ponder-rpc-probe` is `ok` for both chains — RPC capability is not the blocker. Schema `kargain` holds **58** indexed Base blocks. `ponder_sync` must survive the upgrade (its own migrations).

## Decision

Upgrade **`ponder` to `0.18.2`**. Keep **`ordering: "omnichain"`**. Keep the #48 transport: commercial `rpc` URL lists, `ethGetLogsBlockRange`, and `ponder-rpc-probe`.

Confirmed still present on `ponder@0.18.2` `src/config/index.ts`:

- `ordering?: "omnichain" | "multichain" | "experimental_isolated"`
- `rpc: string | string[] | Transport | undefined`
- `ethGetLogsBlockRange?: number`

### Breaking changes (0.17 and 0.18 migration guides only)

Every breaking change listed under [0.17](https://ponder.sh/docs/migration-guide#017) and [0.18](https://ponder.sh/docs/migration-guide#018). Surfaces checked: `ponder.config.ts`, `ponder.schema.ts`, every `src/` handler, `src/api/**`, and every `from "ponder"` / `ponder:*` import. Grep for `lib/` and `scripts/` direct ponder imports: **empty**.

| Change | Touches us? | Implementation |
|--------|-------------|----------------|
| **0.17** — Node.js `>=22`, TypeScript `>=5.4.0`, Viem `>=2.35.0` | Peers already satisfied: Node **24.22.1** ([ADR 0009](./0009-node-runtime-single-owner.md), `.node-version`, `Dockerfile.ponder:1`); lockfile `typescript@5.9.3`, `viem@2.47.4`, `hono@4.12.8` | Bump `ponder` to `0.18.2` in the implementation PR; **no** peer version moves required. Lockfile changes when `ponder` resolves. |
| **0.18** — `event.trace` shape (`traceAddress`; remove `traceIndex` / `subcalls` / `error` / `revertReason`) | **no** — `rg -n 'event\.trace' ponder.config.ts ponder.schema.ts src/ --glob '*.ts'` empty | None |
| **0.18** — first start migrates RPC cache `ponder_sync` → `ponder_rpc_cache_1` (0.17 and 0.18 do not share cache data; pre-0.10 `ponder_sync` fails closed) | **yes** — production uses Postgres with a live `ponder_sync` (post-0.10). `ponder@0.18.2` `src/database/index.ts` `migrateSync()` | Let startup run `migrateSync()`; **never** drop `ponder_sync`. Local Docker confirms migration logs. |
| **0.18** — account `transfer:from` / `transfer:to` exclude `DELEGATECALL` / `CALLCODE` | **no** — no account transfer indexers (`rg` for `transfer:from` / `transfer:to` empty in config/schema/src) | None |
| **0.18** — removed `disableCache` (replaced by `cacheRpcRequests`) | **no** — `rg -n 'disableCache' ponder.config.ts scripts/lib/ponder-env.ts src/` empty | None; leave default `cacheRpcRequests: true` |
| **0.18** — Node.js `>=22.12` | Already on **24.22.1** (≥22.12) | None |

Related **non-breaking** items in those guide sections (factory migration, `reorgWindow`, co-located tests, telemetry removal): we do not use factories (`rg` for `factory:` empty); no config change required.

### Peer and runtime requirements (`ponder@0.18.2` `package.json`)

| Requirement | Declared | Our lockfile / runtime | Lockfile must move? |
|-------------|----------|------------------------|---------------------|
| Node | `engines.node` `>=22.12` | 24.22.1 | no |
| `viem` peer | `>=2.35` | `2.47.4` | no |
| `typescript` peer | `>=5.4.0` | `5.9.3` | no |
| `hono` peer | `>=4.5` | `4.12.8` | no |
| `drizzle-orm` | dependency `0.41.0` (not a peer) | already `drizzle-orm@0.41.0` via ponder 0.16.6 | only as needed when resolving `ponder@0.18.2` |
| `ponder` | — | `^0.16.6` / `0.16.6` | **yes → `0.18.2`** (implementation PR) |

### `build_id` and reindex verdict

From `ponder@0.18.2` `src/build/index.ts`:

- `BUILD_ID_VERSION = "2"` (same string as 0.16.6).
- `buildId = sha256(BUILD_ID_VERSION + configContentHash + schemaContentHash + indexingContentHash).slice(0, 10)`.
- Config content hash inputs: `ordering`, `contracts`, `accounts`, `blocks` — **not** `chains[].rpc` / `ethGetLogsBlockRange`.
- Schema hash: `ponder.schema.ts` file bytes.
- Indexing hash: contents of indexing-dir sources (0.18.2 also ignores `*.{test,spec}.*` under that dir).

App metadata `VERSION` in `src/database/index.ts` is **`"6"`** in both 0.16.6 and 0.18.2. Startup refuses with `MigrationError` when `previousApp.version !== VERSION` or (non-dev) `previousApp.build_id !== buildId`.

**Verdict:** 0.18.2 **can** start on a `kargain` schema written by 0.16.6 **if** the stored `build_id` still matches (package version is not hashed; `VERSION` is unchanged). If either check fails, it **cannot** — `MigrationError` naming a different minor version or a different Ponder app.

**Local Docker (implementation PR) — what each result means:**

| Observed | Meaning |
|----------|---------|
| Process starts; no `MigrationError` on schema `"kargain"` | Compatible with the existing schema (`build_id` / `VERSION` accepted) |
| `MigrationError` about different minor version or different Ponder app | Must `DROP SCHEMA kargain CASCADE` before the new image can serve that database |

**Production procedure anyway:** drop schema **`kargain` only** before the new image takes traffic (58 Base blocks → cheap clean backfill). **Never** drop `ponder_sync`. **Do not use** `scripts/ponder-reindex.sql` — it drops both:

```25:26:scripts/ponder-reindex.sql
DROP SCHEMA IF EXISTS kargain CASCADE;
DROP SCHEMA IF EXISTS ponder_sync CASCADE;
```

### `ponder_sync` migration

`migrateSync()` in `ponder@0.18.2` `src/database/index.ts` migrates sync schemas forward in place (create + copy into newer sync schema names such as `ponder_rpc_cache_1` per the 0.18 guide). A deploy **never** drops `ponder_sync`. Some cached RPC data is not shared with 0.18 (guide: 0.17 and 0.18 do not share cache data; factory/trace copy caveats apply). Backfill may refetch ranges that are no longer in the shared cache; that is expected and is not a reason to drop `ponder_sync`.

### Production rollout sequence

1. **Preflight:** run `ponder-rpc-probe` **inside the new image** (same RPC lists / windows as production). Refuse cutover if not `ok`.
2. **Reindex step (required for this upgrade’s clean backfill):** stop ponder; `DROP SCHEMA kargain CASCADE` only; leave `ponder_sync` untouched. Do **not** run `scripts/ponder-reindex.sql`.
3. **Deploy:** build/recreate the ponder container on the new image so it starts against empty `kargain` + migrated `ponder_sync`.
4. **Evidence:** probe `ok`; sync-migration / startup log without `MigrationError`; `/status` Base block advancing; backfill step size **> 25**; `eth_getLogs` per step against the 0.16.6 baseline (expect ~6 vs 78).

**Avoiding the 2026-10-25 failure:** that incident replaced the running container first; the new image then refused the old schema (`MigrationError`) with no healthy prior process left. This rollout drops `kargain` **before** the new image is the sole process expected to serve, after preflight on the new image, so a refused schema cannot strand production mid-replace. Workflow-level refuse-before-replace remains [#50](https://github.com/kargain-com/kargain/issues/50) (out of scope here).

## One rejected alternative and why

Stay on **0.16.x** and coalesce `eth_getLogs` in a custom viem transport (answer per-event requests from one address-array request per window). Rejected: it re-implements request merging that upstream ships in 0.17.6 / 0.17.8, inside our indexer data path, and it leaves the **0.18.0 `ordering: "omnichain"`** backfill ordering bug in place.

## Consequences

### Implementation PR acceptance (from #51)

- `pnpm test`, `pnpm test:verify`, `pnpm test:ponder` (with the reindex verdict), `pnpm typecheck`, and `pnpm build`, each on the PR head.
- **Local Docker** against real public RPCs: `docker build -f Dockerfile.ponder`, run with local Postgres and the production backfill profile (`PONDER_RPC_URLS_84532=https://base-sepolia.gateway.tenderly.co`, window 50000; `PONDER_RPC_URLS_11155111=https://rpc.sepolia.ethpandaops.io`, window 30000; production start blocks). Required evidence:
  - `ponder-rpc-probe` `ok` inside the image;
  - `/status` sampled at least three times over ≥ 10 minutes, with Base advancing;
  - backfill step growing past 25 blocks (trace or debug log);
  - `eth_getLogs` per step compared with 0.16.6 (expect ~6 vs 78);
  - projected completion time derived from measured step growth.

### Follow-ups this upgrade does not cover

- [#47](https://github.com/kargain-com/kargain/issues/47) — per-deployment schema, stable read surface
- [#50](https://github.com/kargain-com/kargain/issues/50) — deploy preflight in the workflow (refuse before replacing the running container)
- Replacing `scripts/ponder-reindex.sql` so it no longer drops `ponder_sync`

## Status

Accepted. The maintainer’s merge of this ADR PR is the acceptance.
