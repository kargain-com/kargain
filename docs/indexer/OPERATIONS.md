# Ponder indexer operations (VPS deploy runbook)

Ponder deploys follow [ADR 0016](../adr/0016-one-writer-schema-per-indexing-identity.md): one writer, one Postgres schema per **indexing identity**, an automatic switch, a rollback by dispatch, and retention of exactly two schemas. There is **no manual schema drop** in any procedure here — a manual drop would delete the rollback schema.

A change to `ponder.schema.ts`, an indexed handler, the registry (`COMMERCIAL_ACTIVE` addresses or start blocks), `Dockerfile.ponder` or the lockfile changes the indexing identity. The next deploy then starts the writer on a fresh schema `k_<40 hex>` and backfills it (from the RPC cache when warm). A change that reaches only `src/api/` or `docker-compose.yml` is a restart in place on the same schema.

---

## Production state (Nuclear #7 + Solana Devnet — live on `master`)

**Committed stack:** Nuclear #7 on **84532** + **11155111** and Solana Devnet namespace **2000040168** in `COMMERCIAL_ACTIVE` / SPEC I.9 (S9 closed in code). Nuclear #4 is historical only.

| Item | Value |
|------|--------|
| Hub contracts | `COMMERCIAL_ACTIVE[84532]` / SPEC I.9.1 — `indexFromBlock` **46119704** |
| Eth contracts | `COMMERCIAL_ACTIVE[11155111]` / SPEC I.9.2 — `indexFromBlock` **11591966** |
| Solana | `COMMERCIAL_ACTIVE[2000040168]` — start cursor `min(blocks.*)` (staking floor **490463509**); writer = `svm-ingest` |
| Start blocks | `COMMERCIAL_ACTIVE[chainId].blocks.*` only (ADR 0016 §a); no env key |
| Hub RPC | `PONDER_RPC_URLS_84532` (comma-separated https; required; no default) · `PONDER_GETLOGS_BLOCK_RANGE_84532` |
| Eth RPC | `PONDER_RPC_URLS_11155111` · `PONDER_GETLOGS_BLOCK_RANGE_11155111` — probe with `pnpm ponder:rpc-probe` before any `.env` change |
| Address resolution | Per-chain `COMMERCIAL_ACTIVE` in git (`lib/web3/commercial-active.ts`) only; `deployments/<chainId>.json` is never read by the indexer |
| Ponder deploy | Deploy Ponder workflow → [`scripts/ponder-deploy.sh`](../../scripts/ponder-deploy.sh) (no manual `docker compose build ponder`) |
| Writer | `kargain-ponder:writer`; its schema is the image's `ENV DATABASE_SCHEMA`; record in `/opt/kargain/.ponder-deploy/state.json` |

**C3 schema (July 2026):** `chainId` on commerce/passport/records/uri-history/verifier; verifier PK `` `${chainId}-${address}` ``. **S7c-3:** stored `passport.custodyChain` removed — fold at read via `custody_determining_event` + `bridge_crossing`.

**Omnichain ordering:** `ponder.config.ts` sets `ordering: "omnichain"`. Cross-chain consistency for owner/status/uri waits on both networks (**consistency > liveness**).

Historical: Nuclear #4 hub **44957457** / Eth **11404204** — superseded by Nuclear #7 **46119704** / **11591966**. Runbook: [ops/deploys/nuclear-7.md](../ops/deploys/nuclear-7.md).

**Handlers:** dual-chain event indexing in `src/index.ts` + gateway crossings in `src/bridge-handlers.ts` — a handler or schema change is an indexing change, so the deploy switches to a fresh schema.

---

## S9 cutover — COMPLETE in code (historical checklist)

**September 2026:** `bridge_crossing`, **`custody_determining_event`**, and SVM ingest/projection landed; S9-A (N7 EVM) and S9-B (Solana commercial + `svm-ingest`) are **closed**. Do **not** read the steps below as open work — they are the completed cutover record. Raw/projection schemas are **never** selected by Ponder deploy retention.

### S9-A — EVM (N7 + schema reindex) — DONE

1. Cut over `COMMERCIAL_ACTIVE` + SPEC I.9 to Nuclear #7 (`indexFromBlock` **46119704** / **11591966**) — **done**.
2. Full dual-chain schema wipe and backfill (the procedure of that time); gateway start blocks from `COMMERCIAL_ACTIVE[chainId].blocks.bridgeGateway`.
3. Apply empty [`projection-schema.sql`](../../svm-ingest/db/projection-schema.sql) so UNION HTTP had an empty SVM arm before S9-B.
4. Smoke Ponder `/ready` then `GET /read-path-ready`.
5. Smoke fold-at-read via [`src/lib/ponder-passport-custody.ts`](../../src/lib/ponder-passport-custody.ts).
6. *(Historical)* `svm-ingest` stayed down until S9-B — **superseded**.
7. `pnpm bridge:wire` N7 hub↔eth peers; `bridge:wire:read-only` PASS.

### S9-B — Solana commercial activation — DONE

Solana Devnet namespace **2000040168** lives in `COMMERCIAL_ACTIVE`; `svm-ingest` is the append-only writer. Apply **`kargain_svm_raw`** (incl. **`metadata_snapshot`**) + **`kargain_svm_projection`**, smoke `/live` + `/ready`, run **`pnpm svm-projection:replay-digest`** after first raw backfill. Projection rebuild reads snapshots from raw only.

**Physical column casing (Ponder 0.16):** `DATABASE_SCHEMA=kargain` tables use **snake_case** (`chain_id`, not `"chainId"`). Confirm on any instance with:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'kargain' AND table_name = 'passport'
ORDER BY 1;
```

Drizzle browse on production maps JS `chainId` → physical `chain_id` automatically. Raw SQL owners must spell the physical name.

---

## SVM ingest (S7c-1)

**September 2026:** standalone **`svm-ingest`** Docker service append-only writes structured Solana `Program data:` payloads into Postgres schema **`kargain_svm_raw`**. Run it via `docker compose up -d --force-recreate svm-ingest`.

### Health (port 42100)

| Route | Meaning |
|-------|---------|
| `GET /live` | Process up |
| `GET /ready` | Caught up with no incident; **503** during first signature-discovery bootstrap, when startup retention fails, when discovery/RPC budget incidents fire, or when post-bootstrap discovered backlog exceeds the catch-up window |

Smoke (local): `curl -sf http://127.0.0.1:42100/live` · `curl -sf http://127.0.0.1:42100/ready`

### Bootstrap vs incident

Start cursor owner is `resolveIngestStartSlot()` in `lib/svm/ingest-config.ts`: **`min(blocks.*)`** over the six commercial program start slots on the live Solana `COMMERCIAL_ACTIVE` row. There is **no** second start-slot field and **no** runtime dependency on `deployments/svm-40168.json` (evidence is deploy-machine assert only).

`svm-ingest` discovers work with `getSignaturesForAddress` per followed program (floor = that program’s `blocks.*`), then calls `getBlock` **only** for discovered slots. It does **not** scan every slot from the cursor to tip. SQL column `last_contiguous_slot` is the high-water **processed discovered** slot (name kept; meaning is not “every slot scanned”).

**getBlock transport:** JSON-RPC `getBlock` with `maxSupportedTransactionVersion: 1` (sole owner `lib/svm/rpc-max-supported-transaction-version.ts`) plus the wire mapper `lib/svm/rpc-block-transactions.ts` (signatures + `meta.logMessages` only). Do **not** use `@solana/web3.js` `Connection.getBlock` on this path — that client schema rejects transaction `version: 1` after the RPC opt-in (`transactions.N.version` / `literal | literal`). A Ponder `MigrationError` / schema wipe is a separate `build_id` event and is **not** caused by this decode path.

On a fresh cursor, `svm-ingest` writes `bootstrap_state = historical_backfill` and stays not-ready until all six programs have been paged to their floors, every discovered slot has been processed (or named-missing), and a verification re-poll finds no extra signatures in range. Empty discovery completes bootstrap and parks the watermark at the observed head **only when** discovery reports `reachedEveryProgramFloor` (every program enumerated to its deploy floor). Empty discovery without that positive fact keeps `historical_backfill`, leaves the watermark unchanged, and records retriable `bootstrap_range_not_enumerated` on `/ready`. This phase is expected and does **not** raise `catchup_window_exceeded`. Live follow uses the **same** discovery path for slots above the watermark (no tip every-slot `getBlock` mode).

Request budget: `SVM_INGEST_MAX_RPS` (default **3**) is the sole shared throttle for signature pages and `getBlock`. The Solana web3.js client is constructed with `disableRetryOnRateLimit: true` so HTTP 429 is handled only by the ingest RPC owner (bounded backoff → `rpc_budget_exhausted` on `/ready` **503**). Every JSON-RPC request carries an explicit per-request time bound (`getBlock` and Connection `fetch`); a timeout or transport unreachable maps to retriable `rpc_unreachable` on `/ready` **503** and never permanently halts follow. Incomplete signature pagination records `discovery_incomplete`. Bootstrap that did not enumerate every program floor records `bootstrap_range_not_enumerated`. These are **retriable**: they update `ingest_cursor.catchup_incident` and `/ready` only — they are **not** written into append-only `kargain_svm_raw.ingest_refusal` (that table keeps chain/sequence refusals). They do not permanently halt follow; the next successful discovery tick clears the incident and `/ready` returns to ready. Permanent halt incidents remain `catchup_window_exceeded`, `startup_retention_unavailable`, and hard `sequence_gap` (those do append a `sequence_gap` refusal row). Live follow is a serial loop (`runFollowLoop`): one tick finishes before the next starts after `SVM_INGEST_POLL_MS`; while `bootstrap_state` is set the same loop retries catch-up.

A discovered slot that returns missing / JSON-RPC **-32009** is a named refusal (`discovered_slot_missing_block`); the watermark advances; the process does **not** exit. Ordinary empty slots are simply never visited.

### Startup retention refusal

Before catch-up, `svm-ingest` probes `getFirstAvailableBlock`. If the configured `SOLANA_RPC_URL` cannot serve the required start slot (`resolveIngestStartSlot`), or discovery later names a slot below first-available, startup refuses by name, records a `sequence_gap` row with `incident = startup_retention_unavailable`, and keeps `/ready` at **503**.

### Catch-up window exceeded (post-bootstrap incident)

Default `SVM_INGEST_CATCHUP_MAX_LAG_SLOTS=216000` (~24h at ~400ms/slot). After bootstrap completes, lag is measured on **discovered** work only: if the oldest unprocessed discovered slot is older than `head - window`, the service raises `catchup_window_exceeded`. An idle tip gap with no discovered backlog is **not** lag.

1. Service **stops advancing** the cursor.
2. `/ready` returns **503** with JSON carrying `bootstrapState`, `incident`, `lagSlots`, and `lastContiguousSlot`.
3. Append `sequence_gap` refusal row(s) as applicable.

**Operator recovery (do not silent deep-fetch):**

1. Confirm intentional re-anchor vs RPC outage — check Solana RPC health and `COMMERCIAL_ACTIVE` Solana `blocks.*` (follow start = `min` over the six commercial keys).
2. If re-anchor is correct: stop `svm-ingest`, set cursor via SQL on `kargain_svm_raw.ingest_cursor` to the chosen high-water discovered slot (or truncate raw tables + reset cursor if rebuilding from registry `min(blocks)`), restart service. Raising the registry minimum permanently skips earlier slots without a raw rebuild.
3. If RPC was transient: restore RPC, restart; service catches up within window.
4. Verify `/ready` 200 and run `pnpm svm-raw:replay-digest` on a snapshot if validating rebuild integrity.

Ponder deploy retention selects only `k_<40 hex>` and `kargain`, so it can never drop `kargain_svm_raw` or `kargain_svm_projection` (`test/ponder-deploy-retention-policy.test.ts`).

### Schema bootstrap

On start, `svm-ingest` runs [`svm-ingest/db/schema.sql`](../../svm-ingest/db/schema.sql) and [`svm-ingest/db/projection-schema.sql`](../../svm-ingest/db/projection-schema.sql), then **asserts** the live `metadata_snapshot` form: CHECK `metadata_snapshot_digest_status_ck` and partial unique index `metadata_snapshot_captured_uri_digest_uidx` must exist. `CREATE TABLE IF NOT EXISTS` does not reshape a table created before that form — bootstrap refuses by name and tells you to drop `kargain_svm_raw.metadata_snapshot` (or schema `kargain_svm_raw`) on that database, then restart. Same Postgres instance as Ponder; separate schema names.

### S9-B enable / rollback

Enable:

1. `git pull origin master`
2. Confirm `SOLANA_RPC_URL` matches the endpoint you intend `svm-ingest` to use (no `deployments/` copy required on VPS).
3. `docker compose build svm-ingest`
4. `docker compose up -d --force-recreate svm-ingest`
5. `curl -s http://127.0.0.1:42100/live`
6. `curl -s http://127.0.0.1:42100/ready | python3 -m json.tool`
7. Wait for `/ready` to flip from `{"bootstrapState":"historical_backfill", ...}` to `{"status":"ready", "bootstrapState":null, ...}`.
8. Run `pnpm svm-projection:replay-digest`.

Rollback (canonical detail: [ops/deploys/s9-b-solana-cutover.md](../ops/deploys/s9-b-solana-cutover.md)):

1. `docker compose stop svm-ingest`
2. Revert the cutover commit if product-side Solana reachability must close immediately.
3. **`kargain_svm_raw` is never dropped as part of rollback** (same for `kargain_svm_projection`). Ponder deploy retention does not own those schemas.
4. A later intentional rebuild (drop both SVM schemas, restart from evidence `min(deploySlot)`) is a new enable — not rollback.


### Recommended VPS `.env` (RPC profiles)

Commercial RPC is a **list** plus an explicit `eth_getLogs` window. There is no default URL and no singular `PONDER_RPC_URL_<chainId>` for 84532 / 11155111. Every provider in a list must pass `pnpm ponder:rpc-probe` at the configured window before the `.env` change.

**Profiles** (`.env` edit + `docker compose up -d --no-build --force-recreate ponder`; no schema change — RPC lists and windows are transport, outside the indexing identity and Ponder `build_id`):

| Profile | When | Example |
|---------|------|---------|
| **backfill** | History catch-up | History-serving providers only; large window |
| **steady** | After `/ready` **200** | More providers allowed; window = smallest maximum among them |

```bash
# backfill example
PONDER_RPC_URLS_84532=https://base-sepolia.gateway.tenderly.co
PONDER_GETLOGS_BLOCK_RANGE_84532=50000
PONDER_RPC_URLS_11155111=https://rpc.sepolia.ethpandaops.io
PONDER_GETLOGS_BLOCK_RANGE_11155111=30000

# steady example (Base), after /ready 200 and probe pass:
# PONDER_RPC_URLS_84532=https://base-sepolia.gateway.tenderly.co,https://84532.rpc.thirdweb.com,https://sepolia.base.org
# PONDER_GETLOGS_BLOCK_RANGE_84532=200
```

### Start blocks and addresses

Start blocks and addresses come from `COMMERCIAL_ACTIVE` in git only. They decide which rows exist, so they change through a reviewed registry change, never through a server edit. The server `.env` sets **no** start-block key, **no** `PONDER_*_ADDRESS` key and **no** `DATABASE_SCHEMA`; the deploy preflight refuses each by key (`reason=removed_env_key key=<KEY>`, `reason=database_schema_override`, `reason=local_mode_set key=<KEY>`) before any mutation.

### Deploy model (ADR 0016)

**Identities** — one owner, [`scripts/lib/ponder-executable-fingerprint.ts`](../../scripts/lib/ponder-executable-fingerprint.ts), one graph walk over the image's tree:

| Identity | Files | Decides |
|----------|-------|---------|
| **Indexing** | closure of `ponder.config.ts`, `ponder.schema.ts` and the indexing glob, plus `Dockerfile.ponder`, `pnpm-lock.yaml`, `package.json` runtime slice | The schema: `k_` + first 40 hex |
| **Executable** | indexing set plus the `src/api/index.ts` closure and `docker-compose.yml` | Whether the writer restarts |

Every `process.env` read in the indexing closure is classified `database`, `transport` or `local` by [`scripts/lib/ponder-indexing-env-census.ts`](../../scripts/lib/ponder-indexing-env-census.ts); none can change rows on a commercial chain. Neither identity is Ponder's `build_id`; the evidence prints `build_id` as read from the schema's `_ponder_meta`.

**Images and state:**

- Base image `kargain-ponder:deploy`, built from `git archive <DEPLOY_SHA>` (untracked files never reach it).
- Writer image `kargain-ponder:<commit>` = base + `ENV DATABASE_SCHEMA=<schema>`. The `ponder` service runs `kargain-ponder:writer`; re-pointing that tag is the only switch.
- `.ponder-deploy/state.json` = `{current, previous, switching}`. A disagreeing observation, an unreadable file or an unknown field refuses with `deploy_state_invalid: <detail>` and changes nothing.
- Tooling runs in the one-off Compose service `ponder-deploy` (profile `deploy`); the host runs only `git`, `flock` and `docker`.

**Deploy** (every push to `master`, or dispatch with `operation: deploy`):

1. Build the base image; compute both identities; validate the state.
2. Executable identity equals `current` → `outcome=unchanged`, nothing restarts; retention runs.
3. Otherwise preflight (RPC lists, refused keys), derive the writer image, switch: write `switching`, retag, `up -d --no-build --force-recreate ponder`, require any `/ready` answer within 90s.
   - Answered → commit the state, run retention, wait up to 600s for `/ready` 200 (`switch=ready` or `switch=catching_up`).
   - Not answered → `ponder_did_not_become_ready`; the tag returns to `current` (`outcome=returned`, exit 1). The failed commit's schema is left empty or partial and is dropped by retention.

**Rollback** — dispatch Deploy Ponder with `operation: rollback`. It switches to `previous` without a preflight; that schema was written by its own identity, so the start is a crash recovery. After it, `previous` is the ref rolled back from. The next push to `master` ships `master` again. Refusals: `deploy_rollback_failed: no_previous` · `deploy_rollback_failed: previous_image_missing`.

**Retention** (after every commit, return and unchanged run): drop every schema named `k_<40 hex>` or `kargain` that is not `current`'s or `previous`'s; remove every `kargain-ponder` tag except `current`, `previous`, `writer` and `deploy`; label-scoped dangling prune plus `docker builder prune -f --filter until=72h`. `public`, `ponder_sync`, `ponder_rpc_cache_1`, `kargain_svm_raw` and `kargain_svm_projection` are never selected. `ponder db prune` is not used.

**Interrupted runs** resume on the next run: a set `switching` is repeated before the run's own operation (`deploy_evidence resolved=committed` when it commits). A failed return prints `deploy_return_failed` and leaves `switching` set for the next run.

**First run** (the merge of ADR 0016): with no `state.json` and the old fingerprints file present, the run adopts the running writer on schema `kargain` as the legacy ref (`adopted=legacy schema=kargain`), then, in the same run, deploys the commit and switches to `k_<indexing>`. `kargain` is the first `previous` and is dropped by retention at the next switch of any kind. Do not run a manual `docker compose up` while that first ADR 0016 deploy is in progress. If the job prints `first_run_schema_not_legacy`, stop and report; do not edit `.ponder-deploy/` or image tags.

**Evidence** (ADR 0016 §k): the first line is `deploy_evidence operation=<deploy|rollback>`; a switch prints `outcome=recreated`, `commit=`, `schema=`, `indexing=`, `executable=`, `build_id=`, `node=`, `ready=ponder status=`, then `switch=`. A green job proves the writer answered; `switch=ready` proves catch-up.

**Server preconditions:** remove every commercial start-block key and every `PONDER_*_ADDRESS` key from `/opt/kargain/.env`, and set no `DATABASE_SCHEMA`.

**Restart without code/image change** (RPC `.env` edit): `docker compose up -d --no-build --force-recreate ponder` — the writer tag and its schema are unchanged.

---

## When the schema switches

| Change | Deploy result |
|--------|---------------|
| `ponder.schema.ts`, handlers under `src/` (indexing glob), code they reach under `lib/` | New schema, backfill |
| `COMMERCIAL_ACTIVE` addresses or start blocks (Nuclear redeploy, new contract) | New schema, backfill (uncached when the start block moves earlier) |
| `Dockerfile.ponder`, `pnpm-lock.yaml`, `package.json` runtime slice, `patches/` | New schema, backfill (cached) |
| `src/api/**` reached only from `src/api/index.ts`, `docker-compose.yml` | Restart in place, same schema |
| `.env` RPC lists or `eth_getLogs` windows | Manual recreate, same schema (transport) |
| `package.json` `scripts.test:*`, frontend, contracts-only, `svm-ingest/**` | `outcome=unchanged` or no Ponder run |

The maintainer schedules changes that need an uncached backfill (a new chain, an earlier start block). While a new schema fills, the app reads it and lists are briefly incomplete; `/ready` is 503 until caught up.

Examples that **do not** restart Ponder:

- **`svm-ingest/**` / `Dockerfile.svm-ingest` only** — separate compose service; CI [`.github/workflows/deploy-svm-ingest.yml`](../../.github/workflows/deploy-svm-ingest.yml) runs `docker compose build svm-ingest && docker compose up -d --force-recreate svm-ingest` and **never** builds or restarts Ponder. [`.github/workflows/deploy-ponder.yml`](../../.github/workflows/deploy-ponder.yml) must **not** list `svm-ingest/**` or `Dockerfile.svm-ingest` (they are not Ponder inputs). Files under `lib/svm/` that the executable graph reaches **are** Ponder inputs and match that workflow's `paths`; the executable identity, not the path list, decides whether the run restarts the writer.
- **VPS deploys wait on trunk CI.** Both deploy workflows `needs: gates` ([`ci.yml`](../../.github/workflows/ci.yml): compile → typecheck → lint → `test:ci` → build). Full live-manifest match (`commercial-active-manifest-policy`) stays on the deploy machine via `pnpm test:verify`; CI runs the derived partition without that suite.
- Frontend-only, Irys, Basescan verify, shell / nav / filter UI, notifications / watchlist frontend changes.

---

## Prerequisites

- SSH access to the VPS with the repo and `docker-compose.yml`
- **`git pull`** so Ponder uses committed `COMMERCIAL_ACTIVE` (84532 + 11155111) from `lib/web3/commercial-active.ts`
- **`PONDER_RPC_URLS_84532`** + **`PONDER_RPC_URLS_11155111`** and matching **`PONDER_GETLOGS_BLOCK_RANGE_*`** (see RPC profiles above); confirm with `pnpm ponder:rpc-probe`
- No start-block key, no `PONDER_*_ADDRESS` key and no `DATABASE_SCHEMA` in `.env` (the preflight refuses each)

---

## Docker disk hygiene

The July 2026 VPS disk incident came from accumulated unused `ponder` images after repeated builds, not from Postgres data or the relay LMDB. Keep Docker cleanup attached to the deploy flow instead of relying on ad hoc recovery.

### Repo-managed controls

- `docker-compose.yml` uses the Docker `local` logging driver with capped rotation for `postgres`, `ponder`, `cloudflared`, and `strfry`.
- Ponder deploy retention removes `kargain-ponder` tags outside the state, prunes dangling images labelled for that repository, and runs `docker builder prune -f --filter until=72h` (ADR 0016 §j).

### Host-level Docker defaults (manual VPS step)

Configure `/etc/docker/daemon.json` so new containers inherit sane defaults and BuildKit garbage-collects old cache. Merge with any existing daemon settings rather than replacing unrelated keys.

```json
{
  "log-driver": "local",
  "log-opts": {
    "max-size": "20m",
    "max-file": "5"
  },
  "builder": {
    "gc": {
      "enabled": true,
      "defaultKeepStorage": "2GB",
      "policy": [
        {
          "all": true,
          "keepStorage": "5GB"
        }
      ]
    }
  }
}
```

After editing `daemon.json`:

```bash
sudo systemctl restart docker
cd /opt/kargain
docker compose up -d --force-recreate postgres ponder cloudflared strfry
```

### Safe inspection and cleanup

```bash
df -h /
docker system df
docker image prune -f
docker builder prune -f --filter until=72h
```

- `docker image prune -f` removes dangling images only.
- `docker builder prune -f --filter until=72h` trims stale build cache while keeping very recent cache hot.
- Do **not** automate `docker volume prune` or `docker system prune --volumes` on this stack; named volumes hold Postgres and relay state.

### Periodic host automation

Docker does not ship a built-in timer for pruning unused images. Prefer a `systemd` timer on the VPS over cron, for example a weekly service that runs:

```bash
/usr/bin/docker image prune -af --filter until=168h
/usr/bin/docker builder prune -af --filter until=168h
```

After enabling the timer:

```bash
systemctl list-timers | grep docker-prune
```

---

## Steps (production VPS)

Every Ponder deploy, schema change and rollback goes through the Deploy Ponder workflow; there is no manual build, drop or start-block step.

### 1. Deploy or roll back

- **Deploy:** push to `master` (path-filtered), or dispatch Deploy Ponder with `operation: deploy`.
- **Rollback:** dispatch Deploy Ponder with `operation: rollback`.

The job runs `gates`, takes the server lock, checks out the pinned SHA and execs `scripts/ponder-deploy.sh <operation> kargain kargain-ponder`. Read its `deploy_evidence` lines.

### 2. Verify stack and environment

```bash
pnpm ponder:config
```

Contract addresses and start blocks resolve **per chain** from **`COMMERCIAL_ACTIVE[chainId]`** in [`lib/web3/commercial-active.ts`](../../lib/web3/commercial-active.ts) (SPEC §I.12.12). After a Nuclear redeploy, update `COMMERCIAL_ACTIVE` + SPEC I.9.x in git; the deploy of that commit switches schema.

**VPS `.env` — infrastructure only (backfill profile):**

```bash
PONDER_RPC_URLS_84532=https://base-sepolia.gateway.tenderly.co
PONDER_GETLOGS_BLOCK_RANGE_84532=50000
PONDER_RPC_URLS_11155111=https://rpc.sepolia.ethpandaops.io
PONDER_GETLOGS_BLOCK_RANGE_11155111=30000
DATABASE_URL=...                    # Postgres for Ponder
```

### 3. Wait for sync

```bash
docker compose exec ponder printenv DATABASE_SCHEMA PONDER_RPC_URLS_84532 PONDER_GETLOGS_BLOCK_RANGE_84532 PONDER_RPC_URLS_11155111 PONDER_GETLOGS_BLOCK_RANGE_11155111
cat .ponder-deploy/state.json
docker inspect kargain-ponder-1 --format '{{json .HostConfig.LogConfig}}'
```

**Progress facts live on readiness surfaces — not on container logs.**

| Surface | Question it answers | Green means | Does **not** claim |
|---------|---------------------|-------------|-------------------|
| Ponder reserved `GET /ready` | Sync / catch-up for the Ponder process | HTTP 200 when caught up (503 during backfill) | That the custom EVM+SVM UNION read path can execute |
| Ponder reserved `GET /status` | Tip / lag vs RPC | Tip near public RPC | Read-path UNION executability |
| `GET /read-path-ready` | Schema shape + UNION probes (`readPathRequiredRelations()` on the writer's schema / `READ_PATH_PROBE_NAMES`) | Relations present and empty-arm probes run | Tip catch-up; bootstrap progress |
| svm-ingest `GET /ready` (:42100) | Bootstrap / incident / lag (`bootstrapState`, `incident`, `lagSlots`, `lastContiguousSlot`) | Caught up with no incident | That Ponder EVM indexing is live |
| Deploy probe (CI) | `answered`: the writer answered `/ready` within 90s; then `ready200`: 200 within 600s | `switch=ready status=200` | `switch=catching_up` is a green job that has not caught up |

```bash
# Wait for Ponder catch-up (not logs):
curl -si http://127.0.0.1:42069/ready | head -5    # expect 200 when caught up
curl -si http://127.0.0.1:42069/status | head -20
curl -s http://127.0.0.1:42069/read-path-ready | python3 -m json.tool
# svm-ingest progress (bootstrap / bootstrap_range_not_enumerated / lag):
curl -s http://127.0.0.1:42100/ready | python3 -m json.tool
```

`docker compose logs ponder` remains available for incident debug (MigrationError, RPC WARN). It is **not** the acceptance path for “are we caught up?”

### 4. Smoke checks

```bash
curl -si https://ponder.kargain.com/ready | head -5    # expect HTTP/2 200 when caught up (503 during backfill)
curl -s https://ponder.kargain.com/read-path-ready | python3 -m json.tool
curl -si https://ponder.kargain.com/status | head -20
curl -s https://ponder.kargain.com/passports | jq '.total'
curl -s https://ponder.kargain.com/consignments | jq '.total'   # 0 until first Nuclear #7 consignment opens (post-Merge reindex)
curl -s https://ponder.kargain.com/commerce-payment-tokens | jq '.total'   # expect 4 after Nuclear #7 reindex (USDC × 2 modes × 2 chains)
curl -s https://ponder.kargain.com/accounts/0x0000000000000000000000000000000000000001/obligations | jq 'keys'
curl -s https://ponder.kargain.com/notifications/0x0000000000000000000000000000000000000001 | jq '.total // .items | length'
curl -s https://ponder.kargain.com/challenges | jq '.total'
curl -s https://ponder.kargain.com/passports/<tokenId> | jq '.status, .disputeDeposit'
curl -s 'https://ponder.kargain.com/agents/0x0000000000000000000000000000000000000001/mandates?active=false' | jq '.total, .page, .limit'
```

**Browse Phase 1 filter divergence (B1) — run after a schema switch to prove filters are live:**

```bash
# Unfiltered active page vs a filter that must empty the set (bodies + total must differ).
curl -s 'https://ponder.kargain.com/consignments?limit=50&active=true' | jq '{total, statusCounts, n:(.consignments|length)}'
curl -s 'https://ponder.kargain.com/consignments?limit=50&active=true&make=Honda' | jq '{total, statusCounts, n:(.consignments|length)}'
# Expect: Honda total = 0 when no Honda lots; total and body must not match unfiltered when the set empties.
# Case-insensitive make (lower() index predicate):
curl -s 'https://ponder.kargain.com/consignments?limit=50&active=true&make=Test' | jq .total
curl -s 'https://ponder.kargain.com/consignments?limit=50&active=true&make=test' | jq .total   # must equal the previous
# CSV fuel predicate:
curl -s 'https://ponder.kargain.com/consignments?limit=50&active=true&fuelType=Petrol' | jq .total
```

**Tip check:** compare `/status` block numbers to public RPC `eth_blockNumber` for 84532 and 11155111 — lag ≤ ~5 blocks is live.

**EXPLAIN ANALYZE (optional, VPS Postgres only):** confirm planner uses `lower(make)` / `lower(fuel_type)` expression indexes on filtered browse. Not available from the public HTTP API — run on the indexer DB host after a schema switch. With one live lot the plan is not diagnostic; revisit when `consignment` volume grows (see MIGRATION-V2). Does **not** block Phase 2 HTTP cache headers.

Replace `<tokenId>` with a known minted passport. `/health` is Ponder’s reserved liveness route (empty body is normal); use `/ready` and `/status` for sync state, and `GET /read-path-ready` for the custom read-path check that names missing relations. The examples use `python3 -m json.tool` because it is present on the VPS without requiring `jq`. Custom app routes are listed in [indexer/README.md](./README.md#http-api).

### 4.0 App ↔ indexer shipping (normative, keep light)

Monorepo reality: **one `git push` to `master` deploys the Next app on Vercel automatically.** The Ponder indexer is a **separate** VPS process (this runbook). There is **no** separate “app deploy” step after a Ponder deploy.

**Default practice (do this; do not invent heavier orchestration):**

1. Push schema/index/handler changes to `master` as usual (Vercel ships the app).
2. The Deploy Ponder run of that push switches schema; watch its `switch=` line.
3. Smoke `/ready` + `/read-path-ready` + `/status` (tip) + **B1** above. Until `/read-path-ready` and B1 pass, treat the read path as unproven — during the window the UI may send browse params the old indexer ignores (**fail-open**: wider unfiltered results, not corrupt money/custody), or the indexer may be caught up while the unioned projection path is unreadable.
4. Do **not** build staging-branch / Ignore-Build / two-commit / “indexer-before-push” rituals unless a change fails closed on money, custody, or auth, or the ignore-window becomes hours of user-visible lies.

### 4.1 Browse Phase 1 cutover proof (August 14, 2026)

Recorded against [ponder.kargain.com](https://ponder.kargain.com) after the Phase 1 index reindex (~12:19 UTC):

| Check | Result |
|-------|--------|
| `GET /ready` | **HTTP 200** |
| `GET /status` tip | baseSepolia **45470826** (RPC lag **5**); ethereumSepolia **11487147** (RPC lag **0**) — both at tip |
| payment-tokens | `total: 4` |
| passports | `total: 6` |
| B1 unfiltered `active=true` | `total: 1`, `statusCounts.UNVERIFIED: 1` |
| B1 `make=Honda` | `total: 0`, empty `statusCounts`, **body ≠ unfiltered** |
| B1 `make=Test` / `make=test` | both `total: 1` (CI via `lower(make)`) |
| B1 `fuelType=Other` / `Petrol` | `1` / `0` |
| B1 `status=UNVERIFIED` / `VERIFIED` | `1` / `0` |
| EXPLAIN ANALYZE | **Not run** from agent host (no indexer DB access); optional residual on VPS |
| App | **Live** on Vercel from `master` push `cbe07d2` (automatic; not a second ops step) |

### 4.2 Cloudflare Cache Rules (Phase 2 — maintainer; not agent-run)

Ponder JSON paths are **not** in Cloudflare’s default cacheable extensions, so without Cache Rules you will keep seeing `CF-Cache-Status: DYNAMIC` even after origin sends `Cache-Control`. Origin headers alone are insufficient; rules make the path **eligible**, then origin `Cache-Control` / Edge TTL govern storage.

**Prerequisite:** indexer image with Phase 2 middleware deployed (origin returns `Cache-Control` + `ETag` on custom Hono routes). Do **not** put Cache Rules on Ponder reserved `/health`, `/ready`, `/status`.

#### Normative: partial Cloudflare enable (stable)

There is **no** Cloudflare purge on the user-tx path. With `s-maxage=0` on `catalog` / `entity` / `account`, Cloudflare does not store those responses. The only edge-cached class is `config` (Timelock-paced; action gates read chain). User-transaction freshness is **Next Data Cache** only: tagged `"use cache"` + `syncReads` → `updateTag` (see REFERENCE T3/T4). Do **not** add CF purge from `syncReads` — it would clean nothing the signal dirties.

**Enable now (only these two rules):**

| Order | Rule name | Matching | Then |
|------|-----------|----------|------|
| 1 | `ponder-ephemeral-bypass` | URI Path starts with `/verifiers/slug-available` | Bypass cache (Eligible for cache: **No**) |
| 2 | `ponder-config` | URI Path is `/commerce-modes` OR `/commerce-payment-tokens` OR `/commerce-currency-feeds` | Eligible for cache: **Yes**; Edge TTL: Use cache-control header if present, fallback **300s** |

**Do not create** a catch-all “cache all of `ponder.kargain.com`” rule. Do **not** raise shared TTL on `catalog` / `entity` / `account` without a separate Timelock/ops design — Phase 3 does **not** unlock CF projection TTL.

**Why `config` is safe:** Timelock-paced; money/pause action gates read chain (e.g. `use-commerce-mode-paused` → `paused()`, not indexer).

Origin class → `Cache-Control` (middleware):

| Class | Paths (summary) | Origin `Cache-Control` | CF rule now? |
|-------|-----------------|------------------------|--------------|
| `config` | `/commerce-modes`, `/commerce-payment-tokens`, `/commerce-currency-feeds` | `public, max-age=30, s-maxage=300, stale-while-revalidate=60` | **Yes** (rule 2) |
| `ephemeral` | `/verifiers/slug-available/:slug` | `private, no-store` | **Yes** (rule 1 bypass) |
| `catalog` | browse/lists | `public, max-age=0, s-maxage=0, must-revalidate` | **No** |
| `entity` | by-id / by-token / batch / … | `public, max-age=0, s-maxage=0, must-revalidate` | **No** |
| `account` | notifications / claims / obligations | `public, max-age=0, s-maxage=0, must-revalidate` | **No** |

`catalog` / `entity` / `account` still emit weak `ETag`; conditional `If-None-Match` → **304** saves body bytes without storing a stale shared HIT as fresh.

**Prove `config` eligibility / HIT** (after VPS redeploy + rules 1–2):

```bash
# Warm
curl -sSI 'https://ponder.kargain.com/commerce-modes?limit=1' | tr -d '\r' | grep -iE '^(HTTP/|cf-cache-status|cache-control|etag|age):'
# Second request — expect CF-Cache-Status: HIT (or REVALIDATED / EXPIRED after TTL), not DYNAMIC
curl -sSI 'https://ponder.kargain.com/commerce-modes?limit=1' | tr -d '\r' | grep -iE '^(HTTP/|cf-cache-status|cache-control|etag|age):'

# Catalog must stay uncached at edge (DYNAMIC — not a warm HIT of an old list)
curl -sSI 'https://ponder.kargain.com/consignments?limit=1' | tr -d '\r' | grep -iE '^(HTTP/|cf-cache-status|cache-control|etag):'
```

**Notes:** Push to `master` deploys the Next app only; redeploy the **VPS ponder container** for middleware headers. App projection cache is Next Data Cache (T3), not Cloudflare.

---

## Local dev (31337)

```bash
PONDER_ENABLE_LOCAL=1 PONDER_START_BLOCK_31337=0 pnpm ponder:dev
```

After a schema change, delete the local PGlite directory (`.ponder/pglite`, or `PONDER_PGLITE_DIR`) or your local Postgres database, then restart from block `0`. Production schemas are never dropped by hand.

Local agent auction lifecycle (chain + Ponder phase polls) is covered by `./scripts/e2e-local.sh`.

---

## Troubleshooting

| Symptom | Action |
|---------|--------|
| `eth_getLogs` window rejected / 26-block shrink / rate limits on public RPC | Run `pnpm ponder:rpc-probe`; switch to the **backfill** profile (history-serving providers + large window); recreate ponder |
| Provider `history_pruned` / `window_rejected` / `rate_limited` | Remove that URL from `PONDER_RPC_URLS_*` or lower `PONDER_GETLOGS_BLOCK_RANGE_*` to the provider maximum that passes the probe |
| `404` HTML from `rpc.sepolia.org` | Endpoint is dead — use a real Sepolia JSON-RPC URL in `PONDER_RPC_URLS_11155111` |
| `Unable to find available JSON-RPC provider` | Every URL in the list failed; probe and replace with providers that pass at the configured window |
| `Cannot read properties of undefined (reading 'id')` in handlers | Ensure image has `context.chain.id` indexing (not `event.chain`) — pull + rebuild |
| `MigrationError` / "different Ponder app" | The schema was written by another identity — a defect of ADR 0016 §a (a server env key or untracked file changed `build_id`). Do not drop the schema; check the preflight refusals and `deploy_evidence` lines, then roll back by dispatch |
| `deploy_state_invalid: <detail>` | Nothing changed. Compare `.ponder-deploy/state.json` with `docker inspect` of `kargain-ponder:writer` and the container; restore the observed state, then re-run |
| `deploy_return_failed` | `switching` stays set; the next run repeats the return. Inspect `docker compose logs ponder` first |
| Slow / stalled Base backfill | Use backfill profile (e.g. Tenderly + large window); do not rely on pruned public endpoints for history |
| Empty `fuelType` on old rows | Expected until metadata URIs are re-fetched during replay; ensure Arweave reachable from VPS |
| API shows v1 `passport id 0` after v2 deploy | Confirm `pnpm ponder:config` → v2 karPassport and that `COMMERCIAL_ACTIVE` on the deployed commit names it |
| API 404 for passport | Token minted on deprecated pre-v1.1 contract — not in current index |
| Env change ignored | Use `docker compose up -d --no-build --force-recreate ponder` (not `restart` alone) after editing `.env` |

---

## Related files

| File | Purpose |
|------|---------|
| `scripts/ponder-deploy.sh` | Host side of the Ponder deploy (git, docker); run by the Deploy Ponder workflow |
| `scripts/ponder-deploy-step.ts` | Tooling side (in `ponder-deploy`): state, switch, retention, probes |
| `scripts/lib/ponder-deploy-switch.ts` | Deploy, rollback, resumption and first run (ADR 0016 §f–§k) |
| `scripts/lib/ponder-deploy-retention.ts` | Schema and image retention (owned names only) |
| `scripts/ponder-config.ts` | Read-only stack diagnostic (`pnpm ponder:config`) |
| `scripts/ponder-rpc-probe.ts` | CLI: probe every commercial RPC at the configured getLogs window (`pnpm ponder:rpc-probe`) |
| `scripts/lib/ponder-rpc-probe.ts` | Sole owner of RPC capability verdicts |
| `scripts/lib/resolve-sepolia-stack.ts` | `resolveCommercialStack`: `COMMERCIAL_ACTIVE` only |
| `Dockerfile.ponder` | Copy `patches/` before `pnpm install` (Docker build on VPS) |
| `scripts/lib/ponder-env.ts` | Dual-chain RPC lists, getLogs windows, registry start blocks, local mode |
| `scripts/verify.ts` | Basescan verify active Sepolia stack |
| `scripts/deploy.ts` | Nuclear commercial deploy (84532 / 11155111) |
| `lib/web3/commercial-active.ts` | **Committed** per-chain stacks — the only commercial address and start-block source |
| `deployments/<chainId>.json` | Deploy artifact; compared with the registry by deploy-machine asserts; never read by the indexer for commercial chains |
| [contracts/SPEC.md Part I.9.1](../contracts/SPEC.md#i91-active-deployment-base-sepolia-84532) | **Active** Base Sepolia addresses |
| [contracts/SPEC.md Part I.9.2](../contracts/SPEC.md#i92-active-deployment-ethereum-sepolia-11155111) | **Active** Ethereum Sepolia addresses |
| [contracts/SPEC.md Part II.4](../contracts/SPEC.md#ii4-historical-deployment-base-sepolia-84532) | **Historical** v1.x Sepolia addresses |
| [MIGRATION-V2.md](./MIGRATION-V2.md) | v2 handler reference + FX extension |
| [ops/deploys/nuclear-7.md](../ops/deploys/nuclear-7.md) | Nuclear #7 deploy / S9-A wire-before-Merge + reindex |
| [ops/deploys/nuclear-4.md](../ops/deploys/nuclear-4.md) | Historical Nuclear #4 (denylisted; superseded by N7) |
| [ops/deploys/archive/84532-v2.md](../ops/deploys/archive/84532-v2.md) | Historical June 2026 generation v2 |
