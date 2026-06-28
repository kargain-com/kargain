# Ponder indexer operations (VPS reindex runbook)

Use this after **any** change to `ponder.schema.ts` or to indexed handlers that alter stored row shape (e.g. G1 trust fields: `lastMetadataChangeAt`, `verificationResetCount`, `hadDispute`, `lastDisputeResolvedAt`, `disputeOpenedAt`; **June 2026 filter facets:** `condition`, `vehicleType`, `colour`, `locationLabel` on `passport`; **June 2026 listing cards:** `coverPhotoUri` on `passport` — first metadata photo indexed at URI replay).

Without reindex, new columns stay empty on historical passports and trust UX (G2 banner, buy-risk context), browse filter facets, **listing card cover photos**, or **notifications feed** (`disputeOpenedAt` for dispute-open events) will be wrong until new on-chain events occur.

---

## Production state (validated June 2026)

Generation v2 **env cutover complete** on VPS:

| Item | Value |
|------|--------|
| Contract set | `SEPOLIA_ACTIVE` in git — KarPassport `0x2C46B2310E2cb09b0FEeDd174D9CD3870137F594` |
| Start block | `PONDER_START_BLOCK_84532=43399242` |
| RPC | `https://sepolia.base.org` |
| Address resolution | `git pull` → committed fallbacks; optional `pnpm ponder:config` |
| Docker | `docker compose build ponder` after code pull (see Dockerfile.ponder `COPY patches`) |

Legacy v1 rows (e.g. `passport id 0`) require **full reindex** after pointing at v2 addresses — not env paste alone. Cutover record: [ops/deploys/84532-v2.md](../ops/deploys/84532-v2.md).

**Handlers:** v2 event indexing in `src/index.ts` — deploy + **reindex required** when schema changes.

---

## Production RPC and start block (VPS — June 2026)

Validated on Base Sepolia production VPS.

### RPC — use `sepolia.base.org`

| RPC | Ponder backfill / catch-up | Live indexing |
|-----|----------------------------|---------------|
| **`https://sepolia.base.org`** | ✅ Recommended (official Base Sepolia public endpoint) | ✅ |
| **`https://base-sepolia.publicnode.com`** (no token) | ❌ **403** on archive `eth_getLogs` | ⚠️ Fails on restart if Ponder must catch up historical blocks |

PublicNode requires a [personal token](https://www.allnodes.com/publicnode) for archive log queries. That affects **full backfill** and **crash-recovery catch-up** (even a 0.1% gap at 99.9% sync).

**Recommended VPS `.env` (steady state):**

```bash
PONDER_RPC_URL_84532=https://sepolia.base.org
PONDER_START_BLOCK_84532=<indexFromBlock or checkpoint block used at backfill>
```

Optional alternatives: PublicNode **with** token, Alchemy, QuickNode.

### Start block — keep the numeric value after sync

**Do not** switch `PONDER_START_BLOCK_84532` to `latest` after backfill on Ponder **0.16**.

Ponder embeds contract `startBlock` in the app `build_id`. Changing `42990588` → `latest` changes `build_id` and triggers:

```
MigrationError: Schema "kargain" was previously used by a different Ponder app.
```

After backfill reaches chain head, **leave the same numeric start block**. Ponder uses crash recovery and continues **live indexing** (`Started live indexing` in logs).

| When | `PONDER_START_BLOCK_84532` |
|------|----------------------------|
| One-time backfill after `ponder-reindex.sql` | `indexFromBlock` from `deployments/84532.json`, or a **checkpoint** block (e.g. just before a known test mint) |
| Steady production (after sync) | **Same numeric value** — do not set `latest` |
| Fresh deploy after schema wipe | Set back to `indexFromBlock` only when running `ponder-reindex.sql` again |

### Deploy new Ponder code (schema change)

1. `docker compose stop ponder`
2. `ponder-reindex.sql` — **before** starting the new image
3. Backfill with `sepolia.base.org` + numeric start block
4. After 100% sync, keep the same start block and RPC

**Restart without code/image change:** `docker compose stop ponder` → edit `.env` (RPC only) → `docker compose up -d ponder` (no `--build` unless the image changed).

---

## When to reindex

| Trigger | Example |
|---------|---------|
| Schema migration | New columns on `passport`, new tables |
| Filter facet columns | `condition`, `vehicleType`, `colour`, `locationLabel` (June 2026 UI session) |
| Notifications feed | `disputeOpenedAt` on `passport` (June 2026 notifications stack) |
| Contract redeploy | KarPassport / Marketplace address change (Phase 5) |
| Handler shape change | New denormalized fields written on mint / URI update / dispute |
| Stuck / corrupt sync | Ponder refuses to start after config change |
| `MigrationError` after deploy | New `ponder.schema.ts` in Docker image without `ponder-reindex.sql` |

**Do not reindex** for frontend-only or contract-only changes that do not touch Ponder schema or indexing logic.

Examples that **do not** require reindex:

- Phase 5 polish UI (PR5a–d): typed record labels, attestation form, browse chain-status sample (`getPassportStatus` via wagmi on the client)
- Irys upload hardening (June 2026): client-side only — no Ponder schema change
- Basescan verify (`pnpm verify:sepolia`) — ops-only, no indexer impact
- Shell / nav / filter **UI** refactors that do not change Ponder schema or handler output shape
- Notifications / watchlist **frontend** only (no `ponder.schema.ts` change)

---

## Prerequisites

- SSH access to the VPS with the repo and `docker-compose.yml`
- **`git pull`** so Ponder and the app use committed addresses in `lib/web3/sepolia-addresses.ts` (`SEPOLIA_ACTIVE`)
- **`PONDER_RPC_URL_84532=https://sepolia.base.org`** for backfill and production (see above)
- Remove stale `deployments/84532.json` on the VPS if it points at old v1 addresses — `pnpm ponder:config` warns on drift

---

## Steps (production VPS)

Run from the repository root on the server.

### 1. Deploy new code

```bash
git pull origin master
pnpm install   # if dependencies changed
docker compose build ponder   # only when indexer code / schema changed
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

Contract addresses resolve automatically: `PONDER_*_ADDRESS` env (optional override) → `deployments/84532.json` (local deploy only) → **`SEPOLIA_ACTIVE`** in git. After a redeploy, update `lib/web3/sepolia-addresses.ts` in the same PR and **`git pull` on the VPS** — do not paste address exports into `.env`.

**VPS `.env` — infrastructure only (steady state):**

```bash
PONDER_RPC_URL_84532=https://sepolia.base.org
PONDER_START_BLOCK_84532=43399242   # SEPOLIA_ACTIVE.indexFromBlock — or a checkpoint for partial replay
DATABASE_URL=...                    # Postgres for Ponder
```

Optional advanced overrides: `PONDER_KAR_PASSPORT_ADDRESS`, `PONDER_MARKETPLACE_ADDRESS`, … only when debugging or pre-PR deploy smoke on a machine with a fresh manifest.

For G1 schema-only updates (same contract addresses), keep existing infra env; still set start block to `indexFromBlock` for a full replay unless you intentionally use a higher checkpoint.

### 5. Start Ponder and wait for sync

```bash
docker compose up -d --force-recreate ponder

docker compose exec ponder printenv PONDER_RPC_URL_84532 PONDER_START_BLOCK_84532
docker compose logs -f ponder
```

Wait until logs show:

- `Completed backfill indexing` (or `Detected crash recovery` then a short catch-up)
- `Started live indexing`
- No repeated `403` / `MigrationError`

**Do not** change `PONDER_START_BLOCK_84532` to `latest` after sync (see above).

### 6. Smoke checks

```bash
curl -si https://ponder.kargain.com/ready | head -5    # expect HTTP/2 200 when caught up (503 during backfill)
curl -si https://ponder.kargain.com/status | head -20
curl -s https://ponder.kargain.com/listings | jq '.total'
curl -s https://ponder.kargain.com/listings/facets | jq '.statusCounts'
curl -s https://ponder.kargain.com/passports/<tokenId> | jq '.status, .disputeDeposit'
```

Replace `<tokenId>` with a known minted passport. `/health` is Ponder’s reserved liveness route (empty body is normal); use `/ready` and `/status` for sync state. Custom app routes are listed in [indexer/README.md](./README.md#http-api).

---

## Local dev (31337)

```bash
PONDER_ENABLE_LOCAL=1 PONDER_START_BLOCK_31337=0 pnpm ponder:dev
```

After schema change, drop local DB or run `ponder-reindex.sql` against your local Postgres, then restart from block `0`.

---

## Troubleshooting

| Symptom | Action |
|---------|--------|
| `403` / "Archive requests require a personal token" on `eth_getLogs` | Set `PONDER_RPC_URL_84532=https://sepolia.base.org` (or PublicNode with token); `docker compose up -d --force-recreate ponder` |
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
| `scripts/lib/resolve-sepolia-stack.ts` | env → manifest → `SEPOLIA_ACTIVE` resolver |
| `Dockerfile.ponder` | Copy `patches/` before `pnpm install` (Docker build on VPS) |
| `scripts/lib/ponder-env.ts` | Default RPC fallback (`sepolia.base.org`) |
| `scripts/verify.ts` | Basescan verify active Sepolia stack |
| `scripts/deploy.ts` | Base Sepolia deploy (generation v2) |
| `deployments/84532.json` | Manifest (`generation`, `indexFromBlock`) — not in git |
| [contracts/SPEC.md Part I.9.1](../contracts/SPEC.md#i91-active-deployment-base-sepolia-84532) | **Active** Sepolia addresses |
| [contracts/SPEC.md Part II.4](../contracts/SPEC.md#ii4-historical-deployment-base-sepolia-84532) | **Historical** v1.x Sepolia addresses |
| [MIGRATION-V2.md](./MIGRATION-V2.md) | v2 handler reference + FX extension |
| [ops/deploys/84532-v2.md](../ops/deploys/84532-v2.md) | Deploy record (84532 generation v2) |
