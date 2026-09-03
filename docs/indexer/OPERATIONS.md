# Ponder indexer operations (VPS reindex runbook)

Use this after **any** change to `ponder.schema.ts` or to indexed handlers that alter stored row shape (e.g. G1 trust fields; passport denorm columns; cover photos; delegation notifications; **July 2026 C3 dual-chain:** `chainId` + chain-scoped verifier keys; **September 2026 S7c-3:** drop stored `passport.custodyChain` / add `custody_determining_event`).

Without reindex, new columns stay empty on historical passports and trust UX (G2 banner, buy-risk context), **listing card cover photos**, **notifications feed**, or **dual-chain custody / verifier identity** will be wrong until new on-chain events occur. Browse filter SQL that only changes the query expression (Asking USD CASE) needs an indexer **image redeploy**, not this wipe.

---

## Production state (Nuclear #4 dual-chain — August 2, 2026)

**Committed stack:** Nuclear #4 on **84532** + **11155111** (`COMMERCIAL_ACTIVE` / SPEC I.9). One full `ponder-reindex.sql` backfills **both** networks.

**VPS:** full reindex from the start blocks below **done** (August 2, 2026 cutover). Production API matches Nuclear #4. Runbook: [ops/deploys/nuclear-4.md](../ops/deploys/nuclear-4.md).

| Item | Value |
|------|--------|
| Hub contracts | `COMMERCIAL_ACTIVE[84532]` / SPEC I.9.1 — `indexFromBlock` **44957457** |
| Eth contracts | `COMMERCIAL_ACTIVE[11155111]` / SPEC I.9.2 — `indexFromBlock` **11404204** |
| Hub start block | `PONDER_START_BLOCK_84532=44957457` |
| Eth start block | `PONDER_START_BLOCK_11155111=11404204` |
| Hub RPC | `PONDER_RPC_URL_84532` (prefer `https://base-sepolia-rpc.publicnode.com`) |
| Eth RPC | `PONDER_RPC_URL_11155111` (Alchemy/Infura/QuickNode; PublicNode often 403) · `PONDER_MAX_RPS_11155111` default **5** |
| Address resolution | Per-chain `COMMERCIAL_ACTIVE` in git (`lib/web3/commercial-active.ts`); optional local `deployments/<chainId>.json` on deploy machine only |
| Docker | `docker compose build ponder` after code pull + post-build prune |

**C3 schema (July 2026):** `chainId` on commerce/passport/records/uri-history/verifier; `passport.chainId` (origin) + `passport.custodyChain` + `custodyUpdatedAt` (monotonic gate); verifier PK `` `${chainId}-${address}` ``. Bridge handlers: `PassportBridgeMinted` / `CustodyLockSet(false)` drive `custodyChain` only when `event.block.timestamp >= custodyUpdatedAt`. **`PassportBridgeMinted` does not project `VerificationReset` accounting** (`verificationResetCount` / `lastVerificationResetAt` / `uri_history.verificationReset` come only from on-chain `VerificationReset`).

**Omnichain ordering:** `ponder.config.ts` sets `ordering: "omnichain"`. Cross-chain consistency for owner/status/uri waits on both networks (**consistency > liveness**). Custody is additionally fail-closed via the monotonic `custodyUpdatedAt` gate if one chain lags and delivers a stale bridge-mint after a fresher unlock.

Historical: June 2026 v2 **43399242** · July 21 Nuclear **44434865** / **11319840** · Nuclear #2 **44833462** / **11384136** · Nuclear #3 **44919727** / **11398068** — superseded by Nuclear #4 hub **44957457** / Eth **11404204**. Runbook: [ops/deploys/nuclear-4.md](../ops/deploys/nuclear-4.md).

**Handlers:** dual-chain event indexing in `src/index.ts` + gateway crossings in `src/bridge-handlers.ts` — deploy + **reindex required** when schema changes.

---

## S9 reindex obligation — bridge crossings + custody fold + SVM (S7b–c)

**September 2026:** `bridge_crossing`, **`custody_determining_event`** (drops stored `passport.custodyChain` / `custodyUpdatedAt`), and SVM ingest/projection schemas landed on the SVM port branch. **No VPS action until S9 cutover** — production stays on Nuclear #4 without historical `ONFTSent` / `ONFTReceived` backfill or custody stream B replay until the planned full `ponder-reindex.sql` at Solana commercial activation.

When S9 cutover runs: include gateway start blocks from `COMMERCIAL_ACTIVE[chainId].blocks.bridgeGateway` (hub **44957539** / Eth **11404235** on N4) in the same dual-chain reindex as other schema changes. HTTP custody is **fold-at-read** via [`src/lib/ponder-passport-custody.ts`](../../src/lib/ponder-passport-custody.ts) — smoke `GET /passports/:tokenId` for `custodyChain` or `custodyUnresolved` on a known bridged token.

**S9 also enables `svm-ingest` on VPS** when Solana commercial activation lands — see [§SVM ingest](#svm-ingest-s7c-1) below. Apply **`kargain_svm_raw`** (incl. **`metadata_snapshot`**) + **`kargain_svm_projection`** (incl. `passport` entity table, `custody_determining_event`, provenance tables), smoke ingest `/live` + `/ready`, run **`pnpm svm-projection:replay-digest`** after first raw backfill (entity + provenance path parity), and run bridge + EVM reindex obligations in the same cutover window. Raw/projection schemas are **not** dropped by `ponder-reindex.sql`. First catch-up may backfill metadata snapshots for URI events observed during ingest; projection rebuild reads snapshots from raw only (no HTTP in rebuild).

**Before svm-ingest is live:** any process that serves passport UNION HTTP (entity, provenance, custody SVM arm) must still have **empty** `kargain_svm_projection` tables. Apply [`src/svm-ingest/db/projection-schema.sql`](../../src/svm-ingest/db/projection-schema.sql) once (local e2e does this after Postgres is ready). Do **not** drop the SVM `UNION ALL` arm or key it on `COMMERCIAL_ACTIVE`.

**Physical column casing (Ponder 0.16):** `DATABASE_SCHEMA=kargain` tables use **snake_case** (`chain_id`, not `"chainId"`). Confirm on any instance with:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'kargain' AND table_name = 'passport'
ORDER BY 1;
```

Drizzle browse on production maps JS `chainId` → physical `chain_id` automatically. Raw SQL owners must spell the physical name.

---

## SVM ingest (S7c-1)

**September 2026:** standalone **`svm-ingest`** Docker service append-only writes structured Solana `Program data:` payloads into Postgres schema **`kargain_svm_raw`**. **No VPS action until S9 cutover** — same gate as bridge crossing backfill; local/dev via `docker compose up svm-ingest`.

### Health (port 42100)

| Route | Meaning |
|-------|---------|
| `GET /live` | Process up |
| `GET /ready` | Caught up and cursor contiguous; **503** when lag exceeds catch-up window or sequence gap |

Smoke (local): `curl -sf http://127.0.0.1:42100/live` · `curl -sf http://127.0.0.1:42100/ready`

### Catch-up window exceeded (incident)

Default `SVM_INGEST_CATCHUP_MAX_LAG_SLOTS=216000` (~24h at ~400ms/slot). On startup, if `chain_head - last_contiguous_slot > window`:

1. Service **stops advancing** the cursor.
2. `/ready` returns **503** with JSON `{"incident":"catchup_window_exceeded","lagSlots":…,"maxLagSlots":…}`.
3. Append `sequence_gap` refusal row(s) as applicable.

**Operator recovery (do not silent deep-fetch):**

1. Confirm intentional re-anchor vs RPC outage — check Solana RPC health and evidence `indexFromSlot`.
2. If re-anchor is correct: stop `svm-ingest`, set cursor via SQL on `kargain_svm_raw.ingest_cursor` to the chosen contiguous slot (or truncate raw tables + reset cursor if rebuilding from evidence start), set `SVM_INGEST_START_SLOT` if needed, restart service.
3. If RPC was transient: restore RPC, restart; service catches up within window.
4. Verify `/ready` 200 and run `pnpm svm-raw:replay-digest` on a snapshot if validating rebuild integrity.

**Never** add `DROP SCHEMA kargain_svm_raw` to `ponder-reindex.sql` — EVM reindex must not touch SVM raw (policy test enforces).

### Schema bootstrap

On first start, `svm-ingest` applies [`src/svm-ingest/db/schema.sql`](../../src/svm-ingest/db/schema.sql) and [`src/svm-ingest/db/projection-schema.sql`](../../src/svm-ingest/db/projection-schema.sql) if tables are missing. Same Postgres instance as Ponder; separate schema names.

### S9 obligation

When Solana joins `COMMERCIAL_ACTIVE`: enable `svm-ingest` in VPS compose, set `SOLANA_RPC_URL` + evidence paths, smoke `/live` + `/ready`, bootstrap **`kargain_svm_projection`** (inline on ingest or `rebuildProjectionFromRaw`), and run bridge + EVM reindex obligations in the same cutover window.


### Recommended VPS `.env` (Nuclear steady state)

```bash
PONDER_RPC_URL_84532=https://base-sepolia-rpc.publicnode.com
PONDER_RPC_URL_11155111=<Alchemy/Infura/QuickNode Sepolia HTTPS>
PONDER_START_BLOCK_84532=44957457
PONDER_START_BLOCK_11155111=11404204
# Optional per-chain RPS (defaults 10 / 5):
# PONDER_MAX_RPS_84532=10
# PONDER_MAX_RPS_11155111=5
```

Optional: Alchemy/QuickNode for heavy backfills. Bare `https://base-sepolia.publicnode.com` (no `-rpc` path / token) may **403** on archive `eth_getLogs`.

### Start block — keep numeric values after sync

**Do not** switch `PONDER_START_BLOCK_84532` or `PONDER_START_BLOCK_11155111` to `latest` after backfill on Ponder **0.16**.

Ponder embeds contract `startBlock` in the app `build_id`. Changing a numeric start block → `latest` changes `build_id` and triggers:

```
MigrationError: Schema "kargain" was previously used by a different Ponder app.
```

After backfill reaches chain head, **leave the same numeric start blocks**. Ponder continues **live indexing** on both chains.

| When | Start blocks |
|------|----------------|
| One-time backfill after `ponder-reindex.sql` | Hub **44957457** + Eth **11404204** (or checkpoints) |
| Steady production (after sync) | **Same numeric values** — do not set `latest` |
| Fresh deploy after schema wipe | Reset both to manifest `indexFromBlock` when running `ponder-reindex.sql` again |

### Deploy new Ponder code (schema change)

1. `docker compose stop ponder`
2. `ponder-reindex.sql` — **before** starting the new image
3. Backfill with both RPCs + both numeric start blocks (one reindex covers hub + spoke)
4. After 100% sync on both chains, keep the same start blocks and RPCs

**Restart without code/image change:** `docker compose stop ponder` → edit `.env` (RPC only) → `docker compose up -d ponder` (no `--build` unless the image changed).

---

## When to reindex

| Trigger | Example |
|---------|---------|
| Schema migration | New columns on `passport`, new tables |
| **Nuclear #4 (August 2, 2026) — current** | Full commercial redeploy both chains — **full reindex done** from hub **44957457** + Eth **11404204**. Runbook: [ops/deploys/nuclear-4.md](../ops/deploys/nuclear-4.md). |
| Older Nuclear / commerce schema triggers | Superseded by Nuclear #4 reindex (same wipe covers modes, claims, challenge terminals, place columns, party indexes, etc.). Local Hardhat: `pnpm deploy:local` then index from block 0. |
| Outstanding obligation party indexes | Included in Nuclear #4 full reindex — required for `GET /accounts/:address/obligations` + commerce notification stamps |
| Notifications feed | `disputeOpenedAt` on `passport` (June 2026 notifications stack) |
| Contract redeploy | KarPassport / FixedPrice / Ascending / gateway address change (Nuclear / Phase 5) |
| Handler shape change | New denormalized fields written on mint / URI update / dispute / bridge |
| Stuck / corrupt sync | Ponder refuses to start after config change |
| `MigrationError` after deploy | New `ponder.schema.ts` in Docker image without `ponder-reindex.sql` |

**Do not reindex** for frontend-only or contract-only changes that do not touch Ponder schema or indexing logic.

Examples that **do not** require reindex:

- Phase 5 polish UI (PR5a–d): typed record labels, attestation form, browse chain-status sample (`getPassportStatus` via wagmi on the client)
- Irys upload hardening (June 2026): client-side only — no Ponder schema change
- Basescan verify (`pnpm verify:sepolia`, `--auction-only` after auction deploy) — ops-only, no indexer impact; HHE80009 bytecode mismatch exits 0 by default
- Shell / nav / filter **UI** refactors that do not change Ponder schema or handler output shape
- Notifications / watchlist **frontend** only (no `ponder.schema.ts` change)
- Owner consignment read API (July 2026): superseded by consignment mandate routes — **redeploy ponder image only** when schema unchanged; no `ponder-reindex.sql` expected (if `MigrationError`, see below)
- Asking USD browse SQL (August 2026): `consignmentPriceUsdSql` consumes `askingUsdcFacts` — **redeploy ponder image only**; no schema wipe (query expression, not stored row shape)
- Challenges browse `status` CSV / `IN` (August 2026): `GET /challenges` — **redeploy ponder image only**; no schema wipe

---

## Prerequisites

- SSH access to the VPS with the repo and `docker-compose.yml`
- **`git pull`** so Ponder uses committed `COMMERCIAL_ACTIVE` (84532 + 11155111) from `lib/web3/commercial-active.ts`
- **`PONDER_RPC_URL_84532`** + **`PONDER_RPC_URL_11155111`** and both numeric start blocks (see Nuclear steady state above)
- Remove stale `deployments/<chainId>.json` on the VPS if present (gitignored local artifacts override committed — `pnpm ponder:config` warns on drift)

---

## Docker disk hygiene

The July 2026 VPS disk incident came from accumulated unused `ponder` images after repeated `docker compose build ponder` runs, not from Postgres data or the relay LMDB. Keep Docker cleanup attached to the deploy flow instead of relying on ad hoc recovery.

### Repo-managed controls

- `docker-compose.yml` uses the Docker `local` logging driver with capped rotation for `postgres`, `ponder`, `cloudflared`, and `strfry`.
- `.github/workflows/deploy-ponder.yml` prunes dangling images and old build cache after a successful `ponder` deploy.
- `scripts/ponder-reindex.sh` prints the same post-rebuild cleanup steps for manual VPS runs.

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

Run from the repository root on the server.

### 1. Deploy new code

```bash
git pull origin master
pnpm install   # if dependencies changed
docker compose build ponder   # only when indexer code / schema changed
docker image prune -f
docker builder prune -f --filter until=72h
```

### 2. Stop Ponder

```bash
docker compose stop ponder
```

### 3. Reset database schemas

**Option A — helper script (recommended):**

```bash
chmod +x scripts/ponder-reindex.sh   # once
./scripts/ponder-reindex.sh
```

**Option B — manual SQL:**

```bash
docker compose exec -T postgres \
  psql -U ponder -d kargain_ponder -v ON_ERROR_STOP=1 \
  < scripts/ponder-reindex.sql
```

This drops and recreates the `kargain` and `ponder_sync` schemas (truncate alone is **not** enough when start block or contract config changes).

### 4. Verify stack and environment

```bash
pnpm ponder:config
```

Contract addresses resolve automatically **per chain** (SPEC §I.12.12): optional `PONDER_*` env (84532 debug) → local `deployments/<chainId>.json` → **`COMMERCIAL_ACTIVE[chainId]`** in [`lib/web3/commercial-active.ts`](../../lib/web3/commercial-active.ts). After a Nuclear redeploy, update `COMMERCIAL_ACTIVE` + SPEC I.9.x in git and **`git pull` on the VPS** — do not paste address exports into `.env`, and do not require copying gitignored manifests onto the server.

**VPS `.env` — infrastructure only (Nuclear steady state):**

```bash
PONDER_RPC_URL_84532=https://base-sepolia-rpc.publicnode.com
PONDER_RPC_URL_11155111=<Alchemy/Infura/QuickNode Sepolia HTTPS>
PONDER_START_BLOCK_84532=44957457
PONDER_START_BLOCK_11155111=11404204
# PONDER_MAX_RPS_84532=10
# PONDER_MAX_RPS_11155111=5
DATABASE_URL=...                    # Postgres for Ponder
```

Optional advanced overrides (84532 only): `PONDER_KAR_PASSPORT_ADDRESS`, `PONDER_KAR_PRO_PASS_ADDRESS`, `PONDER_KAR_PRO_STAKING_ADDRESS`, `PONDER_FIXED_PRICE_CONSIGNMENT_ADDRESS`, `PONDER_ASCENDING_CONSIGNMENT_ADDRESS`, … only when debugging.

**Per-contract start blocks:** from `COMMERCIAL_ACTIVE[chainId].blocks` (or local manifest when present). Confirm with `pnpm ponder:config` after pull.

For G1 schema-only updates (same contract addresses), keep existing infra env; still set start blocks to each `indexFromBlock` for a full replay unless you intentionally use higher checkpoints.

### 5. Start Ponder and wait for sync

```bash
docker compose up -d --force-recreate ponder

docker compose exec ponder printenv PONDER_RPC_URL_84532 PONDER_START_BLOCK_84532 PONDER_RPC_URL_11155111 PONDER_START_BLOCK_11155111
docker inspect kargain-ponder-1 --format '{{json .HostConfig.LogConfig}}'
docker compose logs -f ponder
```

Wait until logs show:

- `Completed backfill indexing` (or `Detected crash recovery` then a short catch-up)
- `Started live indexing`
- No repeated `403` / `MigrationError`
- log config reports the `local` driver (or the host default you intentionally configured)

**Do not** change `PONDER_START_BLOCK_84532` to `latest` after sync (see above).

### 6. Smoke checks

```bash
curl -si https://ponder.kargain.com/ready | head -5    # expect HTTP/2 200 when caught up (503 during backfill)
curl -si https://ponder.kargain.com/status | head -20
curl -s https://ponder.kargain.com/passports | jq '.total'
curl -s https://ponder.kargain.com/consignments | jq '.total'   # 0 until first Nuclear #4 consignment opens
curl -s https://ponder.kargain.com/commerce-payment-tokens | jq '.total'   # expect 4 after Nuclear #4 reindex (USDC × 2 modes × 2 chains)
curl -s https://ponder.kargain.com/accounts/0x0000000000000000000000000000000000000001/obligations | jq 'keys'
curl -s https://ponder.kargain.com/notifications/0x0000000000000000000000000000000000000001 | jq '.total // .items | length'
curl -s https://ponder.kargain.com/challenges | jq '.total'
curl -s https://ponder.kargain.com/passports/<tokenId> | jq '.status, .disputeDeposit'
curl -s 'https://ponder.kargain.com/agents/0x0000000000000000000000000000000000000001/mandates?active=false' | jq '.total, .page, .limit'
```

**Browse Phase 1 filter divergence (B1) — run after a schema/index reindex to prove filters are live:**

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

**EXPLAIN ANALYZE (optional, VPS Postgres only):** confirm planner uses `lower(make)` / `lower(fuel_type)` expression indexes on filtered browse. Not available from the public HTTP API — run on the indexer DB host after reindex. With one live lot the plan is not diagnostic; revisit when `consignment` volume grows (see MIGRATION-V2). Does **not** block Phase 2 HTTP cache headers.

Replace `<tokenId>` with a known minted passport. `/health` is Ponder’s reserved liveness route (empty body is normal); use `/ready` and `/status` for sync state. Custom app routes are listed in [indexer/README.md](./README.md#http-api).

### 6.0 App ↔ indexer shipping (normative, keep light)

Monorepo reality: **one `git push` to `master` deploys the Next app on Vercel automatically.** The Ponder indexer is a **separate** VPS process (this runbook). There is **no** separate “app deploy” step after reindex.

**Default practice (do this; do not invent heavier orchestration):**

1. Push schema/index/handler changes to `master` as usual (Vercel ships the app).
2. On the VPS, pull and run this reindex runbook **as soon as practical**.
3. Smoke `/ready` + `/status` (tip) + **B1** above. Until B1 passes, treat marketplace filters as not proven — during the window the UI may send browse params the old indexer ignores (**fail-open**: wider unfiltered results, not corrupt money/custody).
4. Do **not** build staging-branch / Ignore-Build / two-commit / “indexer-before-push” rituals unless a change fails closed on money, custody, or auth, or the ignore-window becomes hours of user-visible lies.

### 6.1 Browse Phase 1 cutover proof (August 14, 2026)

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

### 6.2 Cloudflare Cache Rules (Phase 2 — maintainer; not agent-run)

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

After schema change, drop local DB or run `ponder-reindex.sql` against your local Postgres, then restart from block `0`.

Local agent auction lifecycle (chain + Ponder phase polls) is covered by `./scripts/e2e-local.sh`.

---

## Troubleshooting

| Symptom | Action |
|---------|--------|
| `403` / "Archive requests require a personal token" on Base `eth_getLogs` | Set `PONDER_RPC_URL_84532=https://sepolia.base.org` (or PublicNode with token); `docker compose up -d --force-recreate ponder` |
| `403` on Ethereum Sepolia PublicNode | Set `PONDER_RPC_URL_11155111` to Alchemy/Infura/QuickNode Sepolia (not PublicNode without token) |
| `404` HTML from `rpc.sepolia.org` | Endpoint is dead — use a real Sepolia JSON-RPC URL |
| `Unable to find available JSON-RPC provider` / `rate_limit` on `ethereumSepolia` | Lower `PONDER_MAX_RPS_11155111` (default 5) below provider capacity, or upgrade RPC plan |
| `Cannot read properties of undefined (reading 'id')` in handlers | Ensure image has `context.chain.id` indexing (not `event.chain`) — pull + rebuild |
| `MigrationError` / "different Ponder app" | Run `ponder-reindex.sql`, then backfill again. **If data already synced:** do not switch start block to `latest` — revert to the numeric block used at backfill |
| `MigrationError` immediately after `git pull` + new image | Expected when `ponder.schema.ts` changed — run step 3 (SQL) before starting new container |
| Ponder exits on start (“build_id”) | Run full `ponder-reindex.sql`, not table truncate only |
| Slow / stalled sync on `sepolia.base.org` | Retry; optional Alchemy/QuickNode for backfill only |
| Empty `fuelType` on old rows | Expected until metadata URIs are re-fetched during replay; ensure Arweave reachable from VPS |
| API shows v1 `passport id 0` after v2 deploy | Rebuild ponder image + `ponder-reindex.sh`; confirm `pnpm ponder:config` → v2 karPassport |
| API 404 for passport | Token minted on deprecated pre-v1.1 contract — not in current index |
| Env change ignored | Use `docker compose up -d --force-recreate ponder` (not `restart` alone) after editing `.env` |

---

## Related files

| File | Purpose |
|------|---------|
| `scripts/ponder-reindex.sh` | Stop ponder + run SQL on Docker Postgres |
| `scripts/ponder-reindex.sql` | DROP SCHEMA kargain + ponder_sync |
| `scripts/ponder-config.ts` | Read-only stack diagnostic (`pnpm ponder:config`) |
| `scripts/lib/resolve-sepolia-stack.ts` | `resolveCommercialStack`: env → manifest → `COMMERCIAL_ACTIVE` |
| `Dockerfile.ponder` | Copy `patches/` before `pnpm install` (Docker build on VPS) |
| `scripts/lib/ponder-env.ts` | Dual-chain RPC + contract start blocks + per-chain RPS |
| `scripts/lib/ponder-max-rps.ts` | `PONDER_MAX_RPS_<chainId>` parser + defaults |
| `scripts/verify.ts` | Basescan verify active Sepolia stack |
| `scripts/deploy.ts` | Nuclear commercial deploy (84532 / 11155111) |
| `lib/web3/commercial-active.ts` | **Committed** per-chain stacks (VPS / CI fallback) |
| `deployments/<chainId>.json` | Local deploy artifact — not in git; optional override when present |
| [contracts/SPEC.md Part I.9.1](../contracts/SPEC.md#i91-active-deployment-base-sepolia-84532) | **Active** Base Sepolia addresses |
| [contracts/SPEC.md Part I.9.2](../contracts/SPEC.md#i92-active-deployment-ethereum-sepolia-11155111) | **Active** Ethereum Sepolia addresses |
| [contracts/SPEC.md Part II.4](../contracts/SPEC.md#ii4-historical-deployment-base-sepolia-84532) | **Historical** v1.x Sepolia addresses |
| [MIGRATION-V2.md](./MIGRATION-V2.md) | v2 handler reference + FX extension |
| [ops/deploys/nuclear-4.md](../ops/deploys/nuclear-4.md) | Current Nuclear #4 deploy / reindex |
| [ops/deploys/archive/84532-v2.md](../ops/deploys/archive/84532-v2.md) | Historical June 2026 generation v2 |
