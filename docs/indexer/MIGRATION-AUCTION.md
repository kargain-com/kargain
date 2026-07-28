# Ponder AuctionEscrow indexing guide

**Status (July 2026):** handlers + schema + HTTP API **shipped** in iterations (b) and **(b2)** (agent authorizations). Contract deployed on Base Sepolia — see [ops/deploys/84532-auction.md](../ops/deploys/84532-auction.md).

**Production VPS (July 14, 2026):** iteration (b) reindex **done**. Iteration **(b2)** adds `auction_agent_authorization` — **full VPS reindex required** after deploy (see [OPERATIONS.md](./OPERATIONS.md)). Live smoke on [ponder.kargain.com](https://ponder.kargain.com): `/ready` 200, `/status` synced on 84532; `GET /auctions` → `total: 0` until first `AuctionCreated`.

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
| `auction_agent_authorization` | `tokenId` | One agent authorization per passport (`authorizeAuctionAgent`); `active` mirrors on-chain mapping |

### `auction.phase` values

| Phase | Typical trigger |
|-------|-----------------|
| `CREATED` | `AuctionCreated` (reserve not yet met) |
| `BIDDING` | `AuctionStarted` / `BidPlaced` |
| `SETTLED` | `AuctionSettled` |
| `RELEASED` | `FundsReleased` |
| `CANCELLED` | `AuctionCancelled` |
| `RETURNED` | `ForceReturn` (overrides cancel on owner force-return) |

`auction.ownerMinAsset` is not emitted on `AuctionCreated` — stays `0` on create. Authorization terms (`ownerMinAsset`, `asset`, `expiry`) are read from **`auction_agent_authorization`** (iteration b2). Do not backfill `auction.ownerMinAsset` from the auth table.

---

## Indexed events

| Event | Tables |
|-------|--------|
| `AuctionCreated` | `auction` upsert |
| `AuctionStarted` | `auction` (phase, high bid, ends) |
| `BidPlaced` | `auction` + `auction_bid` insert |
| `BidRefunded` | `auction_bid.refunded` |
| `AuctionCancelled` | `auction` + deactivate `auction_agent_authorization` |
| `ReturnRequested` | `auction.returnRequestedAt` |
| `ForceReturn` | `auction` + deactivate `auction_agent_authorization` |
| `AuctionSettled` | `auction` + `auction_settlement` (auth **stays** active until payout/return) |
| `ReceiptConfirmed` | `auction_settlement` |
| `FundsReleased` | `auction` + `auction_settlement` + deactivate `auction_agent_authorization` |
| `SettlementDisputeOpened` / `Resolved` | `auction_settlement` |
| `PassportReturnedAndRefunded` | `auction_settlement.clearedAt` + deactivate `auction_agent_authorization` |
| `AbandonedRefundClaimed` | `auction_settlement.clearedAt` |
| `AuctionAgentAuthorized` | `auction_agent_authorization` upsert (`active=true`) |
| `AuctionAgentRevoked` | `auction_agent_authorization.active=false` |

### Silent auth clear (`_clearAuctionStorage`)

On-chain `_clearAuctionStorage` deletes `auctionAgentAuthorizations[tokenId]` **without** emitting `AuctionAgentRevoked`. The indexer mirrors that by setting `auction_agent_authorization.active = false` on terminal events that call it: `AuctionCancelled`, `ForceReturn`, `FundsReleased`, `PassportReturnedAndRefunded`. Updates are no-ops when no auth row exists. `AuctionSettled` does **not** clear storage — auth remains until `_payout` / `returnPassportAndRefund`. (`voidAuction` / `VOIDED` removed in AuctionEscrow `2.0.0-draft` infallible-settle; schema drop of `voidReason` requires full reindex — covered by Nuclear #2.)

**Not indexed:** admin config events (`MinDurationSet`, `Paused`, …).

---

## HTTP API

See [indexer/README.md](./README.md#http-api) for route list. Bigints serialize as strings in JSON.

Agent awaiting list: `GET /agents/:address/auction-authorizations` (optional `?awaiting=true` excludes tokenIds with an active auction).

---

## Deploy + reindex

Schema or handler changes require full reindex per [OPERATIONS.md](./OPERATIONS.md):

1. `git pull` (committed `SEPOLIA_ACTIVE.auctionEscrow`)
2. `docker compose build ponder`
3. `docker compose stop ponder` → `./scripts/ponder-reindex.sh`
4. `docker compose up -d --force-recreate ponder`
5. Keep `PONDER_START_BLOCK_84532=43399242`

Auction backfill replays from block **44080895** only; v2 contracts replay from **43399242**.

**Iteration (b) VPS cutover:** completed July 14, 2026 (empty `/auctions` is healthy — no lots created yet).

**Iteration (b2):** new `auction_agent_authorization` table — **full VPS reindex required** after pull + rebuild (maintainer runbook).

---

## Local E2E (shipped — iteration в)

Hardhat `31337` + PGlite Ponder indexes the **local** `auctionEscrow` proxy via:

- `pnpm deploy:local` writes `auctionEscrow` + `auctionEscrowImpl` into `deployments/31337.json`
- `ponder.config.ts` passes `localAddresses?.auctionEscrow` to `contractEntry` (same pattern as Marketplace)
- `./scripts/e2e-local.sh` with `KARGAIN_E2E_STRICT=1` runs the agent auction lifecycle and polls `GET /auctions/:tokenId` + `/bids` through phases `BIDDING` → `SETTLED` → `RELEASED`

**Scenario:** owner `authorizeAuctionAgent` → agent `createAuctionOnBehalf` → bid ≥ reserve → time/`settle` → `confirmReceipt` (or auto-release) → Ponder phases `BIDDING` → `SETTLED` → `RELEASED`.
