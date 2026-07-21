# Ponder indexer documentation

| Document | Lifecycle | You need it when… |
|----------|-----------|-------------------|
| [OPERATIONS.md](./OPERATIONS.md) | **Permanent** | Running a reindex on VPS, RPC/start-block issues, Postgres reset |
| [MIGRATION-V2.md](./MIGRATION-V2.md) | **Reference** | v2 event/schema mapping, FX display extension (§6) |
| [MIGRATION-AUCTION.md](./MIGRATION-AUCTION.md) | **Reference** | AuctionEscrow events, per-contract start block **44080895**, auction + agent-auth tables |
| [ops/deploys/84532-v2.md](../ops/deploys/84532-v2.md) | **Per deploy** | June 2026 v2 deploy + VPS cutover record |

**Production (July 2026 Nuclear):** [ponder.kargain.com](https://ponder.kargain.com) indexes full commercial stacks on **84532** (hub `indexFromBlock` **44434865**) and **11155111** (Eth `indexFromBlock` **11319840`). **C3 dual-chain** adds `chainId` / `custodyChain` and chain-scoped verifier keys — **full reindex required** after deploy ([OPERATIONS.md](./OPERATIONS.md)).

## Contract addresses for indexer

Do **not** copy address tables here. Resolution is **per-chain** (SPEC §I.12.12):

- Hub 84532: `deployments/84532.json` → `lib/web3/sepolia-addresses.ts` (`SEPOLIA_ACTIVE`); optional `PONDER_*_ADDRESS` env overrides
- Eth 11155111: `deployments/11155111.json` only (no committed fallback)
- Diagnostic: `pnpm ponder:config`
- Reference: [contracts/SPEC.md Part I.9.1](../contracts/SPEC.md#i91-active-deployment-base-sepolia-84532) + Eth nuclear table

**Start blocks:** `PONDER_START_BLOCK_84532=44434865` · `PONDER_START_BLOCK_11155111=11319840`. Per-contract start blocks from each manifest’s `blocks.*`.

## Dual-chain identity (C3 · July 2026)

| Field | Meaning |
|-------|---------|
| `passport.chainId` | Immutable origin (`tokenId >> 128`) |
| `passport.custodyChain` | Network where the usable instance lives |
| listing / sale / auction / record / uri-history `chainId` | Network of the emitting event |
| `verifier.id` | `` `${chainId}-${address.toLowerCase()}` `` |

Browse: `GET /listings?custodyChain=84532` (optional). Passport detail returns `records[]` / `uriHistory[]` with per-row `chainId` (UNION by global `tokenId`). Verifier detail: prefer `GET /verifiers/:address?chainId=84532`.

## Auction API (July 2026)

AuctionEscrow on each commercial chain from that chain’s manifest. Response rows include `chainId` (+ passport `custodyChain` when enriched).

| Route | Purpose |
|-------|---------|
| `GET /auctions` | Browse auctions (`page`, `limit`; optional `?active=true\|false`, `?seller=`, `?agent=`) |
| `GET /auctions/:tokenId` | Auction detail + passport enrichment + `settlement` when present |
| `GET /auctions/:tokenId/bids` | Bid history (`page`, `limit`; newest first) |
| `GET /profile/:address/auctions` | Auctions where `seller` matches address |
| `GET /agents/:address/auction-authorizations` | Active auction agent authorizations; passport enrichment; `hasActiveAuction` per row; optional `?awaiting=true\|false` (excludes / requires active auction) |
| `GET /owners/:address/auction-authorizations` | Active auction authorizations granted by owner; same enrichment + `?awaiting=` as the agent route |

## Verifier lifecycle (bounded indexing)

Ponder observes a **bounded event window** (start block, reindex checkpoints). KarProPass / KarProStaking handlers use [`src/lib/ponder-verifier-lifecycle.ts`](../../src/lib/ponder-verifier-lifecycle.ts): **creation** events (`ProPassMinted`, `VerifierJoined`) upsert `verifier` rows keyed by `` `${chainId}-${address}` ``; **mutation** and **deactivation** events patch only when a row exists — no row means the desired inactive/absent state already holds (idempotent no-op, not an error).

## Listing API fields (v2 + C3)

Ponder stores `chainId`, `currencyCode`, `agent`, `agentFeeBps`, `returnRequestedAt`, and `externalPaymentConfirmedAt` on listings. Browse/detail also expose passport `custodyChain` / `originChainId`. HTTP API also returns legacy `fiatCurrency` integer (0–10 display enum via [`legacyFiatFromCurrencyCode`](../../lib/marketplace/currency-code.ts); **84532 listings are USD → `0`**) for browse/buy UI compat.

**Buyer UI:** `agent` on `GET /listings` drives consignment attribution on browse cards and listing detail ([`design-spec.md`](../design-spec.md) §4.16). `agentFeeBps` and `ownerMinPrice1e8` are indexed for agent/owner flows only — not exposed to buyers.

### `GET /listings` — FX + custody query parameters

Optional query params for cross-currency **price filter and sort** (stateless API layer — **redeploy only**, no schema reindex; see [OPERATIONS.md](./OPERATIONS.md) “Do not reindex”).

| Param | Purpose |
|-------|---------|
| `custodyChain` | Filter browse to passports whose usable instance is on this chain id (C3) |
| `priceCurrency` | Display currency for `priceMin` / `priceMax` bounds (USD, EUR, ETH, BTC, CNY, INR, BRL, IDR, AUD, AED, KRW, RUB, JPY) |
| `eurUsdRate`, `ethUsdRate`, `btcUsdRate` | Chainlink/CoinGecko rates (1e8 string, USD per 1 unit; `btcUsd` from CoinGecko `exchange_rates.usd`) |
| `cnyUsdRate`, `inrUsdRate`, `brlUsdRate`, `idrUsdRate`, `audUsdRate`, `aedUsdRate`, `krwUsdRate`, `rubUsdRate`, `jpyUsdRate` | CoinGecko `exchange_rates` derived rates (June 2026 display layer) |

Rates are parsed via [`parseFxRatesFromQuery`](../../lib/marketplace/price-normalize.ts) / [`fx-rate-registry.ts`](../../lib/marketplace/fx-rate-registry.ts) in [`filterAndSortListings`](../../src/api/index.ts). Backward-compatible: old frontends sending only `eurUsdRate` / `ethUsdRate` still work. CoinGecko fiat/crypto browse filters need **indexer + frontend** deployed together; **USD** price filter does not.

### Agent consignment routes — ✅ shipped June–July 2026

Read-only agent-scoped queries in
[`src/api/index.ts`](../../src/api/index.ts). The July 2026 authorization
lifecycle timestamps and persisted marketplace owner require a **full reindex**
before delegation notifications are live; see
[OPERATIONS.md](./OPERATIONS.md).

| Route | Purpose |
|-------|---------|
| `GET /agents/:address/authorizations` | Active authorizations for agent; `{ authorizations, total, page, limit }`; each row includes `hasActiveListing`; optional `?hasActiveListing=true\|false` filters before pagination (`total` reflects filter) |
| `GET /agents/:address/auction-authorizations` | Active auction agent authorizations; passport enrichment; `hasActiveAuction` per row; optional `?awaiting=true\|false` (excludes / requires `auction.active`); pagination same envelope |
| `GET /agents/:address/listings` | Listings where `agent` matches; same pagination envelope; optional `?active=true\|false`; enrichment matches `GET /profile/:address/listings` |
| `GET /owners/:address/authorizations` | Active authorizations **granted by** owner; same envelope + `hasActiveListing` filters; rows include `owner` + `agent`; listing join uses `seller === owner` (**redeploy only** — `ownerIdx`) |
| `GET /owners/:address/auction-authorizations` | Active auction authorizations granted by owner; same shape as agent auction-authorizations (`?awaiting=`, passport enrich) |

`:address` validated with `isAddress`; queries use checksum `getAddress()` to match chain-indexed rows.

**Owner authorization UI** still reads `agentAuthorizations(tokenId)` on-chain
for per-passport writes — owner list routes feed the delegated portfolio (read).
Ponder mirrors replacement grants, revokes, and terminal storage clears for
agent- and owner-facing queries and notifications.

Passport rows include trust fields (`hadDispute`, `disputeOpenedAt`, …) and nullable `disputeDeposit` (set on `DisputeDepositPaid`, cleared on resolve/withdraw).

## HTTP API

Custom routes live in [`src/api/index.ts`](../../src/api/index.ts). Bigints are serialized as strings in JSON.

| Endpoint | Purpose |
|----------|---------|
| `GET /listings` | Browse and filter (optional FX query params for cross-currency filter/sort) |
| `GET /auctions` | Browse auctions (optional `active`, `seller`, `agent` filters) |
| `GET /auctions/:tokenId` | Auction detail + settlement |
| `GET /auctions/:tokenId/bids` | Bid history |
| `GET /listings/stats` | Aggregate listing stats |
| `GET /listings/facets` | Filter facets (make, status, condition, …) |
| `GET /listings/:tokenId` | Listing detail |
| `GET /listings/batch` | Batch listing lookup |
| `GET /passports/:tokenId` | Passport detail |
| `GET /passports/batch` | Batch passport lookup |
| `GET /profile/:address/passports` | Passports owned by address |
| `GET /profile/:address/listings` | Listings by seller |
| `GET /profile/:address/auctions` | Auctions by seller |
| `GET /agents/:address/authorizations` | Active consignment authorizations for agent (`page`, `limit`; `hasActiveListing` per row; optional `?hasActiveListing=true\|false`) |
| `GET /agents/:address/auction-authorizations` | Active auction agent authorizations (`page`, `limit`; passport enrichment; `hasActiveAuction`; optional `?awaiting=true\|false`) |
| `GET /agents/:address/listings` | Listings where agent matches (`page`, `limit`; optional `?active=true\|false`) |
| `GET /owners/:address/authorizations` | Active authorizations granted by owner (`page`, `limit`; `hasActiveListing`; optional filter) |
| `GET /owners/:address/auction-authorizations` | Active auction authorizations granted by owner (`page`, `limit`; `?awaiting=`; passport enrichment) |
| `GET /notifications/:address` | Notification feed, including active marketplace delegation and reserve-auction authorization grants |
| `GET /verifiers` | Verifier directory (`verificationFee` wei string on each row) |
| `GET /verifiers/:address` | Verifier profile (`verificationFee` wei string) |
| `GET /verifiers/by-slug/:slug` | Resolve slug → address |
| `GET /verifiers/:address/attestations` | Verifier attestations |

### Ponder reserved routes

Do **not** define these in `src/api/index.ts` — Ponder owns them ([docs](https://ponder.sh/docs/api-reference/ponder/api-endpoints)):

| Route | Purpose |
|-------|---------|
| `GET /health` | Liveness — HTTP 200 when the process is up (may have empty body) |
| `GET /ready` | Readiness — HTTP 503 during backfill, 200 when caught up |
| `GET /status` | Indexing sync status |

Smoke checks after reindex: [OPERATIONS.md §6](./OPERATIONS.md#6-smoke-checks).

## Local dev database (PGlite — no Docker)

Production and the VPS use **Postgres** (`DATABASE_URL` from docker-compose). Local dev and the E2E harness use **embedded PGlite** — no Docker required. [`scripts/lib/ponder-env.ts`](../../scripts/lib/ponder-env.ts) `resolvePonderDatabase()` chooses:

- **Postgres** when `DATABASE_URL` / `PONDER_DATABASE_URL` / `DATABASE_PRIVATE_URL` is set (production, always).
- **PGlite** (`.ponder/pglite`, override with `PONDER_PGLITE_DIR`) when `PONDER_ENABLE_LOCAL=1` and no connection string.

`./scripts/e2e-local.sh` leaves `DATABASE_URL` unset (PGlite) and sets `PONDER_LOCAL_ONLY=1` so Ponder indexes only the Hardhat chain and `/ready` does not wait on the public Base Sepolia RPC. These are **local-dev-only env guards** — production config is unchanged (Postgres, Base Sepolia).
