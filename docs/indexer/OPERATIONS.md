# Ponder indexer operations (VPS reindex runbook)

Use this after **any** change to `ponder.schema.ts` or to indexed handlers that alter stored row shape (e.g. G1 trust fields; filter facets; cover photos; delegation notifications; **July 2026 C3 dual-chain:** `chainId` / `custodyChain` columns + chain-scoped verifier keys).

Without reindex, new columns stay empty on historical passports and trust UX (G2 banner, buy-risk context), browse filter facets, **listing card cover photos**, **notifications feed**, or **dual-chain custody / verifier identity** will be wrong until new on-chain events occur.

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

**Handlers:** dual-chain event indexing in `src/index.ts` — deploy + **reindex required** when schema changes.

---

## Production RPC and start block (VPS — dual-chain)

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

Replace `<tokenId>` with a known minted passport. `/health` is Ponder’s reserved liveness route (empty body is normal); use `/ready` and `/status` for sync state. Custom app routes are listed in [indexer/README.md](./README.md#http-api).

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
