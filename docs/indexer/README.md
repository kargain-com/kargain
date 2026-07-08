# Ponder indexer documentation

| Document | Lifecycle | You need it when… |
|----------|-----------|-------------------|
| [OPERATIONS.md](./OPERATIONS.md) | **Permanent** | Running a reindex on VPS, RPC/start-block issues, Postgres reset |
| [MIGRATION-V2.md](./MIGRATION-V2.md) | **Reference** | v2 event/schema mapping, FX display extension (§6) |
| [ops/deploys/84532-v2.md](../ops/deploys/84532-v2.md) | **Per deploy** | June 2026 v2 deploy + VPS cutover record |

**Production (June 2026):** [ponder.kargain.com](https://ponder.kargain.com) indexes generation v2 contracts from block **43399242** with v2 event handlers (including return flow and dispute deposit). **Reindex required** after deploying handler/schema changes.

## Contract addresses for indexer

Do **not** copy address tables here. Resolution order:

- Committed: `lib/web3/sepolia-addresses.ts` (`SEPOLIA_ACTIVE`) — **VPS uses this after `git pull`**
- Local manifest: `deployments/84532.json` (not in git — deploy machine only)
- Diagnostic: `pnpm ponder:config`
- Reference: [contracts/SPEC.md Part I.9.1](../contracts/SPEC.md#i91-active-deployment-base-sepolia-84532)

**Start block:** `PONDER_START_BLOCK_84532=43399242` (`SEPOLIA_ACTIVE.indexFromBlock`).

## Verifier lifecycle (bounded indexing)

Ponder observes a **bounded event window** (start block, reindex checkpoints). KarProPass / KarProStaking handlers use [`src/lib/ponder-verifier-lifecycle.ts`](../../src/lib/ponder-verifier-lifecycle.ts): **creation** events (`ProPassMinted`, `VerifierJoined`) upsert `verifier` rows; **mutation** and **deactivation** events (`ProfileUpdated`, `VerificationFeeUpdated`, `ProPassBurned`, `VerifierLeft`) patch only when a row exists — no row means the desired inactive/absent state already holds (idempotent no-op, not an error).

## Listing API fields (v2)

Ponder stores `currencyCode`, `agent`, `agentFeeBps`, `returnRequestedAt`, and `externalPaymentConfirmedAt` on listings. HTTP API also returns legacy `fiatCurrency` integer (0–10 display enum via [`legacyFiatFromCurrencyCode`](../../lib/marketplace/currency-code.ts); **84532 listings are USD → `0`**) for browse/buy UI compat.

**Buyer UI:** `agent` on `GET /listings` drives consignment attribution on browse cards and listing detail ([`design-spec.md`](../design-spec.md) §4.16). `agentFeeBps` and `ownerMinPrice1e8` are indexed for agent/owner flows only — not exposed to buyers.

### `GET /listings` — FX query parameters

Optional query params for cross-currency **price filter and sort** (stateless API layer — **redeploy only**, no schema reindex; see [OPERATIONS.md](./OPERATIONS.md) “Do not reindex”).

| Param | Purpose |
|-------|---------|
| `priceCurrency` | Display currency for `priceMin` / `priceMax` bounds (USD, EUR, ETH, BTC, CNY, INR, BRL, IDR, AUD, AED, KRW, RUB, JPY) |
| `eurUsdRate`, `ethUsdRate`, `btcUsdRate` | Chainlink/CoinGecko rates (1e8 string, USD per 1 unit; `btcUsd` from CoinGecko `exchange_rates.usd`) |
| `cnyUsdRate`, `inrUsdRate`, `brlUsdRate`, `idrUsdRate`, `audUsdRate`, `aedUsdRate`, `krwUsdRate`, `rubUsdRate`, `jpyUsdRate` | CoinGecko `exchange_rates` derived rates (June 2026 display layer) |

Rates are parsed via [`parseFxRatesFromQuery`](../../lib/marketplace/price-normalize.ts) / [`fx-rate-registry.ts`](../../lib/marketplace/fx-rate-registry.ts) in [`filterAndSortListings`](../../src/api/index.ts). Backward-compatible: old frontends sending only `eurUsdRate` / `ethUsdRate` still work. CoinGecko fiat/crypto browse filters need **indexer + frontend** deployed together; **USD** price filter does not.

### Agent consignment routes — ✅ shipped June–July 2026

Read-only agent-scoped queries in [`src/api/index.ts`](../../src/api/index.ts). **Redeploy ponder image only** — `agentIdx` on `agent_authorization.agent` and `marketplace_listing.agent`; no `ponder-reindex.sql` expected (if `MigrationError` on VPS, see [OPERATIONS.md](./OPERATIONS.md)).

| Route | Purpose |
|-------|---------|
| `GET /agents/:address/authorizations` | Active authorizations for agent; `{ authorizations, total, page, limit }`; each row includes `hasActiveListing`; optional `?hasActiveListing=true\|false` filters before pagination (`total` reflects filter) |
| `GET /agents/:address/listings` | Listings where `agent` matches; same pagination envelope; optional `?active=true\|false`; enrichment matches `GET /profile/:address/listings` |

`:address` validated with `isAddress`; queries use checksum `getAddress()` to match chain-indexed rows.

**Owner authorization UI** still reads `agentAuthorizations(tokenId)` on-chain — not these routes. Ponder `agent_authorization` can show stale `active: true` after return events that clear on-chain mapping without `AgentRevoked`.

Passport rows include trust fields (`hadDispute`, `disputeOpenedAt`, …) and nullable `disputeDeposit` (set on `DisputeDepositPaid`, cleared on resolve/withdraw).

## HTTP API

Custom routes live in [`src/api/index.ts`](../../src/api/index.ts). Bigints are serialized as strings in JSON.

| Endpoint | Purpose |
|----------|---------|
| `GET /listings` | Browse and filter (optional FX query params for cross-currency filter/sort) |
| `GET /listings/stats` | Aggregate listing stats |
| `GET /listings/facets` | Filter facets (make, status, condition, …) |
| `GET /listings/:tokenId` | Listing detail |
| `GET /listings/batch` | Batch listing lookup |
| `GET /passports/:tokenId` | Passport detail |
| `GET /passports/batch` | Batch passport lookup |
| `GET /profile/:address/passports` | Passports owned by address |
| `GET /profile/:address/listings` | Listings by seller |
| `GET /agents/:address/authorizations` | Active consignment authorizations for agent (`page`, `limit`; `hasActiveListing` per row; optional `?hasActiveListing=true\|false`) |
| `GET /agents/:address/listings` | Listings where agent matches (`page`, `limit`; optional `?active=true\|false`) |
| `GET /notifications/:address` | Notification feed |
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
