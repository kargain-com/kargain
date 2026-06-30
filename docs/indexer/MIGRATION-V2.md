# Ponder generation v2 migration guide

**Status (June 2026):**

| Area | Status |
|------|--------|
| VPS env + contract addresses | ✅ Complete — `SEPOLIA_ACTIVE`, reindex from **43399242** ([ops/deploys/84532-v2.md](../ops/deploys/84532-v2.md)) |
| v1 ghost index data | ✅ Cleared after production reindex |
| Handler + schema for v2 events | ✅ Complete — `src/index.ts`, `ponder.schema.ts` (June 2026) |

Generation v2 contracts emit different events and use different listing fields than v1.x. **Handlers and schema are implemented** (including phase-2 marketplace and dispute-deposit events). This document remains as reference for the v2 mapping and FX display work (§6).

**Related:** [contracts/SPEC.md Part 0](../contracts/SPEC.md#part-0--conventions) (versioning) · [OPERATIONS.md](./OPERATIONS.md) (reindex runbook)

**Versioning:** **Generation v2** = new stack at new addresses. **Semver** = each contract's `VERSION()` (e.g. `2.0.0-rc.1` for MarketplaceEscrow). Indexer migration follows generation, not semver major alone.

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
| `DisputeDepositPaid` | Bond locked on dispute open |
| `DisputeWithdrawn` | Opener withdrew dispute + refund |
| `DisputeDepositUpdated` | Owner changed global deposit amount |

Existing handlers (`PassportDisputed`, `DisputeResolved`, etc.) remain relevant; `DisputeResolved` now carries `DisputeOutcome` enum instead of bool.

### KarProStaking

| Event | Purpose |
|-------|---------|
| `VerificationFeeUpdated` | Verifier public fee signal (wei) |

---

## 2. Handler implementation (complete)

Handlers in [`src/index.ts`](../../src/index.ts) index generation v2 events. Key mappings:

- **`Listed`:** `currencyCode` (bytes32 → ASCII), `agent`, `agentFeeBps`
- **`Sale`:** `platformFee`, `agentFee`, `payToken`, `agent`
- **`DisputeResolved`:** `outcome` enum via `disputeOutcomeUpholdsVerification`
- **`DisputeWithdrawn`:** dedicated handler (status `VERIFIED`)

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
| `verificationFee` | bigint | From `VerificationFeeUpdated` |

### New table: `agent_authorization`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text | `{tokenId}` or composite key |
| `tokenId` | text | Passport id |
| `agent` | text | Authorized agent |
| `expiry` | bigint | Unix; 0 = none |
| `ownerMinPrice1e8` | bigint | Floor in listing currency |
| `active` | boolean | Cleared on revoke / list end |

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

**Env + reindex (VPS):** ✅ Complete June 2026 — [ops/deploys/84532-v2.md](../ops/deploys/84532-v2.md). **Do not duplicate** [OPERATIONS.md](./OPERATIONS.md) runbook here.

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
5. Deploy Ponder; smoke `GET /listings`, `GET /passports/:tokenId` after mint/list on v2
6. ~~Update `lib/web3/sepolia-addresses.ts`~~ — ✅

### Deferred (phase 2) — ✅ complete

- ~~Marketplace: `ReturnRequested`, `ForceReturn`, `SettlementNoteSet`, `ExternalPaymentConfirmed`, `PaymentTokenApproved/Revoked`, `Paused`~~ — handlers in `src/index.ts`; schema columns `returnRequestedAt`, `externalPaymentConfirmedAt` on `marketplace_listing`; `disputeDeposit` on `passport`. **`SettlementNoteSet`** is a no-op handler (event has no `note` arg); frontend reads `settlementNotes(tokenId)` via wagmi RPC.
- ~~KarPassport: `DisputeDepositPaid`, `DisputeDepositUpdated`~~ — `DisputeDepositPaid` writes `passport.disputeDeposit`; cleared on `DisputeResolved` / `DisputeWithdrawn` via trust-field helpers.
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

Browse filter/sort: optional `*UsdRate` query params on `GET /listings` for CNY/INR/BRL/IDR/AUD/AED/KRW/RUB/JPY (and EUR/ETH/BTC). All non-USD display currencies require live CoinGecko (or Chainlink for EUR/ETH) rates — no hardcoded peg fallbacks. **Redeploy ponder image only** — no `ponder-reindex.sql`.

**Display selector (June 30, 2026):** 13 options — `USD, EUR, CNY, INR, BRL, IDR, AUD, AED, KRW, RUB, JPY, ETH, BTC`. **84532 listing creation stays USD-only.**

### Known display limitations

- **KRW / JPY** use the shared 2-decimal fiat formatter (e.g. `₩50,000,000.00`). Integer-only formatting for zero-decimal currencies is a possible follow-up.
- **CNY and JPY** share the `¥` glyph in the selector; the ISO code column disambiguates.

### Listing creation (84532)

**Unchanged:** sellers still list in **USD only** on Base Sepolia — [`listingCurrencyCodesForChain(84532)`](../../lib/marketplace/currency-code.ts) → `["USD"]`. Display-layer currencies do not add on-chain listing denominations.

---

*Last updated: June 30, 2026 — AED live-rate only (peg removed).*
