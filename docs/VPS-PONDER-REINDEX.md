# VPS Ponder reindex runbook

Use this after **any** change to `ponder.schema.ts` or to indexed handlers that alter stored row shape (e.g. G1 trust fields: `lastMetadataChangeAt`, `verificationResetCount`, `hadDispute`, `lastDisputeResolvedAt`; **June 2026 filter facets:** `condition`, `vehicleType`, `colour`, `locationLabel` on `passport`).

Without reindex, new columns stay empty on historical passports and trust UX (G2 banner, buy-risk context) or browse filter facets will be wrong until new on-chain events occur.

---

## When to reindex

| Trigger | Example |
|---------|---------|
| Schema migration | New columns on `passport`, new tables |
| Filter facet columns | `condition`, `vehicleType`, `colour`, `locationLabel` (June 2026 UI session) |
| Contract redeploy | KarPassport / Marketplace address change (Phase 5) |
| Handler shape change | New denormalized fields written on mint / URI update / dispute |
| Stuck / corrupt sync | Ponder refuses to start after config change |

**Do not reindex** for frontend-only or contract-only changes that do not touch Ponder schema or indexing logic.

Examples that **do not** require reindex:

- Phase 5 polish UI (PR5a–d): typed record labels, attestation form, browse chain-status sample (`getPassportStatus` via wagmi on the client)
- Irys upload hardening (June 2026): client-side only — no Ponder schema change
- Basescan verify (`pnpm verify:v1.1`) — ops-only, no indexer impact
- Shell / nav / filter **UI** refactors that do not change Ponder schema or handler output shape

---

## Prerequisites

- SSH access to the VPS with the repo and `docker-compose.yml`
- `deployments/84532.json` on the server (or known v1.1 addresses + `indexFromBlock`)
- A reliable RPC for backfill (Alchemy / QuickNode recommended; public RPC may rate-limit `eth_getLogs`)

---

## Steps (production VPS)

Run from the repository root on the server.

### 1. Deploy new code

```bash
git pull origin master
pnpm install   # if dependencies changed
# Rebuild / restart ponder image if your deploy workflow requires it
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

### 4. Refresh environment

```bash
node --import tsx scripts/lib/print-ponder-env.ts
```

Paste the output into the server `.env`:

- `PONDER_KAR_PASSPORT_ADDRESS`, `PONDER_MARKETPLACE_ESCROW_ADDRESS`, …
- `PONDER_START_BLOCK_84532=<indexFromBlock>` from `deployments/84532.json` for **backfill**

For G1 schema-only updates (same contract addresses), keep existing addresses; still set start block to manifest `indexFromBlock` for a full replay.

### 5. Use a fast RPC during backfill (recommended)

In `.env` on VPS:

```bash
PONDER_RPC_URL_84532=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY
```

Revert to public RPC after sync if desired.

### 6. Start Ponder

```bash
docker compose up -d ponder
docker compose logs -f ponder
```

Wait until logs show sync caught up to chain head (no repeated errors).

### 7. Switch to realtime mode

After backfill completes, set in `.env`:

```bash
PONDER_START_BLOCK_84532=latest
```

Restart Ponder:

```bash
docker compose restart ponder
```

### 8. Smoke checks

```bash
curl -s https://ponder.kargain.com/passports/0 | jq '.hadDispute, .lastMetadataChangeAt, .verificationResetCount'
curl -s https://ponder.kargain.com/listings | jq '.total'
curl -s https://ponder.kargain.com/listings/facets | jq '.fuelTypes, .statusCounts, .conditions, .vehicleTypes'
```

Replace token `0` with a known minted passport if needed. On the marketplace UI, cards may show an **On-chain** badge when sampled RPC status differs from Ponder (G4) — that is client-side and does not require reindex.

After reindex, run the browse filter smoke items in [README.md](../README.md) (top bar + drawer: status, make, condition, vehicle type, location, colour).

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
| Ponder exits on start (“build_id”) | Run full `ponder-reindex.sql`, not table truncate only |
| Slow / stalled sync | Switch to Alchemy/QuickNode RPC |
| Empty `fuelType` on old rows | Expected until metadata URIs are re-fetched during replay; ensure Arweave reachable from VPS |
| API 404 for passport | Token minted on deprecated pre-v1.1 contract — not in current index |

---

## Related files

| File | Purpose |
|------|---------|
| `scripts/ponder-reindex.sh` | Stop ponder + run SQL on Docker Postgres |
| `scripts/ponder-reindex.sql` | DROP SCHEMA kargain + ponder_sync |
| `scripts/lib/print-ponder-env.ts` | Emit `PONDER_*` env from manifest |
| `scripts/verify-v1.1.ts` | Basescan verify KarPassport + Marketplace (ops, not VPS) |
| `deployments/84532.json` | v1.1 addresses + `indexFromBlock` (gitignored on VPS) |
| `docs/passport-v1.1-spec.md` §14–§17 | Deploy, verify, polish, UI complete reference |
