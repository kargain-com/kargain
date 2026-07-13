# Ponder AuctionEscrow indexing guide

**Status (July 2026):** handlers + schema + HTTP API **shipped** in iteration (b). Contract deployed on Base Sepolia — see [ops/deploys/84532-auction.md](../ops/deploys/84532-auction.md).

**Related:** [indexer/README.md](./README.md) (HTTP API table) · [OPERATIONS.md](./OPERATIONS.md) (reindex runbook) · [contracts/interfaces/IAuctionEscrow.sol](../../contracts/interfaces/IAuctionEscrow.sol)

---

## Start block (per-contract)

AuctionEscrow uses a **separate** Ponder `startBlock` from the generation v2 stack:

| Contract | Start block | Source |
|----------|-------------|--------|
| KarPassport, Marketplace, … | **43399242** | `PONDER_START_BLOCK_84532` / `SEPOLIA_ACTIVE.indexFromBlock` |
| AuctionEscrow proxy | **44080895** | `SEPOLIA_ACTIVE.blocks.auctionEscrow` via `contractEntry(..., "auctionEscrow")` |

Do **not** change global `PONDER_START_BLOCK_84532` when adding auction indexing. [`scripts/lib/ponder-env.ts`](../../scripts/lib/ponder-env.ts) `resolveSepoliaContractStartBlock` returns `blocks.auctionEscrow` for the auction contract only.

Diagnostic: `pnpm ponder:config` — shows `auctionEscrow` address and `blocks.auctionEscrow`.

---

## Schema tables

| Table | Primary key | Purpose |
|-------|-------------|---------|
| `auction` | `tokenId` | Current auction state per passport (one on-chain slot) |
| `auction_bid` | `{txHash}-{logIndex}` | Append-only bid log (`AuctionStarted` updates auction only; bids inserted on `BidPlaced`) |
| `auction_settlement` | `tokenId` | Post-`AuctionSettled` hold, dispute, and release |

### `auction.phase` values

| Phase | Typical trigger |
|-------|-----------------|
| `CREATED` | `AuctionCreated` (reserve not yet met) |
| `BIDDING` | `AuctionStarted` / `BidPlaced` |
| `SETTLED` | `AuctionSettled` |
| `RELEASED` | `FundsReleased` |
| `VOIDED` | `AuctionVoided` |
| `CANCELLED` | `AuctionCancelled` |
| `RETURNED` | `ForceReturn` (overrides cancel on owner force-return) |

`ownerMinAsset` is not emitted on `AuctionCreated` — indexed as `0` until agent-authorization indexing is added (out of scope for b).

---

## Indexed events

| Event | Tables |
|-------|--------|
| `AuctionCreated` | `auction` upsert |
| `AuctionStarted` | `auction` (phase, high bid, ends) |
| `BidPlaced` | `auction` + `auction_bid` insert |
| `BidRefunded` | `auction_bid.refunded` |
| `AuctionCancelled` | `auction` |
| `ReturnRequested` | `auction.returnRequestedAt` |
| `ForceReturn` | `auction` |
| `AuctionSettled` | `auction` + `auction_settlement` |
| `AuctionVoided` | `auction` |
| `ReceiptConfirmed` | `auction_settlement` |
| `FundsReleased` | `auction` + `auction_settlement` |
| `SettlementDisputeOpened` / `Resolved` | `auction_settlement` |
| `PassportReturnedAndRefunded` / `AbandonedRefundClaimed` | `auction_settlement.clearedAt` |

**Not indexed (b):** `AuctionAgentAuthorized`, `AuctionAgentRevoked`, admin config events (`MinDurationSet`, `Paused`, …).

---

## HTTP API

See [indexer/README.md](./README.md#http-api) for route list. Bigints serialize as strings in JSON.

---

## Deploy + reindex

Schema or handler changes require full reindex per [OPERATIONS.md](./OPERATIONS.md):

1. `git pull` (committed `SEPOLIA_ACTIVE.auctionEscrow`)
2. `docker compose build ponder`
3. `docker compose stop ponder` → `./scripts/ponder-reindex.sh`
4. `docker compose up -d --force-recreate ponder`
5. Keep `PONDER_START_BLOCK_84532=43399242`

Auction backfill replays from block **44080895** only; v2 contracts replay from **43399242**.
