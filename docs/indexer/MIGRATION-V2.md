# Ponder generation v2 migration guide

**Status:**

| Area | Status |
|------|--------|
| VPS env + contract addresses (June 2026 v2) | ✅ Complete — reindex from **43399242** ([ops/deploys/archive/84532-v2.md](../ops/deploys/archive/84532-v2.md)) — **superseded for production by Nuclear below** |
| v1 ghost index data | ✅ Cleared after production reindex |
| Handler + schema for v2 events | ✅ Complete — `src/index.ts`, `ponder.schema.ts` (June 2026) |
| **Nuclear dual-chain / C3 (July 2026)** | ✅ Schema + handlers + API shipped — current production start blocks = **Nuclear #4** hub **44957457** + Eth **11404204** ([OPERATIONS.md](./OPERATIONS.md); **VPS reindex done**) |
| Bridge mint ≠ VerificationReset (July 2026) | ✅ Handler fixed — `PassportBridgeMinted` no longer writes reset count/history; covered by Nuclear full reindex |
| Trust layer `DisputeExpired` (July 2026) | ✅ Handler + `lastDisputeTerminal` — expire ≠ Confirm for product; covered by Nuclear full reindex |
| ClaimablePayouts claims surface (July 2026) | ✅ `pending_claim` + `claim_credit` + account API + notifications; covered by Nuclear full reindex |
| Commerce modes indexing (July 2026) | ✅ Schema + handlers + `/consignments*` / `/challenges` / mandate / `/commerce-*` routes — live Nuclear #4 addresses; production reindex **done** after Nuclear #4 ([OPERATIONS.md](./OPERATIONS.md)) |
| Outstanding obligation party indexes (July 2026) | ✅ Schema indexes + `GET /accounts/:address/obligations` + commerce notification stamps — included in Nuclear full reindex ([OPERATIONS.md](./OPERATIONS.md)) |
| Passport browse filter indexes (August 2026) | ✅ Expression indexes on `passport` (column + `lower(col)` as in schema). **No index** for `colour` / `search` (`ILIKE '%…%'` — revisit ~50k rows / measured latency; no `pg_trgm` yet). **VPS reindex + B1 done** 2026-08-14 ([OPERATIONS.md §6.0–§6.1](./OPERATIONS.md)) |
| **Bridge guid crossings (S7b · September 2026)** | ✅ `KarPassportBridgeGateway` indexed dual-chain; append-only `bridge_crossing` stream (`ONFTSent` / `ONFTReceived`); receive-side correlation with `PassportBridgeMinted` / `CustodyLockSet(unlock)` in same tx. **No HTTP consumer yet** — S7c fold. **Production reindex deferred to S9 cutover** ([OPERATIONS.md §S9 bridge crossings](./OPERATIONS.md)) |
| **SVM raw ingest (S7c-1 · September 2026)** | ✅ Append-only **`kargain_svm_raw`** via separate **`svm-ingest`** service; six production BPF programs; ordering `(slot, tx_index_in_block, log_index)`; four refusal kinds; chain-free replay digest. **VPS enable deferred to S9** ([OPERATIONS.md §SVM ingest](./OPERATIONS.md)) |
| **SVM provenance projection + UNION reads (S7c-2 · September 2026)** | ✅ Materialized **`kargain_svm_projection`** (`passport_record`, `passport_uri_history`) rebuilt from raw by **`svm-ingest`**; Hono provenance reads UNION EVM + SVM in one SQL via [`src/lib/ponder-passport-provenance.ts`](../../src/lib/ponder-passport-provenance.ts). Production enable deferred to **S9** ([OPERATIONS.md §S9](./OPERATIONS.md)) |
| **Custody two-stream fold (S7c-3 · September 2026)** | ✅ Removed stored `passport.custodyChain` / `custodyUpdatedAt`; append-only **`custody_determining_event`** (stream B) + existing **`bridge_crossing`** (stream A); read-time fold via [`lib/custody/fold.ts`](../../lib/custody/fold.ts) + [`src/lib/ponder-passport-custody.ts`](../../src/lib/ponder-passport-custody.ts). HTTP emits `custodyChain` when resolved or `custodyUnresolved` cause when not. SVM mirror: **`kargain_svm_projection.custody_determining_event`**. **Production reindex deferred to S9** ([OPERATIONS.md §S9](./OPERATIONS.md)) |
| **EVM event disposition (S7-event-disposition · September 2026)** | ✅ All **110** commercial ABI events carry exactly one disposition (78 handler census + 5 named divergences D-38–D-42 + 30 out-of-scope reason classes in [`svm/crates/kargain-events/event-dispositions.json`](../../svm/crates/kargain-events/event-dispositions.json)); validated on `pnpm generate:svm-event-manifest` + `test:verify` |

Generation v2 contracts emit different events and use different listing fields than v1.x. **Handlers and schema are implemented** (including phase-2 marketplace and dispute-deposit events). **July 2026:** the `MarketplaceEscrow` / `AuctionEscrow` schema and handlers described in §1–§3 below (`marketplace_listing`, `marketplace_sale`, `agent_authorization`, `auction*`, `currency_feed`) have been **removed** — commerce lives entirely in the FixedPrice/Ascending consignment surface (§3's commerce-modes note, and [indexer/README.md](./README.md)). This document remains as historical reference for the v1→v2 event mapping and for the FX display work (§6).

### Nuclear dual-chain (C3)

Identical commercial stacks on Base Sepolia (**84532**) and Ethereum Sepolia (**11155111**). Addresses only from `deployments/<chainId>.json`. Entity/API keys include `chainId`; **usable-copy location** is derived at read from stream B + guid crossings (S7c-3) — HTTP `custodyChain` when resolved, `custodyUnresolved` when not. `passport_record` / `passport_uri_history` are written by both networks into one table (UNION by global `tokenId`).

**Related:** [contracts/SPEC.md Part 0](../contracts/SPEC.md#part-0--conventions) (versioning) · [OPERATIONS.md](./OPERATIONS.md) (reindex runbook) · [SPEC §I.12](../contracts/SPEC.md#i12-multi-chain-architecture-normative)

**Versioning:** **Generation v2** = new stack at new addresses. **Semver** = each contract's `VERSION()` (e.g. FixedPriceConsignment `2.3.0-rc.1`, AscendingConsignment `2.2.0-rc.1`). Indexer migration follows generation, not semver major alone.

---

## 1. What changed in generation v2 events

### MarketplaceEscrow

#### `Sale` (breaking shape)

v1 indexed `fee` and `payAsset` (enum). Generation v2 emits:

| Field | v1.x | Generation v2 |
|-------|----|----|
| Platform fee | `fee` | `platformFee` |
| Agent fee | — | `agentFee` |
| Pay asset | `payAsset` (uint8 enum) | `payToken` (address; `address(0)` = native) |
| Agent | — | `agent` (address; zero for direct listings) |

Generation v2 signature (last param non-indexed):

```
Sale(tokenId, buyer, seller, gross, platformFee, agentFee, netToSeller, payToken, agent)
```

#### `Listed` (extended)

Generation v2 adds agent consignment fields:

| Field | v1.x | Generation v2 |
|-------|----|----|
| Price / currency | `fiatPrice1e8`, `fiatCurrency` (enum) | `fiatPrice1e8`, `currencyCode` (bytes32) |
| Agent | — | `agent`, `agentFeeBps` |

#### New events to index

| Event | Purpose |
|-------|---------|
| `AgentAuthorized` | Owner grants agent (expiry, ownerMinPrice) |
| `AgentRevoked` | Authorization removed |
| `ListingUpdated` | Agent price / fee change |
| `OwnerMinPriceUpdated` | Seller lowered minimum net |
| `ReturnRequested` | Owner started 7-day return timer |
| `AgentDelisted` | Agent returned NFT |
| `ForceReturn` | Owner forced return after cooldown |
| `SettlementNoteSet` | Seller set external payment instructions |
| `ExternalPaymentConfirmed` | Seller attested off-chain payment sale |
| `CurrencyFeedSet` / `CurrencyFeedRevoked` | Fiat registry |
| `PaymentTokenApproved` / `PaymentTokenRevoked` | Checkout token registry |
| `Paused` | Marketplace pause state |
| `UpgradeAuthorityTransferred` | Governance handoff |

### KarPassport

| Event | Purpose |
|-------|---------|
| `ChallengeOpened` | Bond locked on verification challenge open (BondedChallenge; replaces `DisputeDepositPaid`) |
| `ChallengeWithdrawn` | Opener withdrew challenge + refund (replaces `DisputeWithdrawn`) |
| `ChallengeJudged` / `ChallengeConcluded` | Merits or window expiry (replaces `DisputeResolved` / `DisputeExpired`) |
| `PassportDisputed` | Domain status → DISPUTED (kept) |
| `VerificationLapsed` / `VerificationStood` | Domain status after terminals |
| `DisputeDepositUpdated` | Owner changed global deposit amount |

Handlers in `src/index.ts` listen for `Challenge*` on live Nuclear #4 ABIs; legacy `Dispute*` names are historical only.

### KarPassportBridgeGateway (S7b · September 2026)

| Event | Indexed into | Notes |
|-------|--------------|-------|
| `ONFTSent` | `bridge_crossing` (`direction=sent`) | One row per observed side; `peerLayerZeroEid` = `dstEid` |
| `ONFTReceived` | `bridge_crossing` (`direction=received`) | `peerLayerZeroEid` = `srcEid`; same-tx link to passport mint or unlock when unambiguous |
| `RecoveredLockedHome` | — | **Not** in crossing stream (no `guid`; admin recovery path). Disposition: `governed_recovery_no_guid` in [`event-dispositions.json`](../../svm/crates/kargain-events/event-dispositions.json) |

**Correlation (receive only):** `PassportBridgeMinted` or `CustodyLockSet(locked=false)` in the same transaction, matched by exact `tokenId`. Zero matches → `passportCounterpartRefusal=absent`; multiple → `ambiguous`. Unknown LayerZero EID → `peerNamespaceRefusal=unknown_endpoint_id` (row still recorded).

**Custody (S7c-3):** Stored `passport.custodyChain` / `custodyUpdatedAt` **removed**. Handlers append **`custody_determining_event`** (`PassportMinted`, `PassportBridgeMinted`, `CustodyLockSet(unlock)`, origin `VerificationReset`). **`bridge_crossing`** (S7b) is stream A. Read owner [`src/lib/ponder-passport-custody.ts`](../../src/lib/ponder-passport-custody.ts) folds at HTTP time; incomplete fold → `custodyUnresolved` (never origin fallback). Cross-writer order uses **guid linkage + per-writer log order only** — not timestamps. **S7c-4** (SVM passport entity UNION) is separate.

Handlers: [`src/bridge-handlers.ts`](../../src/bridge-handlers.ts) · pure helpers [`lib/bridge/crossing-stream.ts`](../../lib/bridge/crossing-stream.ts) · EID resolver [`lib/web3/commercial-eid-namespace.ts`](../../lib/web3/commercial-eid-namespace.ts).

### KarProStaking

| Event | Purpose |
|-------|---------|
| `VerificationFeeUpdated` | Verifier public fee signal (wei) |

---

## 2. Handler implementation (complete)

Handlers in [`src/index.ts`](../../src/index.ts) index generation v2 events. Key mappings:

- **`Listed`:** `currencyCode` (bytes32 → ASCII), `agent`, `agentFeeBps`
- **`Sale`:** `platformFee`, `agentFee`, `payToken`, `agent`
- **`ChallengeJudged`:** `outcome` enum via `disputeOutcomeUpholdsVerification` (replaces `DisputeResolved`)
- **`ChallengeWithdrawn`:** dedicated handler (status `VERIFIED`; replaces `DisputeWithdrawn`)
- **`ChallengeConcluded`:** expire-lapse path (replaces `DisputeExpired`)
- **`ChallengeOpened`:** bond lock + `disputeDeposit` column (replaces `DisputeDepositPaid`)

API layer ([`src/api/index.ts`](../../src/api/index.ts)) exposes legacy `fiatCurrency: 0|1` derived from `currencyCode` for existing browse/buy UI.

---

## 3. New schema tables/columns

Proposed changes to `ponder.schema.ts` (implement before generation v2 cutover):

### `marketplace_listing` (extend)

| Column | Type | Notes |
|--------|------|-------|
| `currencyCode` | text | Hex or ASCII decode of `bytes32` (e.g. `USD`, `EUR`) — **replaces** `fiatCurrency` integer enum |
| `agent` | text | Agent address or empty |
| `ownerMinPrice1e8` | bigint | From listing / authorization |
| `agentFeeBps` | integer | Agent fee basis points |

Deprecate `fiatCurrency` after dual-index period or map legacy rows on read.

### `marketplace_sale` (extend)

| Column | Type | Notes |
|--------|------|-------|
| `platformFee` | bigint | Replaces monolithic `fee` |
| `agentFee` | bigint | New |
| `payToken` | text | ERC-20 address or empty for native |
| `agent` | text | Agent on consignment sales |

Deprecate `payAsset` enum column for generation v2 rows.

### `verifier` (extend)

| Column | Type | Notes |
|--------|------|-------|
| `verificationFee` | bigint | From `VerificationFeeUpdated`; exposed on `GET /verifiers` and `GET /verifiers/:address` as string wei (July 2026) |

### New table: `agent_authorization`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text | `{tokenId}-{lowercase agent}` composite key |
| `tokenId` | text | Passport id |
| `owner` | text | Owner from the authorization event |
| `agent` | text | Authorized agent |
| `expiry` | bigint | Unix; 0 = none |
| `ownerMinPrice1e8` | bigint | Floor in listing currency |
| `active` | boolean | Cleared on revoke / list end |
| `createdAt` | bigint | First authorization event that created the row |
| `updatedAt` | bigint | Last event that touched the row |
| `authorizedAt` | bigint | Latest authorization grant; notification window source |

`AgentAuthorized` deactivates any prior active composite row for the token before
upserting the new grant. `AgentRevoked`, `Delisted`, `AgentDelisted`, `Sale`,
`ForceReturn`, and `ExternalPaymentConfirmed` mirror the contract's storage
clear by setting the indexed row inactive. Term changes advance `updatedAt`
without advancing `authorizedAt`.

**July 2026: table removed.** `agent_authorization` (and its HTTP routes) was
dropped along with the rest of the `MarketplaceEscrow` surface. Mandate grants
now feed `mandate.granted` on `GET /notifications/:address` — see
[indexer/README.md](./README.md).

### New table: `currency_feed`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text | `{chainId}-{currencyCode}` |
| `chainId` | integer | Network |
| `currencyCode` | text | e.g. `EUR` |
| `feed` | text | Chainlink aggregator |
| `registeredAt` | bigint | Block timestamp |

---

## 4. Generation v2 contract addresses (84532)

Generation v2 deployed **June 27, 2026** (`pnpm deploy:sepolia`). **Do not copy addresses here** — canonical table with semver and Basescan links: **[contracts/SPEC.md Part I.9.1](../contracts/SPEC.md#i91-active-deployment-base-sepolia-84532)**.

**Indexer wiring from manifest** (`deployments/84532.json` — not in git):

| Field | Use |
|-------|-----|
| `indexFromBlock` | **43399242** — set `PONDER_START_BLOCK_84532` (do not reuse v1 start block) |
| `karPassport`, `marketplace`, … | Committed `SEPOLIA_ACTIVE` after git pull (`pnpm ponder:config` to verify) |
| `generation` | `"v2"` — distinguish from v1.x rows if dual-indexing |

**Ponder config:** point handlers at generation v2 ABIs (`node scripts/export-abis.mjs`) before cutover. Historical v1.x addresses: [contracts/SPEC.md Part II.4](../contracts/SPEC.md#ii4-historical-deployment-base-sepolia-84532).

---

## 5. Cutover checklist

**Env + reindex (VPS):** ✅ Complete June 2026 — [ops/deploys/archive/84532-v2.md](../ops/deploys/archive/84532-v2.md). Production: Nuclear #4 [OPERATIONS.md](./OPERATIONS.md) / [nuclear-4.md](../ops/deploys/nuclear-4.md).

### Strategy

| Option | When | Notes |
|--------|------|-------|
| **Dual-index** | Transition period | Index both v1.x and generation v2 contract addresses; API filters by `generation` or address set |
| **Hard cutover** | Clean break | Point app to generation v2 addresses only; v1.x listings become legacy read-only |

Generation v2 is a **fresh deploy** at new addresses — v1.x event history stays on v1 contracts. No migration of listing state on-chain.

### Checklist (handler migration — complete)

1. ~~Export ABIs; regenerate `abis.generated.ts`~~ — ✅
2. ~~Update `ponder.schema.ts` + reindex~~ — ✅ (reindex after VPS deploy)
3. ~~Rewrite handlers in `src/index.ts` for generation v2 events~~ — ✅
4. ~~Set `PONDER_START_BLOCK_84532`~~ — ✅ **43399242** on production VPS
5. Deploy Ponder; smoke `GET /consignments`, `GET /passports/:tokenId` after mint/open on Nuclear modes
6. ~~Update `lib/web3/sepolia-addresses.ts`~~ — ✅

### Deferred (phase 2) — ✅ complete

- ~~Marketplace: `ReturnRequested`, `ForceReturn`, `SettlementNoteSet`, `ExternalPaymentConfirmed`, `PaymentTokenApproved/Revoked`, `Paused`~~ — handlers in `src/index.ts`; schema columns `returnRequestedAt`, `externalPaymentConfirmedAt` on `marketplace_listing`; `disputeDeposit` on `passport`. **`SettlementNoteSet`** is a no-op handler (event has no `note` arg); frontend reads `settlementNotes(tokenId)` via wagmi RPC.
- ~~KarPassport: `ChallengeOpened`, `DisputeDepositUpdated`~~ — `ChallengeOpened` writes `passport.disputeDeposit`; cleared on challenge terminals via trust-field helpers (legacy names: `DisputeDepositPaid` / `DisputeResolved` / `DisputeWithdrawn`).
- CoinGecko FX extension — §6 below

---

## 6. FX display layer update

Generation v2 allows listing in any registered fiat `currencyCode`. The app display layer (not Ponder schema) extends beyond USD/EUR/ETH:

### CoinGecko extension (display only) — ✅ shipped June 2026

[`lib/marketplace/coingecko-rates.ts`](../../lib/marketplace/coingecko-rates.ts) + [`lib/marketplace/fx-rate-registry.ts`](../../lib/marketplace/fx-rate-registry.ts):

- **`simple/price`** — ETH/USD + EUR/USD (existing; EUR via ETH cross-rate)
- **`exchange_rates`** — CNY, INR, BRL, IDR, AUD, **AED**, **KRW**, **RUB**, **JPY** (USD per unit at 1e8)
- **`exchange_rates.usd`** — USD per BTC → `btcUsd` for BTC display (suffix `BTC`, 4 decimals)

Chainlink on-chain feeds remain authoritative for **checkout quotes**; CoinGecko fills display gaps where no on-chain feed exists on testnet.

Browse filter/sort: optional `*UsdRate` query params on `GET /consignments` for CNY/INR/BRL/IDR/AUD/AED/KRW/RUB/JPY (and EUR/ETH/BTC) when the browse path forwards them. All non-USD display currencies require live CoinGecko (or Chainlink for EUR/ETH) rates — no hardcoded peg fallbacks. **Asking USD in SQL** is the same facts as card display: [`listing-price-display.ts`](../../lib/commerce/listing-price-display.ts) `askingUsdcFacts` (USDC Asset peg, native via `ethUsdRate`, unknown ERC-20 NULL). Legacy `GET /listings` was removed with MarketplaceEscrow.

**Display selector (June 30, 2026):** 13 options — `USD, EUR, CNY, INR, BRL, IDR, AUD, AED, KRW, RUB, JPY, ETH, BTC`. **84532 listing creation stays USD-only.**

### Agent consignment HTTP API — superseded July 2026

The `agent_authorization` / `marketplace_listing` agent routes described above (`GET /agents/:address/authorizations`, `GET /agents/:address/listings`, `GET /owners/:address/authorizations`, …) were removed with the rest of the `MarketplaceEscrow` surface. The equivalent consignment-era routes (`GET /agents/:address/mandates`, `GET /owners/:address/mandates`, `GET /agents/:address/consignments`) live in [`src/api/commerce-routes.ts`](../../src/api/commerce-routes.ts) — see [indexer/README.md](./README.md).

### Commerce modes (FixedPrice / Ascending) — ✅ schema July 2026

Accountability events from `ConsignmentBase` / `Mandate` / `Recall` / `BondedChallenge` / mode-specific surfaces feed new tables (`consignment`, `ascending_terms`, `consignment_bid`, `consignment_hold`, `challenge`, `mandate`, `consignment_settlement`, `commerce_claim` + `commerce_claim_credit`, `commerce_mode`, `commerce_payment_token`, `commerce_currency_feed`). Claim reasons come from **same-tx event correlation**, not tx selectors. Floor/commission lowers update the **consignment** snapshot, not the standing mandate.

**FixedPrice oracle projection (July 2026, live Nuclear #4 FixedPrice `2.4.0-rc.1`):** `commerce_mode.nativeUsdStalenessTolerance` from `NativeUsdStalenessToleranceSet` (replaces `MaxFeedStalenessSet`). `commerce_payment_token.stalenessTolerance` and `commerce_currency_feed.stalenessTolerance` from `PaymentTokenApproved` / `CurrencyFeedSet` (third arg). No global `maxFeedStaleness` column. Nuclear #4 VPS reindex **done** ([OPERATIONS.md](./OPERATIONS.md)).

**Addresses:** FixedPrice + Ascending on `COMMERCIAL_ACTIVE` (84532 + 11155111) after Nuclear #4. Local: `pnpm deploy:local` writes both proxies into `31337.json` and registers encumbrance sources.

**HTTP:** see [indexer/README.md](./README.md#commerce-modes-api-fixedprice--ascending--july-2026). Old escrow tables/handlers/routes untouched — no compatibility projection.

### Known display limitations

- **KRW / JPY** use the shared 2-decimal fiat formatter (e.g. `₩50,000,000.00`). Integer-only formatting for zero-decimal currencies is a possible follow-up.
- **CNY and JPY** share the `¥` glyph in the selector; the ISO code column disambiguates.

### Listing creation (84532)

**Unchanged:** sellers still list in **USD only** on Base Sepolia — [`listingCurrencyCodesForChain(84532)`](../../lib/marketplace/currency-code.ts) → `["USD"]`. Display-layer currencies do not add on-chain listing denominations.

---

*Last updated: July 30, 2026 — FixedPrice per-feed oracle staleness (`2.3.0-rc.1`); commerce cutover step 5; consignment surface is sole live commerce indexer path.*
