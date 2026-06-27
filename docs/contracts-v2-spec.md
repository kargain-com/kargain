# Kargain contracts v2 — specification

> **Canonical reference** for new v2 deployments (June 2026).  
> Historical v1.x behavior and live Base Sepolia v1.1 addresses: [passport-v1.1-spec.md](./passport-v1.1-spec.md).

**Scope:** On-chain behavior for all seven production contracts, bridge architecture, deploy sequence, security model, and v1→v2 deltas.

**Not in this file:** UI patterns ([design-spec.md](./design-spec.md)), Ponder migration steps ([PONDER-V2-MIGRATION.md](./PONDER-V2-MIGRATION.md)), indexer ops ([VPS-PONDER-REINDEX.md](./VPS-PONDER-REINDEX.md)).

---

## 1. Overview and version matrix

### Contract family

| Contract | VERSION constant | Upgrade model | Role |
|----------|------------------|---------------|------|
| KarPassport | `1.2.0-rc.1` | Immutable | Vehicle passport ERC-721, verification lifecycle, dispute deposits |
| KarProPass | `1.0.0-rc.1` | Immutable | Soulbound verifier credential (one per wallet) |
| KarProStaking | `1.1.0-rc.1` | Immutable | Verifier stake + `isActiveVerifier` |
| MarketplaceEscrow | `2.0.0-rc.1` | UUPS proxy | Listing escrow, dynamic fiat currencies, agent consignment |
| Timelock48h | `1.0.0-rc.1` | Immutable | 48h governance for MarketplaceEscrow |
| ProxyONFT721Adapter | `1.0.0-rc.1` | Immutable | Hub-chain lock-and-bridge adapter |
| KarPassportONFT721 | `1.0.0-rc.1` | Immutable | Spoke-chain mint/burn ONFT |

Source of truth for VERSION strings: `scripts/lib/contract-versions.ts` (must match Solidity `VERSION` constants).

### v1.x → v2 summary

| Area | v1.x | v2 |
|------|------|-----|
| Listing currency | Enum (`USD` / `EUR`) | `bytes32` registry + Chainlink feeds per currency |
| Marketplace governance | Deployer EOA as `upgradeAuthority` | `Timelock48h` as `upgradeAuthority` |
| Agent sales | None | Dépôt-vente: authorize → listOnBehalf → fee split |
| External payment | None | `setSettlementNote` + `confirmExternalPayment` |
| KarPassport tokenId | Sequential from 0 | `chainId << 128 \| localSequence` |
| Disputes | Deposit-free; D6 withdraw via `reportDiscrepancy` | Payable deposit; `withdrawDispute`; `DisputeOutcome` enum |
| Verifier pricing | None on-chain | `verificationFee` (informational) |
| Bridge | None | LayerZero ONFT (lock on hub, mint on spoke) |
| Checkout | ETH + USDC | Native + any approved ERC-20 payment token |

### Fee configuration note

| Context | `platformFeeBps` | Notes |
|---------|------------------|-------|
| `scripts/deploy-v2.ts` (production deploy) | `10` (0.1%) | Intended testnet/mainnet default |
| `scripts/lib/local-stack.ts` (Hardhat tests) | `250` (2.5%) | Test-only; not deploy default |

---

## 2. KarPassport v1.2.0

### Philosophy (unchanged from v1)

- Passport = hybrid public fact registry + transferable ownership. **No burn.**
- Trust state (`status`, `verifier`, `verifiedAt`) — **on-chain only**.
- Vehicle description — metadata JSON on Arweave (`tokenURI`).
- History — append-only on-chain `records[]`.
- Spam / trust — transparency, not on-chain gates (no mint fee, no listing stake).

### Status lifecycle

```
UNVERIFIED ──verifyPassport──► VERIFIED
     ▲                              │
     │                              │ disputePassport (+ deposit)
     │                              ▼
     │                          DISPUTED
     │                              │
     │         withdrawDispute (opener only)
     │                              │
     │                              ▼
     │                          VERIFIED
     │                              │
     │              resolveDispute(ConfirmDispute) ──► UNVERIFIED
     │              resolveDispute(RejectDispute)  ──► VERIFIED
     │
     └── setPassportURI from VERIFIED ── VerificationReset ──► UNVERIFIED
```

**Exit from DISPUTED:** `withdrawDispute` (opener) **or** `resolveDispute` (active verifier, not opener). Owner cannot `setPassportURI` while DISPUTED.

### tokenId encoding

Constructor sets `tokenIdOffset = block.chainid << 128` and `_nextTokenId = tokenIdOffset`.

| Function | Behavior |
|----------|----------|
| `chainIdOf(tokenId)` | `tokenId >> 128` |
| `localIdOf(tokenId)` | `tokenId & type(uint128).max` |

| Chain | chainId | tokenIdOffset (hex concept) |
|-------|---------|----------------------------|
| Base Sepolia | 84532 | `84532 << 128` |
| Ethereum Sepolia | 11155111 | `11155111 << 128` |
| Polygon Amoy | 80002 | `80002 << 128` |
| Base mainnet | 8453 | `8453 << 128` |

Mint reverts `TokenIdSpaceExhausted` when local sequence reaches `type(uint128).max`.

### Dispute deposit system

| Parameter | Default (deploy-v2) | Admin |
|-----------|---------------------|-------|
| `disputeDeposit` | `0.01 ether` | `setDisputeDeposit` (owner) |
| `totalLockedDeposits` | Sum of active bonds | Accounting only |

| Action | Caller | Effect |
|--------|--------|--------|
| `disputePassport` | Anyone (payable) | VERIFIED → DISPUTED; locks `msg.value ≥ disputeDeposit`; records opener |
| `withdrawDispute` | Dispute opener only | DISPUTED → VERIFIED; full deposit refund to opener |
| `resolveDispute(ConfirmDispute)` | Active verifier (≠ opener) | → UNVERIFIED; deposit to **opener** |
| `resolveDispute(RejectDispute)` | Active verifier (≠ opener) | → VERIFIED; deposit to **resolver** (not seller) |

`DisputeOutcome`: `ConfirmDispute` (0) = verification was wrong; `RejectDispute` (1) = verification stands.

Setting `disputeDeposit` to zero allows zero-cost disputes (owner choice; griefing risk documented in NatSpec).

### Unchanged v1.1 behaviors

- **Variant C** `setPassportURI`: VERIFIED + different URI → `VerificationReset` → UNVERIFIED; DISPUTED → revert; same URI → `SameURI`.
- `appendRecord`, `reportDiscrepancy`, `appendAttestation` — record-only paths unchanged in role.
- `verifyPassport`: active verifier only; `CannotSelfVerify` if verifier owns token.
- **E5:** Buyer inherits `passportStatus` on transfer; no auto-reset on sale.
- Escrow ownership blocks owner-only mutations (`NotOwner` while listed).

### KarPassport — function reference

| Function | Access | Behavior |
|----------|--------|----------|
| `chainIdOf` / `localIdOf` | view | Decode tokenId namespace |
| `setDisputeDeposit` | owner | Update minimum bond; emits `DisputeDepositUpdated` |
| `rescueExcessEth` | owner | Withdraw ETH not in `totalLockedDeposits` |
| `mintPassport` | anyone | Mint UNVERIFIED passport; increment chain-local id |
| `setPassportURI` | token owner | Variant C URI update |
| `verifyPassport` | active verifier | UNVERIFIED → VERIFIED |
| `disputePassport` | anyone + ETH | VERIFIED → DISPUTED + deposit |
| `withdrawDispute` | dispute opener | DISPUTED → VERIFIED + refund |
| `resolveDispute` | active verifier | Resolve DISPUTED; route deposit |
| `appendRecord` | token owner | Append typed record |
| `reportDiscrepancy` | anyone | Append discrepancy record (no status change) |
| `appendAttestation` | active verifier | Append attestation record |
| `getPassportStatus` | view | Status, verifier, verifiedAt |
| `recordCount` | view | Length of `records[tokenId]` |
| `nextTokenId` | view | Next mint id |
| `supportsInterface` | view | ERC-165 |

### KarPassport — error reference

| Error | When |
|-------|------|
| `NonexistentToken` | Invalid tokenId |
| `NotOwner` | Caller is not token owner |
| `NotActiveVerifier` | Verifier gate failed |
| `CannotSelfVerify` | Verifier owns passport |
| `InvalidStatus` | Wrong status for operation |
| `EmptyField` | Required string/zero address empty |
| `SameURI` | URI unchanged |
| `InsufficientDeposit` | `disputePassport` value too low |
| `NotDisputeOpener` | `withdrawDispute` not opener |
| `NoActiveDispute` | Not DISPUTED |
| `CannotResolveSelfDispute` | Resolver is dispute opener |
| `NothingToRescue` | Rescue amount invalid |
| `TransferFailed` | ETH send failed |
| `TokenIdSpaceExhausted` | 2^128 mints on chain |

---

## 3. KarProPass v1.0.0

Soulbound ERC-721: **one pass per wallet**, non-transferable after mint.

- `tokenId = uint256(uint160(holderAddress))`.
- Only `KarProStaking` may `mint` / `burn`.
- `updateProfile` is the canonical holder path for category, name, metadata URI.
- `setStaking`: **`ZeroAddress` guard** — cannot point staking to zero.

### KarProPass — function reference

| Function | Access | Behavior |
|----------|--------|----------|
| `setStaking` | owner | Wire staking contract (non-zero) |
| `mint` | staking only | Mint soulbound pass to holder |
| `burn` | staking only | Burn pass; clear profile storage |
| `updateProfile` | holder | Update on-chain profile fields |
| `getProPassData` | view | Holder, category, name, URI, issuedAt |
| `approve` / `setApprovalForAll` | anyone | Always `Soulbound` revert |
| Transfers | — | Blocked except mint/burn (`Soulbound`) |

### KarProPass — error reference

| Error | When |
|-------|------|
| `OnlyStaking` | Non-staking caller on mint/burn |
| `AlreadyHoldsPass` | Mint when balance > 0 |
| `DoesNotHoldPass` | Burn when no pass |
| `Soulbound` | Transfer or approval attempted |
| `NotHolder` | `updateProfile` without pass |
| `ZeroAddress` | `setStaking(0)` |

---

## 4. KarProStaking v1.1.0

- **`isActiveVerifier(address)`** — single source of truth (active stake record).
- **`becomeVerifierNative`** / **`becomeVerifierToken`** — permissionless join; mints KarProPass.
- **`leave()`** — full stake refund; **no slashing**; `proPass.burn` wrapped in try/catch so stake always returns.
- **`minStakeNative`** — default `0.05 ether`; owner adjustable but **`MIN_STAKE_FLOOR = 0.001 ether`** minimum.
- **`verificationFee`** — verifier-set wei amount; **informational only** (no on-chain payment enforcement). Workflow: verifier sets fee → owner pays off-chain → verifier calls `verifyPassport` after payment.

### KarProStaking — function reference

| Function | Access | Behavior |
|----------|--------|----------|
| `becomeVerifierNative` | anyone + ETH | Stake native; mint pass |
| `becomeVerifierToken` | anyone | Stake configured ERC-20; mint pass |
| `leave` | active verifier | Deactivate; refund stake; attempt burn |
| `setMinStakeNative` | owner | New minimum (≥ floor) for **new** joiners |
| `setStakeToken` | owner | Enable/update ERC-20 stake token + min |
| `isActiveVerifier` | view | Active stake check |
| `setVerificationFee` | active verifier | Set public fee signal (wei) |

### KarProStaking — error reference

| Error | When |
|-------|------|
| `BelowMinStake` | Native stake below minimum |
| `AlreadyVerifier` | Active stake exists |
| `NotVerifier` | Leave or fee update without active stake |
| `TokenNotEnabled` | Token path not configured |
| `TransferFailed` | Native refund failed |
| `BelowMinStakeFloor` | Owner sets min below 0.001 ETH |

---

## 5. MarketplaceEscrow v2.0.0

UUPS-upgradeable escrow. **`upgradeAuthority`** = `Timelock48h` after deploy handoff. Immutable constructor deps: `karPassport`, `usdc`, `nativeUsdFeed`, `karProStaking`, `platformRecipient`, fee bps, `maxFeedStaleness`.

### 5.1 Currency system

| Code | Constant | Feed requirement |
|------|----------|------------------|
| USD | `CURRENCY_USD` = `bytes32("USD")` | None (1 USD = 1e8 internal) |
| Native-priced listing | `CURRENCY_NATIVE` = `bytes32("NATIVE")` | None — price **is** payment amount (× 1e10 scale) |
| Other (EUR, GBP, …) | ISO-style `bytes32` padded | Live Chainlink feed registered via `setCurrencyFeed` |

**Feed validation** (`setCurrencyFeed`): non-zero feed must have bytecode, `decimals() == 8`, latest `answer > 0`.

**Policy:** No hardcoded exchange rates in contract logic — only Chainlink (or USD 1:1 for stables via `feed = address(0)` on payment tokens).

**Initial currencies per chain** (from `scripts/lib/chainlink-feeds.ts`; deploy registers only feeds with live bytecode):

| chainId | Network | Currencies at deploy |
|---------|---------|---------------------|
| 84532 | Base Sepolia | USD only (+ native USD feed for checkout) |
| 11155111 | Ethereum Sepolia | USD, EUR, GBP, JPY (if feeds live) |
| 80002 | Polygon Amoy | USD only |
| 8453 | Base mainnet (planned) | USD, EUR, GBP, CAD (+ AUD if feed configured) |

EUR listing on Base Sepolia requires post-deploy `setCurrencyFeed` once a live EUR/USD aggregator exists on that chain.

### 5.2 Direct listing

| Function | Seller | Behavior |
|----------|--------|----------|
| `list` | Owner | Transfer NFT to escrow; no agent |
| `delist` | Seller only | Return NFT; clear listing |
| `setSettlementNote` | Seller | Store off-chain payment instructions (required for external confirm) |

**Note:** `list` reverts **`NotActive`** when `listings[tokenId].active` is already true (misleading name — means “already listed”).

Direct listings cannot use agent paths (`ListingHasAgent` on seller-only ops where applicable).

### 5.3 Agent consignment (dépôt-vente)

Owner retains **title** (seller field); agent manages sale terms.

| Step | Function | Notes |
|------|----------|-------|
| 1 | Owner approves marketplace (`approve` or `setApprovalForAll`) | Required before authorize |
| 2 | `authorizeAgent(tokenId, agent, expiry, ownerMinPrice)` | `expiry = 0` → no expiry |
| 3 | `listOnBehalf(...)` | Agent sets price, `agentFeeBps`, optional settlement note |
| 4 | `updateListing` | Agent may change price **and** fee without owner signature |
| 5 | Sale or return | Fee split or return flows |

**Invariant:** `sellerNet = price - agentFee - platformFee ≥ ownerMinPrice1e8` always (`BelowOwnerMinPrice`).

| Constant | Value |
|----------|-------|
| `_MAX_AGENT_FEE_BPS` | 3000 (30%) |
| `_MAX_FEE_BPS` | 1000 (10%) platform cap |
| `_RETURN_COOLDOWN` | 7 days |

| Return path | Caller | Behavior |
|-------------|--------|----------|
| `requestReturn` | Owner | Starts 7-day timer; `ReturnAlreadyRequested` if timer already set |
| `forceReturn` | Owner | After cooldown; returns NFT |
| `agentDelist` | Agent | Voluntary return anytime |
| `revokeAgent` | Owner | Only when **not** actively listed |

`updateOwnerMinPrice`: owner may **lower** only (`CannotRaiseMinPrice`).

### 5.4 Payment flows

| Path | Entry | Settlement |
|------|-------|------------|
| Native checkout | `buyWithNative` | ETH (or chain native) via `nativeUsdFeed` quote |
| ERC-20 checkout | `buyWithToken(tokenId, token)` | Approved payment token + optional feed |
| External | `confirmExternalPayment(tokenId, buyer)` | Seller attests off-chain payment; **zero platform fee** |

- **Three-way split** (agent listings): `agentFee` → agent, `platformFee` → `platformRecipient`, remainder → seller.
- **`confirmExternalPayment`**: trust-based seller attestation — not cryptographic proof of bank/Lightning/BTC payment.
- Active verifier sellers may get reduced platform fee via `proFeeBps` (immutable at deploy; Sepolia deploy uses `0`).

### 5.5 Quote functions

| Function | Returns |
|----------|---------|
| `listingUsd1e8` | Listing price normalized to USD 1e8 |
| `quoteBuyWithNative` | Wei required (reverts if stale oracle) |
| `quoteBuyWithToken` | Token amount for approved pay token |

**NATIVE listing:** payment = `fiatPrice1e8 * 1e10` (direct wei-scale conversion, no oracle).

**USD listing:** USD 1e8 ÷ ETH/USD rate → wei.

**Other fiat:** convert listing currency → USD via currency feed, then USD → native/token via payment feed.

### 5.6 Governance

All admin operations require **`upgradeAuthority`** (Timelock after handoff):

- `setCurrencyFeed` / `revokeCurrencyFeed`
- `approvePaymentToken` / `revokePaymentToken`
- `setPaused` — blocks list/buy when true
- `transferUpgradeAuthority`
- UUPS `_authorizeUpgrade`

Deployer registers genesis currencies **before** transferring authority to timelock (`deploy-v2.ts` steps 8–10).

### 5.7 MarketplaceEscrow — function reference

| Function | Access | Behavior |
|----------|--------|----------|
| `initialize` | once | Set initial `upgradeAuthority` |
| `isListed` | view | Listing active flag |
| `transferUpgradeAuthority` | upgradeAuthority | Hand off governance |
| `setCurrencyFeed` / `revokeCurrencyFeed` | upgradeAuthority | Fiat registry |
| `approvePaymentToken` / `revokePaymentToken` | upgradeAuthority | Checkout tokens |
| `setPaused` | upgradeAuthority | Global pause |
| `authorizeAgent` | owner | Agent authorization |
| `revokeAgent` | owner | Revoke when not listed |
| `list` | seller | Direct listing |
| `listOnBehalf` | agent | Consignment listing |
| `updateListing` | agent | Price + agent fee update |
| `updateOwnerMinPrice` | seller | Lower owner minimum |
| `requestReturn` | seller | Start return cooldown |
| `agentDelist` | agent | Agent-initiated return |
| `forceReturn` | seller | Post-cooldown return |
| `delist` | seller | Direct delist |
| `buyWithNative` | buyer | Native payment settlement |
| `buyWithToken` | buyer | ERC-20 payment settlement |
| `setSettlementNote` | seller | External payment instructions |
| `confirmExternalPayment` | seller | Attest external payment sale |
| `listingUsd1e8` | view | USD-normalized list price |
| `quoteBuyWithNative` | view | Native quote |
| `quoteBuyWithToken` | view | Token quote |
| `onERC721Received` | — | IERC721Receiver hook |

Public mappings: `listings`, `agentAuthorizations`, `returnRequestedAt`, `settlementNotes`, `currencyFeeds`, `paymentTokens`, `upgradeAuthority`, `paused`.

### 5.8 MarketplaceEscrow — error reference

| Error | When |
|-------|------|
| `NotSeller` | Seller-only guard |
| `NotAgent` | Agent-only guard |
| `NotOwner` | Token owner guard |
| `NotActive` | Listing inactive **or already listed** (see §5.2) |
| `AlreadyListed` | Authorize while listed |
| `BadPrice` | Zero price |
| `FeeTooHigh` | Platform fee over cap |
| `AgentFeeTooHigh` | Agent fee > 30% |
| `TransferFailed` | ETH send failed |
| `StalePrice` | Oracle older than `maxFeedStaleness` |
| `BadOracleAnswer` | Non-positive feed answer |
| `ZeroTimelock` | Invalid timelock in init |
| `NotUpgradeAuthority` | Admin op from wrong caller |
| `CurrencyNotAvailableOnChain` | Unregistered currency |
| `InvalidFeed` / `InvalidFeedDecimals` | Feed validation failed |
| `BelowOwnerMinPrice` | Net to seller below minimum |
| `AgentNotAuthorized` | Missing/expired agent auth |
| `AgentAuthorizationActive` | Revoke while listed |
| `MarketplaceNotApproved` | No marketplace approval |
| `ReturnNotRequested` | `forceReturn` without request |
| `ReturnAlreadyRequested` | Duplicate return request |
| `ReturnCooldownPending` | `forceReturn` too early |
| `EmptySettlementNote` | External confirm without note |
| `PaymentTokenNotSupported` | Token not approved |
| `ContractPaused` | Pause active |
| `DirectEthNotAccepted` | Wrong payment path |
| `CannotRaiseMinPrice` | Owner min increase blocked |
| `ListingHasAgent` | Direct seller op on agent listing |

---

## 6. Timelock48h v1.0.0

OpenZeppelin `TimelockController` with fixed **`MIN_DELAY_SECONDS = 48 hours`**.

| Role | Purpose |
|------|---------|
| Proposer | Schedule operations |
| Executor | Execute after delay |
| Admin | Optional; renounce after setup (`address(0)` in constructor to skip) |

Used as **`MarketplaceEscrow.upgradeAuthority`** after deploy step 10. KarPassport / KarProPass / KarProStaking remain immutable — timelock governs marketplace upgrades and feed registry only.

---

## 7. Bridge architecture

### 7.1 Design decisions

- **Lock-and-mint** on hub (adapter locks underlying KarPassport); **mint/burn** on spoke (`KarPassportONFT721`).
- KarPassport core contract stays bridge-agnostic; bridge is external adapter + spoke ONFT.
- Destination mint: status **UNVERIFIED** (trust not ported); `tokenURI` carried in LZ message extension.
- **Never wire testnet EIDs to mainnet EIDs** in `setPeer`.

### 7.2 ProxyONFT721Adapter v1.0.0 (hub)

- Wraps existing KarPassport ERC-721.
- `_debit`: reverts **`ListedInMarketplace`** if `marketplace.isListed(tokenId)`.
- `_buildMsgAndOptions`: embeds `tokenURI(tokenId)` as `abi.encode(string)` compose payload.

### 7.3 KarPassportONFT721 v1.0.0 (spoke)

- Standalone ONFT ERC-721 on destination chain.
- `_lzReceive`: mint to recipient; decode URI from compose extension; emit `ONFTReceived`.
- `_debit`: burn on outbound bridge.

### 7.4 LayerZero EndpointV2 — testnet EIDs

| Network | chainId | EID |
|---------|---------|-----|
| Base Sepolia | 84532 | 40245 |
| Ethereum Sepolia | 11155111 | 40161 |
| Polygon Amoy | 80002 | 40267 |

EndpointV2 (testnet): `0x6EDCE65403992e310A62460808c4b910D972f10f` (`scripts/lib/chainlink-feeds.ts`).

### 7.5 Bridge flow (step by step)

1. **Preconditions:** Passport not listed; user owns token on hub; LZ peers configured (testnet↔testnet only).
2. **Hub:** User calls ONFT send via `ProxyONFT721Adapter` → `_debit` locks NFT in adapter; message includes tokenId + URI.
3. **LayerZero:** Message delivered to spoke endpoint.
4. **Spoke:** `KarPassportONFT721._lzReceive` mints same tokenId to recipient; sets URI from payload; status UNVERIFIED on spoke (no KarPassport status mapping on ONFT — fresh mint).
5. **Return path:** Burn on spoke, unlock/mint on hub per ONFT721 standard debit/credit pairing.

---

## 8. Security model

### Non-custodial properties

- Marketplace holds NFTs only during active listings; payments settle atomically in `_settleNative` / `_settleErc20`.
- KarProStaking locks user stake; owner cannot drain verifier stakes.
- Platform does not hold user keys; `platformRecipient` receives fee slice only.

### Dispute deposit economics

Default **0.01 ETH** bond on `disputePassport` reduces frivolous disputes. Confirm → opener compensated; Reject → resolver compensated (incentivizes resolution).

### Accepted risks (audit + design)

| Risk | Mitigation / acceptance |
|------|-------------------------|
| **`platformRecipient` immutable** | Wrong address at deploy is permanent; verify before deploy |
| **Reverting seller** | Seller contract wallet can block ETH payout; document for buyers |
| **Agent fee front-run** | Agent may change fee between quote and buy; `ownerMinPrice` protects seller net; buyers should quote immediately before purchase |
| **Oracle staleness** | `maxFeedStaleness` (default 3600s); stale feeds revert buys |
| **External payment trust** | `confirmExternalPayment` is seller attestation — no on-chain payment proof |
| **`verificationFee`** | Off-chain honor system only |
| **Bridge trust** | LayerZero + ONFT config; misconfigured peers are operational risk |

### Permanent invariants

- **`CannotSelfVerify`:** verifier cannot verify own passport.
- **`CannotResolveSelfDispute`:** opener cannot resolve own dispute (v1.2.0).

---

## 9. Multi-chain deployment matrix

| Network | chainId | tokenIdOffset | Initial currencies (config) | Status |
|---------|---------|---------------|------------------------------|--------|
| Base Sepolia | 84532 | `84532 << 128` | USD | v2 deployed June 27, 2026 — see [§9.1](#91-base-sepolia-84532-v2) |
| Ethereum Sepolia | 11155111 | `11155111 << 128` | USD, EUR, GBP, JPY | Planned |
| Polygon Amoy | 80002 | `80002 << 128` | USD | Planned |
| Base | 8453 | `8453 << 128` | USD, EUR, GBP, CAD, AUD | Planned mainnet |
| Ethereum | 1 | `1 << 128` | TBD feeds | Planned |
| Polygon | 137 | `137 << 128` | TBD feeds | Planned |

Live v1.1 stack on Base Sepolia remains at historical addresses ([passport-v1.1-spec.md §13](./passport-v1.1-spec.md)). v2 cutover June 27, 2026.

### 9.1 Base Sepolia (84532) v2

Deployed June 27, 2026 · `indexFromBlock`: 43399242 · manifest: `deployments/84532.json` (local, gitignored)

| Contract | Address |
|----------|---------|
| Timelock48h | `0x9319e223ff31c954A940b14F04025B56A53ED384` |
| KarProPass (reused) | `0x8e4dcb5C0b415d6c2481D72dFac6da32d9cf22C1` |
| KarProStaking v2 | `0xb5d79551BB11F726D2A1A110BAc645C4345dA568` |
| KarPassport v2 | `0x2C46B2310E2cb09b0FEeDd174D9CD3870137F594` |
| MarketplaceEscrow impl | `0x58d5e740B29Ab549fBD4d0A147fcDedc32E0b6a3` |
| MarketplaceEscrow proxy | `0x9411Af4C4Ec26D939fb1AD04362456Cb41616c19` |
| ProxyONFT721Adapter | `0x59779D666747AEeDB0d9cc843cB8a68B8ab2470c` |
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Native USD feed | `0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1` |
| LayerZero endpoint v2 | `0x6EDCE65403992e310A62460808c4b910D972f10f` |

**Parameters:** `disputeDeposit` 0.01 ETH · `platformFeeBps` 10 · `upgradeAuthority` Timelock48h · USD-only currency registry · USDC payment token enabled.

---

## 10. Deploy sequence

Per new chain (matches `scripts/deploy-v2.ts`; Base Sepolia reuses existing **KarProPass**):

1. Deploy **Timelock48h** (proposer, executor, admin — typically deployer).
2. Deploy **KarProPass** (skip if reusing existing pass, as on 84532).
3. Deploy **KarProStaking** (pass address + owner).
4. **`KarProPass.setStaking(staking)`**.
5. Deploy **KarPassport** (staking, owner, `disputeDeposit` — e.g. 0.01 ETH).
6. Deploy **MarketplaceEscrow** implementation (passport, USDC, native USD feed, staking, platform recipient, fees, staleness).
7. Deploy **ERC1967Proxy** → `initialize(upgradeAuthority)` (deployer initially).
8. **Register currencies** — `setCurrencyFeed` for each live feed from `CHAINLINK_FEEDS` (deployer as authority).
9. **Register USDC** — `approvePaymentToken(usdc, address(0))` for USD-pegged 1:1 checkout.
10. **`transferUpgradeAuthority(timelock)`**.
11. Deploy **ProxyONFT721Adapter** (passport, marketplace proxy, LZ endpoint, delegate).
12. **Configure LayerZero peers** — testnet EIDs to testnet only; mainnet to mainnet only.

Write `deployments/<chainId>.json` with `generation: "v2"`, `tokenIdOffset`, `contractVersions`, `indexFromBlock`.

---

## 11. Version policy

Verbatim from contract headers:

```
// Version policy:
//   PATCH (Z): bug fixes that do not change ABI or storage layout
//   MINOR (Y): new functions added, backward compatible
//   MAJOR (X): breaking ABI changes, storage layout changes,
//               or fundamental behavior change
//   Pre-release: -rc.N for release candidates, remove on mainnet deploy
//   Immutable contracts (KarPassport, KarProPass, KarProStaking):
//     any change = new deployment = bump MINOR or MAJOR
//   Upgradeable contracts (MarketplaceEscrow):
//     UUPS upgrade = bump MINOR or MAJOR depending on scope
```

---

## 12. Differences from v1.x

| Feature | v1.x | v2 |
|---------|------|-----|
| Listing currency | `enum FiatCurrency { USD, EUR }` | `bytes32 currencyCode` + feed registry |
| EUR on Base Sepolia | Hardcoded `eurUsdFeed` in constructor | Dynamic `setCurrencyFeed`; 84532 deploy registers USD only |
| Agent sales | None | Full consignment model + fee split |
| External payment | None | Settlement note + seller confirm |
| NATIVE-priced listings | None | `CURRENCY_NATIVE` direct amount |
| Multi-token pay | ETH + USDC | Native + any approved ERC-20 |
| Marketplace admin | Deployer EOA | Timelock48h |
| Dispute withdraw | Off-chain convention (`reportDiscrepancy`) | On-chain `withdrawDispute` + deposit refund |
| Dispute resolve | `resolveDispute(bool uphold)` | `DisputeOutcome` enum + deposit routing |
| Self-resolve guard | None | `CannotResolveSelfDispute` |
| tokenId | Sequential | Chain-prefixed (`chainId << 128`) |
| Verifier fee signal | None | `verificationFee` |
| Bridge | None | ONFT adapter + spoke ONFT |
| Sale event | `fee`, `payAsset` enum | `platformFee`, `agentFee`, `payToken` address, `agent` |

---

*Last updated: June 2026 — v2 documentation pass; contracts at 238 Hardhat tests, not yet deployed to 84532.*
