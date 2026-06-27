# Ponder v2 migration guide

The production indexer at [ponder.kargain.com](https://ponder.kargain.com) indexes **v1.x** MarketplaceEscrow and KarPassport contracts on Base Sepolia. v2 contracts emit different events and use different listing fields. This document guides the Ponder schema and handler update.

**Related:** [contracts-v2-spec.md](./contracts-v2-spec.md) · [VPS-PONDER-REINDEX.md](./VPS-PONDER-REINDEX.md)

---

## 1. What changed in v2 events

### MarketplaceEscrow

#### `Sale` (breaking shape)

v1 indexed `fee` and `payAsset` (enum). v2 emits:

| Field | v1 | v2 |
|-------|----|----|
| Platform fee | `fee` | `platformFee` |
| Agent fee | — | `agentFee` |
| Pay asset | `payAsset` (uint8 enum) | `payToken` (address; `address(0)` = native) |
| Agent | — | `agent` (address; zero for direct listings) |

v2 signature (last param non-indexed):

```
Sale(tokenId, buyer, seller, gross, platformFee, agentFee, netToSeller, payToken, agent)
```

#### `Listed` (extended)

v2 adds agent consignment fields:

| Field | v1 | v2 |
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

## 2. Current handler mismatch (v1 ABI on v2 chain)

Handlers in `src/index.ts` still assume v1 event shapes. Example — **`MarketplaceEscrow:Sale`**:

```293:313:src/index.ts
ponder.on("MarketplaceEscrow:Sale", async ({ event, context }) => {
  // ...
  await context.db.insert(marketplaceSale).values({
    // ...
    fee: event.args.fee,
    payAsset: Number(event.args.payAsset),
  });
});
```

v2 emits `platformFee`, `agentFee`, `payToken`, and `agent` — indexing v2 without ABI/handler updates will fail or write wrong columns.

Similarly, **`MarketplaceEscrow:Listed`** reads `event.args.fiatCurrency`; v2 emits `currencyCode`, `agent`, `agentFeeBps`.

---

## 3. New schema tables/columns

Proposed changes to `ponder.schema.ts` (implement before v2 cutover):

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

Deprecate `payAsset` enum column for v2 rows.

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

## 4. New v2 contract addresses

v2 Base Sepolia deployed **June 27, 2026** (`pnpm deploy:v2`). Index from block **43399242**.

| Contract | Address | Source |
|----------|---------|--------|
| Timelock48h | `0x9319e223ff31c954A940b14F04025B56A53ED384` | `deployments/84532.json` |
| KarProStaking v2 | `0xb5d79551BB11F726D2A1A110BAc645C4345dA568` | manifest |
| KarPassport v2 | `0x2C46B2310E2cb09b0FEeDd174D9CD3870137F594` | manifest |
| MarketplaceEscrow proxy v2 | `0x9411Af4C4Ec26D939fb1AD04362456Cb41616c19` | manifest |
| MarketplaceEscrow impl v2 | `0x58d5e740B29Ab549fBD4d0A147fcDedc32E0b6a3` | manifest |
| ProxyONFT721Adapter | `0x59779D666747AEeDB0d9cc843cB8a68B8ab2470c` | manifest |
| KarProPass | `0x8e4dcb5C0b415d6c2481D72dFac6da32d9cf22C1` | **reused** from v1 |

**`indexFromBlock`:** set from manifest `indexFromBlock` (minimum deploy block across v2 contracts). Do not reuse v1 start block.

**Ponder config:** add v2 addresses alongside v1 in `ponder.config.ts` / ABI imports after `node scripts/export-abis.mjs`.

---

## 5. Reindex procedure

Follow [VPS-PONDER-REINDEX.md](./VPS-PONDER-REINDEX.md) for Postgres backup, env vars, and restart.

### Cutover strategy

| Option | When | Notes |
|--------|------|-------|
| **Dual-index** | Transition period | Index both v1 and v2 contract addresses; API filters by `generation` or address set |
| **Hard cutover** | Clean break | Point app to v2 addresses only; v1 listings become legacy read-only |

v2 is a **fresh deploy** at new addresses — v1 event history stays on v1 contracts. No migration of listing state on-chain.

### Checklist

1. Export v2 ABIs; regenerate `abis.generated.ts`.
2. Update `ponder.schema.ts` + SQL migrations / reindex.
3. Rewrite handlers in `src/index.ts` for v2 events (and keep v1 handlers if dual-indexing).
4. Set `PONDER_START_BLOCK_84532` (or manifest `indexFromBlock`) to v2 deploy block.
5. Deploy Ponder; smoke `GET /listings`, `GET /passports/:tokenId`.
6. Update `lib/web3/deployment-addresses.ts` and app to consume v2 manifest.

---

## 6. FX display layer update

v2 allows listing in any registered fiat `currencyCode`. The app display layer (not Ponder) must extend beyond USD/EUR/ETH:

### CoinGecko extension (display only)

Extend `lib/marketplace/coingecko-rates.ts` (or successor) to fetch:

- **CNY**, **INR**, **BRL**, **IDR**, **AUD** for browse/filter display

Chainlink on-chain feeds remain authoritative for **checkout quotes**; CoinGecko fills display gaps where no on-chain feed exists on testnet.

### AED (pegged)

UAE dirham is pegged to USD. Use constant:

- **1 AED = 0.2723 USD** (UAE Central Bank peg, stable since 1997)

UI label: **"AED (pegged)"** — honest about non-oracle source.

Do not use CoinGecko for AED if product policy requires peg disclosure.

---

*Last updated: June 2026 — pre v2 deploy.*
