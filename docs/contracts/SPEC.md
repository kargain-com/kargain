# Kargain smart contracts — specification

**Single public specification** for all on-chain contract behavior, deployments, and metadata wire formats.

| Read this if you need… | Section |
|------------------------|---------|
| Current stack (generation v2) | [Part I](#part-i--generation-v2-current) |
| Historical v1.x behavior | [Part II](#part-ii--generation-v1x-historical-reference) |
| Passport JSON (`tokenURI`) | [Part III](#part-iii--metadata-wire-format) |
| v1 → v2 migration summary | [Part IV](#part-iv--migration-reference-v1--generation-v2) |
| Semver / `-rc.N` policy | [Part V](#part-v--version-policy) |
| Local E2E & tests | [Appendix](#appendix-a--local-e2e-hardhat-31337) |

**Related (not in this file):** UI → [design-spec.md](../design-spec.md) · Indexer → [indexer/README.md](../indexer/README.md) · Deploy ops → [ops/deploys/84532-v2.md](../ops/deploys/84532-v2.md)

**Address tables (single source within this document):**

| Generation | Section |
|------------|---------|
| v2 active (84532) | [Part I.9.1](#i91-active-deployment-base-sepolia-84532) |
| v1.x historical (84532) | [Part II.4](#ii4-historical-deployment-base-sepolia-84532) |

## Part 0 — Conventions

### Versioning glossary

| Term | Meaning | Examples |
|------|---------|----------|
| **Generation v2** | New contract **stack** vs v1/v1.1 | `generation: "v2"`, `deploy.ts` |
| **Semver (`VERSION`)** | Per-contract release identity | KarPassport `1.2.0-rc.1`, MarketplaceEscrow `2.0.0-rc.1` |
| **`-rc.N`** | Release candidate on testnet; drop suffix on mainnet | `-rc.1` on Base Sepolia today |
| **Not Kargain v2** | Third-party names | LayerZero **EndpointV2** |

**Rule:** Use **generation v2** for stack/migration. Use **`X.Y.Z-rc.N`** for on-chain compatibility. Only **MarketplaceEscrow** has semver major **2**; KarPassport is **1.2.0-rc.1**.

---

# Part I — Generation v2 (current)

### I.1. Overview and version matrix

### Contract family

| Contract | VERSION constant | Upgrade model | Role |
|----------|------------------|---------------|------|
| KarPassport | `1.2.0-rc.1` | Immutable | Vehicle passport ERC-721, verification lifecycle, dispute deposits |
| KarProPass | `1.0.0-rc.1` | Immutable | Soulbound verifier credential (one per wallet) |
| KarProStaking | `1.1.0-rc.1` | Immutable | Verifier stake + `isActiveVerifier` |
| MarketplaceEscrow | `2.0.0-rc.1` | UUPS proxy | Listing escrow, dynamic fiat currencies, agent consignment |
| AuctionEscrow | `1.0.1-draft` | UUPS proxy | English reserve auction escrow, settlement hold (84532 live impl/proxy still `1.0.0-draft` until Timelock UUPS upgrade) |
| Timelock48h | `1.0.0-rc.1` | Immutable | 48h governance for MarketplaceEscrow |
| ProxyONFT721Adapter | `1.0.0-rc.1` | Immutable | Hub-chain lock-and-bridge adapter |
| KarPassportONFT721 | `1.0.0-rc.1` | Immutable | Spoke-chain mint/burn ONFT |

Source of truth for VERSION strings: `scripts/lib/contract-versions.ts` (must match Solidity `VERSION` constants).

### v1.x → generation v2 summary

| Area | v1.x | Generation v2 |
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
| `scripts/deploy.ts` (production deploy) | `10` (0.1%) | Intended testnet/mainnet default |
| `scripts/lib/local-stack.ts` (Hardhat tests) | `250` (2.5%) | Test-only; not deploy default |

---

### I.2. KarPassport v1.2.0

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

| Parameter | Default (deploy.ts) | Admin |
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

- **`setPassportURI` (verification reset policy):** from VERIFIED, a new metadata URI emits `VerificationReset` → UNVERIFIED; from DISPUTED → revert; same URI → `SameURI`.
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
| `setPassportURI` | token owner | Metadata URI update; resets verification when status is VERIFIED (see Part III § anchor vs cosmetic) |
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

### I.3. KarProPass v1.0.0

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

### I.4. KarProStaking v1.1.0

- **`isActiveVerifier(address)`** — single source of truth (active stake record).
- **`becomeVerifierNative`** / **`becomeVerifierToken`** — permissionless join; mints KarProPass.
- **`leave()`** — full stake refund; **no slashing**; `proPass.burn` wrapped in try/catch so stake always returns.
- **`minStakeNative`** — default `0.05 ether`; owner adjustable but **`MIN_STAKE_FLOOR = 0.001 ether`** minimum.
- **`verificationFee`** — verifier-set wei amount; **informational only** (no on-chain payment enforcement on KarProStaking). The Kargain `/kar-pro` UI composes service margin (nav display currency) plus an estimated `verifyPassport` gas cost at save time and writes the sum as a single wei value via `setVerificationFee`. Accepted off-chain payment methods are signaled in Nostr kind 0 as optional `verifierPaymentMethods` (`eth`, `usdc`, `lightning`; absent = all three). Workflow: verifier sets fee → passport owner may pay the verifier directly (Kargain UI supports native ETH with an on-chain memo, USDC `transfer`, or a Lightning payment resolved from the verifier's Nostr kind 0 `lud16` — none escrowed or enforced by contracts) → verifier calls `verifyPassport` after inspection.

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

### I.5. MarketplaceEscrow (`2.0.0-rc.1`)

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

Deployer registers genesis currencies **before** transferring authority to timelock (`deploy.ts` steps 8–10).

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

### I.6. Timelock48h v1.0.0

OpenZeppelin `TimelockController` with fixed **`MIN_DELAY_SECONDS = 48 hours`**.

| Role | Purpose |
|------|---------|
| Proposer | Schedule operations |
| Executor | Execute after delay |
| Admin | Optional; renounce after setup (`address(0)` in constructor to skip) |

Used as **`MarketplaceEscrow.upgradeAuthority`** after deploy step 10. KarPassport / KarProPass / KarProStaking remain immutable — timelock governs marketplace upgrades and feed registry only.

---

### I.7. Bridge architecture

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

### I.8. Security model

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
| **`verificationFee`** | Informational on-chain signal only — no escrow or payment enforcement; Kargain UI may facilitate direct owner→verifier ETH (memo) or USDC transfer |
| **Bridge trust** | LayerZero + ONFT config; misconfigured peers are operational risk |

### Permanent invariants

- **`CannotSelfVerify`:** verifier cannot verify own passport.
- **`CannotResolveSelfDispute`:** opener cannot resolve own dispute (v1.2.0).

---

### I.9. Multi-chain deployment matrix

| Network | chainId | tokenIdOffset | Initial currencies (config) | Status |
|---------|---------|---------------|------------------------------|--------|
| Base Sepolia | 84532 | `84532 << 128` | USD | Deployed (RC) — [I.9.1](#i91-active-deployment-base-sepolia-84532) |
| Ethereum Sepolia | 11155111 | `11155111 << 128` | USD, EUR, GBP, JPY | Planned |
| Polygon Amoy | 80002 | `80002 << 128` | USD | Planned |
| Base | 8453 | `8453 << 128` | USD, EUR, GBP, CAD, AUD | Planned mainnet |
| Ethereum | 1 | `1 << 128` | TBD feeds | Planned |
| Polygon | 137 | `137 << 128` | TBD feeds | Planned |

Historical v1.x addresses: [Part II.4](#ii4-historical-deployment-base-sepolia-84532). Generation v2 cutover June 27, 2026; production Ponder indexes v2 from block **43399242** (June 2026).

### I.9.1 Active deployment (Base Sepolia 84532)

> **Single source of truth** for active 84532 contract addresses and semver. Other docs link here.

Deployed June 27, 2026 · semver **`-rc.1`** on testnet · `indexFromBlock`: **43399242** · manifest: `deployments/84532.json` (not in git) · git commit: `c88b5dc`

| Contract | VERSION | Address | Basescan |
|----------|---------|---------|----------|
| Timelock48h | `1.0.0-rc.1` | `0x9319e223ff31c954A940b14F04025B56A53ED384` | [code](https://sepolia.basescan.org/address/0x9319e223ff31c954A940b14F04025B56A53ED384#code) |
| KarProPass (reused) | `1.0.0-rc.1` | `0x8e4dcb5C0b415d6c2481D72dFac6da32d9cf22C1` | [code](https://sepolia.basescan.org/address/0x8e4dcb5C0b415d6c2481D72dFac6da32d9cf22C1) |
| KarProStaking | `1.1.0-rc.1` | `0xb5d79551BB11F726D2A1A110BAc645C4345dA568` | [code](https://sepolia.basescan.org/address/0xb5d79551BB11F726D2A1A110BAc645C4345dA568#code) |
| KarPassport | `1.2.0-rc.1` | `0x2C46B2310E2cb09b0FEeDd174D9CD3870137F594` | [code](https://sepolia.basescan.org/address/0x2C46B2310E2cb09b0FEeDd174D9CD3870137F594#code) |
| MarketplaceEscrow impl | `2.0.0-rc.1` | `0x58d5e740B29Ab549fBD4d0A147fcDedc32E0b6a3` | [code](https://sepolia.basescan.org/address/0x58d5e740B29Ab549fBD4d0A147fcDedc32E0b6a3#code) |
| MarketplaceEscrow proxy | `2.0.0-rc.1` | `0x9411Af4C4Ec26D939fb1AD04362456Cb41616c19` | [code](https://sepolia.basescan.org/address/0x9411Af4C4Ec26D939fb1AD04362456Cb41616c19#code) |
| AuctionEscrow impl | `1.0.0-draft` | `0x8e87749CE61569ACFc60058fFAc2122A97466c5A` | [code](https://sepolia.basescan.org/address/0x8e87749CE61569ACFc60058fFAc2122A97466c5A#code) |
| AuctionEscrow proxy | `1.0.0-draft` | `0xB13D264368C8cbcc8EC973D1E5DDBa435eA458Ce` | [code](https://sepolia.basescan.org/address/0xB13D264368C8cbcc8EC973D1E5DDBa435eA458Ce#code) |
| ProxyONFT721Adapter | `1.0.0-rc.1` | `0x59779D666747AEeDB0d9cc843cB8a68B8ab2470c` | [code](https://sepolia.basescan.org/address/0x59779D666747AEeDB0d9cc843cB8a68B8ab2470c#code) |
| USDC | — | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | [token](https://sepolia.basescan.org/address/0x036CbD53842c5426634e7929541eC2318f3dCF7e) |
| Native USD feed | — | `0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1` | [feed](https://sepolia.basescan.org/address/0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1) |
| LayerZero EndpointV2 | — | `0x6EDCE65403992e310A62460808c4b910D972f10f` | [contract](https://sepolia.basescan.org/address/0x6EDCE65403992e310A62460808c4b910D972f10f) |

**Parameters:** `disputeDeposit` 0.01 ETH · `platformFeeBps` 10 · `minStakeNative` 0.05 ETH · `upgradeAuthority` Timelock48h · USD-only currency registry · USDC payment token enabled · `platformRecipient` `0xcfe194fea9727bD04dA8F78c2362680986e02dF1`

**Ops:** `pnpm smoke:sepolia` · `pnpm verify:sepolia` · `pnpm ponder:config` · deploy record: [ops/deploys/84532-v2.md](../ops/deploys/84532-v2.md) · AuctionEscrow additive: [ops/deploys/84532-auction.md](../ops/deploys/84532-auction.md)

**AuctionEscrow behavior:** [Part I.11](#i11-auctionescrow-101-draft). Additive deploy record: [ops/deploys/84532-auction.md](../ops/deploys/84532-auction.md).

---

### I.10. Deploy sequence

Per new chain (matches `scripts/deploy.ts`; Base Sepolia reuses existing **KarProPass**):

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

**AuctionEscrow** is additive (`pnpm deploy:auction`) — not part of this sequence. Addresses: [I.9.1](#i91-active-deployment-base-sepolia-84532). Behavior: [I.11](#i11-auctionescrow-101-draft).

---

### I.11. AuctionEscrow (`1.0.1-draft`)

UUPS-upgradeable English reserve auction escrow with settlement hold. **`upgradeAuthority`** = Timelock48h (same v2 handoff convention as MarketplaceEscrow). One auction per `tokenId` (`auctions[tokenId]`). **Addresses:** [I.9.1](#i91-active-deployment-base-sepolia-84532). **UI:** [design-spec.md](../design-spec.md) §4.18. **Indexer:** [indexer/MIGRATION-AUCTION.md](../indexer/MIGRATION-AUCTION.md). Design rationale: [auction-design.md](../research/auction-design.md) §1–§10.

### 11.1 Role gates and Phase A scope

| Gate | Rule |
|------|------|
| Direct seller | Token owner **and** `isActiveVerifier(msg.sender)` to `createAuction` |
| Agent create | Auth’d agent **and** `isActiveVerifier(agent)` for `createAuctionOnBehalf`; private owners use the agent funnel |
| Passport | `passportStatus == VERIFIED` required for create, bid, and settle; `DISPUTED` blocks bidding (`PassportDisputed`) |
| Bid ban | Seller and agent cannot bid (`BidFromSeller` / `BidFromAgent`) |
| Assets | Native (`asset = address(0)`) or USDC only — **no oracles** on any path |

### 11.2 Constructor (immutable deps)

| Param | Role |
|-------|------|
| `karPassport_` | NFT custody + `passportStatus` reads |
| `usdc_` | Only ERC-20 bid asset in Phase A |
| `wrappedNative_` | WETH fallback for native refund/payout griefing immunity (Base: `0x4200…0006`) |
| `karProStaking_` | `isActiveVerifier` for seller/agent admission and dispute resolvers |
| `platformRecipient_` | Platform fee recipient |
| `feeBps_` | Immutable `platformFeeBps`; cap `_MAX_FEE_BPS` = 1000 |

Constructor / `initialize` reject zero addresses via **`ZeroAddress`**. Proxy `initialize(timelock)` sets upgrade authority and default config (§11.3).

### 11.3 Config (upgradeAuthority-settable, evented)

| Param | Default | Bounds | Note |
|-------|---------|--------|------|
| `extensionWindow` | 300 s (5 min) | 60–3600 s | Applied at next bid only — never rewrites running auctions retroactively |
| `minIncrementBps` | 300 (3%) | 100–1000 | |
| `minDuration` / `maxDuration` | 3 d / 7 d | `min ≤ max` | |
| `settlementHold` | 7 d | `> 0` | |
| `settlementDisputeBond` | 0.01 ETH | `> 0` | **Native-fixed**, including for USDC auctions (aligned with KarPassport `disputeDeposit`) |
| `disputeResolutionTimeout` | 30 d | `> 0` | Unresolved settlement dispute → auto-`ReleaseToSeller` via `releaseFunds`; bond → `platformRecipient` |
| `disputeGracePeriod` | 30 d | `> 0` | Void path when passport stuck non-VERIFIED after end |

No total-extension cap in Phase A (`BadConfig` on setter bound violations). Config changes never mutate in-flight auction terms.

### 11.4 Storage

```
struct Auction {
    address seller;        // title owner — NFT only ever returns to them
    address agent;         // address(0) = direct KarPro-seller auction
    uint16  agentFeeBps;   // frozen at creation; cap 3000
    address asset;         // address(0) = native; else usdc
    uint128 reserve;       // asset units; > 0; public
    uint128 ownerMinAsset; // agent auctions; asset units
    uint40  duration;
    uint40  startedAt;     // 0 until first bid ≥ reserve
    uint40  endsAt;
    address highestBidder;
    uint128 highestBid;
    bool    active;
}

struct SettlementHold {
    address buyer;
    uint128 gross;
    uint40  releaseAt;
    uint40  disputedAt;      // 0 = no dispute
    uint128 bond;
    uint40  refundPendingAt; // set by ConfirmFailure
}

struct AuctionAgentAuth {
    address agent;
    uint64  expiry;
    address asset;
    uint128 ownerMinAsset;
    bool    active;
}

mapping(uint256 => Auction) auctions;
mapping(uint256 => SettlementHold) holds;
mapping(uint256 => AuctionAgentAuth) auctionAgentAuthorizations;
mapping(uint256 => uint256) returnRequestedAt;
```

**Derived lifecycle** (no enum in storage): `None` → `Open` (active, `startedAt = 0`) → `Live` → `Ended` → `Hold` (`holds[id].releaseAt > 0`) → `Closed`.

### 11.5 Agent semantics

Marketplace recall boundary is preserved: the **first qualifying bid** commits the sale; owner return cannot override a live or settled auction ([auction-design.md](../research/auction-design.md) §10.2).

| Rule | Behavior |
|------|----------|
| `ownerMinAsset` | Denominated in the auction **asset** (closes marketplace currency-unbound min debt for auctions) |
| Create invariant | `reserve − fees(reserve) ≥ ownerMinAsset` else `BelowOwnerMinAsset` |
| Terms snapshot | Auth `asset` / `ownerMinAsset` / `agentFeeBps` frozen into `Auction` at `createAuctionOnBehalf` — no mid-auction `updateListing` analog |
| `requestReturn` | Owner, only `startedAt == 0`; starts 7-day cooldown; **does not block bids** |
| `forceReturn` | Owner, post-cooldown + still no start; cancels auction, NFT → owner |
| `revokeAuctionAgent` | Owner only with no active auction |

### 11.6 Funds movement

- **Outbid refund (native):** `call{gas: 30_000}`; on failure wrap into `wrappedNative` + `transfer` (Nouns-style fallback). USDC: `safeTransfer`.
- **Payout** (confirm / auto-release / `ReleaseToSeller`): `agentFee` → agent, `platformFee` → `platformRecipient`, remainder → seller. Native legs use the same WETH fallback.
- CEI: state writes before external transfers; `nonReentrant` on mutating entry points.

### 11.7 Settlement hold and dispute lifecycle

1. Permissionless **`settle`**: `now ≥ endsAt`, bid exists, passport VERIFIED → NFT to highest bidder; funds into `SettlementHold(releaseAt = now + settlementHold)`.
2. Buyer **`confirmReceipt`** before `releaseAt` (no open dispute) → immediate payout.
3. Permissionless **`releaseFunds`**: after `releaseAt` with no dispute, **or** after `disputedAt + disputeResolutionTimeout` with no resolution (auto-`ReleaseToSeller`; bond → platform).
4. Buyer **`openSettlementDispute`**: before `releaseAt`; `msg.value ≥ settlementDisputeBond` (native always); freezes release.
5. Active verifier **`resolveSettlementDispute`** (≠ buyer/seller/agent): `ReleaseToSeller` → payout + bond to resolver; `ConfirmFailure` → `refundPendingAt = now`.
6. Buyer **`returnPassportAndRefund`**: reverse swap NFT → seller, `gross + bond` → buyer.
7. Seller **`claimAbandonedRefund`**: after ConfirmFailure if buyer never returns NFT within `settlementHold` → payout to seller.

**H-1 guard:** `createAuction`, `authorizeAuctionAgent`, and `createAuctionOnBehalf` revert **`SettlementPending`** while `holds[tokenId].releaseAt != 0`. Hold is deleted on every terminal payout/refund path so the token is auctionable again after settlement clears.

**Pause:** blocks `createAuction*`, `authorizeAuctionAgent`, and `bid`; **never** settle / void / release / refund paths.

### 11.8 Liveness invariants

| Stuck state | Exit |
|-------------|------|
| Nobody calls settle | Permissionless `settle` |
| Passport DISPUTED at `endsAt` | Settle deferred; passport resolve → settle, or ConfirmDispute → `voidAuction` |
| DISPUTED stuck | `voidAuction` after `endsAt + disputeGracePeriod` |
| Buyer silent through hold | Permissionless `releaseFunds` |
| Settlement dispute never resolved | Auto-`ReleaseToSeller` via `releaseFunds`; bond → platform |
| ConfirmFailure, buyer never returns NFT | `claimAbandonedRefund` after timeout |
| Pause | Never blocks settle / void / release / refund |

### 11.9 AuctionEscrow — function reference

| Function | Access | Behavior |
|----------|--------|----------|
| `createAuction(tokenId, asset, reserve, duration)` | Owner + active verifier | VERIFIED passport; asset ∈ {0, USDC}; NFT → escrow; `SettlementPending` / pause gated |
| `authorizeAuctionAgent(tokenId, agent, expiry, asset, ownerMinAsset)` | Owner | Approval required; no active auction; pause + `SettlementPending` gated |
| `revokeAuctionAgent(tokenId)` | Owner | No active auction |
| `createAuctionOnBehalf(tokenId, asset, reserve, duration, agentFeeBps)` | Agent + active verifier | Auth snapshot; net ≥ `ownerMinAsset`; pause + `SettlementPending` gated |
| `bid(tokenId, amount)` payable | Not seller/agent | VERIFIED only; first bid ≥ reserve starts clock; then min increment; extension window; prior bid refunded |
| `cancelAuction` / `agentCancelAuction` | Seller / agent | Only `startedAt == 0`; NFT → seller |
| `requestReturn` / `forceReturn` | Owner | Pre-start only; force after cooldown |
| `settle(tokenId)` | **Permissionless** | End + bid + VERIFIED → NFT to buyer, funds to hold |
| `voidAuction(tokenId)` | **Permissionless** | UNVERIFIED anytime after start, or grace after end if not VERIFIED; refund highest + NFT → seller |
| `confirmReceipt(tokenId)` | Buyer | Before `releaseAt`, no dispute → payout |
| `releaseFunds(tokenId)` | **Permissionless** | Auto-release or dispute-timeout `ReleaseToSeller` |
| `openSettlementDispute(tokenId)` payable | Buyer | Native bond; freezes hold |
| `resolveSettlementDispute(tokenId, outcome)` | Active verifier ≠ parties | `ReleaseToSeller` or `ConfirmFailure` |
| `returnPassportAndRefund(tokenId)` | Buyer | After ConfirmFailure: reverse swap |
| `claimAbandonedRefund(tokenId)` | Seller | ConfirmFailure abandoned → payout to seller |
| `setPaused` / config setters / `transferUpgradeAuthority` / UUPS | Upgrade authority | v2 convention; setters emit events |

### 11.10 AuctionEscrow — error reference

| Error | When |
|-------|------|
| `NotSeller` / `NotAgent` / `NotOwner` / `NotBuyer` | Role guards |
| `NotActiveVerifier` | Seller/agent/resolver admission |
| `PassportNotVerified` / `PassportDisputed` | Status gates |
| `AuctionExists` / `NoAuction` | Mapping occupancy |
| `AuctionAlreadyStarted` | Cancel/return after first bid (Solidity: cannot share name with `event AuctionStarted`) |
| `AuctionNotStarted` / `AuctionNotEnded` / `AuctionEnded` | Lifecycle timing |
| `AuctionSettleable` | `voidAuction` when auction has ended and passport is VERIFIED — call `settle` instead |
| `SettlementPending` | Create/authorize while hold unresolved (H-1) |
| `BidTooLow` / `BidFromSeller` / `BidFromAgent` | Bid rules |
| `WrongAsset` / `WrongValue` / `UnsupportedAsset` | Asset/payment mismatch |
| `BadDuration` / `BadReserve` / `BadConfig` | Param validation |
| `BelowOwnerMinAsset` | Agent reserve net below owner min |
| `AgentNotAuthorized` / `AgentAuthorizationActive` / `EscrowNotApproved` | Auth/approval |
| `ReturnNotRequested` / `ReturnAlreadyRequested` / `ReturnCooldownPending` | Owner return flow |
| `HoldActive` / `NoHold` / `HoldReleased` / `DisputeActive` / `NoDispute` | Settlement hold/dispute |
| `BondTooLow` / `CannotResolveOwnDeal` / `RefundNotPending` | Dispute / refund paths |
| `TransferFailed` / `ContractPaused` / `NotUpgradeAuthority` | Infra |
| `FeeTooHigh` / `AgentFeeTooHigh` | Fee caps |
| `ZeroAddress` | Zero ctor/init/authority address |
| `DirectEthNotAccepted` | Unexpected ETH on non-payable path |

### 11.11 AuctionEscrow — event reference

`AuctionCreated` · `AuctionStarted` · `BidPlaced` · `BidRefunded` · `AuctionCancelled` · `ReturnRequested` · `ForceReturn` · `AuctionSettled` · `AuctionVoided` · `ReceiptConfirmed` · `FundsReleased` · `SettlementDisputeOpened` · `SettlementDisputeResolved` · `PassportReturnedAndRefunded` · `AbandonedRefundClaimed` · `AuctionAgentAuthorized` · `AuctionAgentRevoked` · config / `Paused` / `UpgradeAuthorityTransferred`.

Indexer tables and HTTP routes: [indexer/MIGRATION-AUCTION.md](../indexer/MIGRATION-AUCTION.md).

---

# Part II — Generation v1.x (historical reference)

> **Do not use for new integrations on Base Sepolia (84532).** Active addresses and behavior: [Part I](#part-i--generation-v2-current).

### II.1. Philosophy

- **Passport** = hybrid public fact registry + transferable ownership. **No burn.**
- **Trust state** (`status`, `verifier`, `verifiedAt`) — **on-chain only**.
- **Vehicle description** — extensible metadata JSON on Arweave (`tokenURI` pointer).
- **History** — append-only on-chain `records[]`.
- **Spam / trust** — transparency, not on-chain gates (no mint fee, no listing stake in v1.1).

### II.2. Status lifecycle

```
UNVERIFIED ──verifyPassport──► VERIFIED
     ▲                              │
     │                              │ disputePassport (anyone)
     │                              ▼
     │                          DISPUTED
     │                              │
     │              resolveDispute(uphold=true)  ──► VERIFIED
     │              resolveDispute(uphold=false) ──► UNVERIFIED
     │
     └── setPassportURI from VERIFIED ── VerificationReset ──► UNVERIFIED
```

**Exit from DISPUTED:** only `resolveDispute` (active verifier). Owner cannot edit metadata while DISPUTED.

### II.3. `setPassportURI` (verification reset policy)

| Current status | New URI | Result |
|----------------|---------|--------|
| UNVERIFIED | different | Update URI, no reset |
| UNVERIFIED | same | `revert SameURI()` |
| VERIFIED | different | `VerificationReset` → UNVERIFIED, update URI |
| VERIFIED | same | `revert SameURI()` (verification preserved) |
| DISPUTED | any | `revert InvalidStatus(DISPUTED)` |
| Listed (escrow owns NFT) | any | `revert NotOwner()` |

**Validation order:**

1. `_requireExists`
2. `NotOwner`
3. `EmptyField("uri")` if `newURI` empty
4. `InvalidStatus` if DISPUTED
5. `SameURI` if `keccak256(newURI) == keccak256(tokenURI(tokenId))`
6. If VERIFIED → reset status, verifier, verifiedAt; emit `VerificationReset`
7. `_setTokenURI` + `PassportURIUpdated`

**Artifacts:**

- `event VerificationReset(uint256 indexed tokenId, address indexed author)`
- `error SameURI()`

### II.4. Historical deployment (Base Sepolia 84532)

> **Superseded on 84532:** Active stack is [Part I.9.1](#i91-active-deployment-base-sepolia-84532). **Historical v1.x Sepolia addresses below.**

**Scope (partial):** new `KarPassport` + `MarketplaceEscrow` impl/proxy; **unchanged** `KarProPass` + `KarProStaking`.

| Contract | Address |
|----------|---------|
| KarProPass | `0x8e4dcb5C0b415d6c2481D72dFac6da32d9cf22C1` |
| KarProStaking | `0x2794015C00Da0FAf5D2451Ffba9FdD30F86dBC31` |
| KarPassport v1.1 | `0x6378469256907D7DC14BBfce0261ceDE22314507` |
| MarketplaceEscrow impl | `0x7d37e7cbcc42308264B608429a82D03B7C3112F4` |
| MarketplaceEscrow proxy | `0x4FC74e0B7eE0A741707A553D43Efff68126D198B` |

Deploy: addresses only — see [Part I.9.1](#i91-active-deployment-base-sepolia-84532). Historical v1.x partial redeploy (June 2026) is documented here; use `pnpm deploy:sepolia` for new stacks.

#### II.4.1 Governance roles (deployer vs timelock vs upgrade authority)

Three **distinct** concepts — do not conflate in config or UI:

| Role | What it is | Base Sepolia (84532) v1.1 redeploy | Localhost (31337) |
|------|------------|-----------------------------------|-------------------|
| **Deployer** | EOA that signed deploy txs | `0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77` | Hardhat account #0 |
| **upgradeAuthority** | `MarketplaceEscrow.upgradeAuthority` on-chain | **Same as deployer EOA** (v1 `initialize(deployer)`) | **TimelockController** address (`initialize(timelock)` in `local-stack.ts` / `deploy.ts`) |
| **TimelockController** | OpenZeppelin timelock contract (48h delay) | **Not deployed** | Deployed; address in `deployments/31337.json` → `timelock` |

**Config rules:**

- `lib/web3/deployment-addresses.ts` — **no** Sepolia fallback for `timelock`. Use `NEXT_PUBLIC_TIMELOCK_*` only when a TimelockController exists (local / future mainnet).
- `deployments/84532.json` — must record `deployer` and `upgradeAuthority` separately from any future `timelock` field.
- **Profiles / messaging** — never treat deployer or `upgradeAuthority` EOA as a protocol denylist entry; block contract accounts via bytecode (`lib/web3/wallet-account.ts`).

**Future mainnet / governance redeploy:** deploy `TimelockController`, call `initialize(timelockAddress)`, write `timelock` + `upgradeAuthority` to manifest; deployer EOA remains a normal user wallet.

**Chainlink price feeds** (immutable constructor args on MarketplaceEscrow impl):

| Feed | Address | Base Sepolia status (June 2026) |
|------|---------|--------------------------------|
| ETH/USD (`nativeUsdFeed`) | `0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1` | Live Chainlink aggregator |
| EUR/USD (`eurUsdFeed`) | `0xb49f677943BC038e9857d61E7d053CaA2C1734C1` | **Dead** — no contract bytecode at address |

UI display/filter: Chainlink + CoinGecko gap-fill via [`use-market-rates.ts`](../../lib/marketplace/use-market-rates.ts). On-chain `list`/`buy` for EUR listings calls `eurUsdFeed.latestRoundData()` and **reverts** until redeployed with a live feed. **Mainnet:** use official Base Chainlink proxy addresses; do not copy Sepolia EUR address.

**Basescan verify (one-time ops):**

```bash
# Requires ETHERSCAN_API_KEY (Etherscan v2, chainid=84532) in .env.local
pnpm verify:sepolia
```

Verifies the active stack from `deployments/84532.json`. Historical v1.x contracts may remain unverified on Basescan; addresses in table above.

**Status (June 2026):** KarPassport, MarketplaceEscrow impl, and proxy verified on [Base Sepolia Basescan](https://sepolia.basescan.org).

| Contract | Basescan |
|----------|----------|
| KarPassport v1.1 | https://sepolia.basescan.org/address/0x6378469256907D7DC14BBfce0261ceDE22314507 |
| MarketplaceEscrow impl | https://sepolia.basescan.org/address/0x7d37e7cbcc42308264B608429a82D03B7C3112F4 |
| MarketplaceEscrow proxy | https://sepolia.basescan.org/address/0x4FC74e0B7eE0A741707A553D43Efff68126D198B |

Run constructor-arg unit tests: `pnpm test:verify`.

Indexer env: [indexer/OPERATIONS.md](../indexer/OPERATIONS.md) · `pnpm ponder:config`

### II.5. Metadata vs records

| Layer | Contents | Resets verification? |
|-------|----------|----------------------|
| Metadata JSON | VIN, make, model, year, mileage, photos, type, colour, location, … | **Only** via `setPassportURI` from VERIFIED |
| `appendRecord` | service, clarifications, sale notes | **Never** |
| `reportDiscrepancy` | light discrepancy signal | **Never** |
| `disputePassport` | opens DISPUTED + discrepancy record | N/A (status → DISPUTED) |
| `appendAttestation` | verifier attestation | **Never** |

**Canonical for buyer:** current metadata + full record timeline.

**VIN:** field in JSON only; duplicates allowed on-chain.

### II.6. Dispute model

### On-chain

- `disputePassport` — heavy (VERIFIED → DISPUTED). Permissionless including self-dispute.
- `reportDiscrepancy` — light (record only, status unchanged).
- **Any active verifier** resolves DISPUTED via `resolveDispute(uphold)` (not limited to the verifier who originally verified the passport).

### D6 — Dispute withdraw (A+ convention, no extra contract fn)

Disputer withdraws **signal only**; status stays DISPUTED until verifier resolves.

1. Disputer calls `reportDiscrepancy(tokenId, "[dispute-withdrawn] <note>", evidenceCID)`.
2. On-chain `recordType` remains `"discrepancy"`.

### Owner during DISPUTED

- `appendRecord` for clarifications when owner holds NFT.
- **Not possible while listed** (escrow = owner).

### After `resolve(false)` → UNVERIFIED

Owner may `setPassportURI`, then request re-verification.

### II.7. Marketplace (unchanged in Phase 1)

- List UNVERIFIED / VERIFIED / DISPUTED — allowed on-chain.
- Escrow does not read passport status.
- No on-chain buy block in v1.1.

### II.8. Transfer

- Buyer inherits `passportStatus[tokenId]` — no auto-reset on sale (E5).

---

# Part III — Metadata wire format

**Write path (create / edit upload):** always emit `version: "1.1"` with **camelCase** keys. Stored at `ar://…`; on-chain `tokenURI` points to this JSON.

### Required / core fields

| Field | Type | Notes |
|-------|------|-------|
| `version` | `"1.1"` | Wire version for new uploads |
| `name` | string | Display title, e.g. `"2021 Honda Civic"` |
| `vin` | string | Normalized uppercase, 11–17 chars |
| `make`, `model` | string | Required |
| `year` | number | Integer |
| `mileageKm` | number | Non-negative; `0` if omitted in form |
| `photos` | string[] | Arweave URIs (`ar://…`); min 1 on create |
| `createdAt`, `updatedAt` | string | ISO-8601 timestamps |

### Optional v1.1 fields

Omit empty keys from JSON. Supported optional fields: `description`, `modelVariant`, `type`, `vehicleType`, `fuelType`, `bodyType`, `transmission`, `power`, `evBatteryKwh`, `colour`, `location` (`{ label?, lat?, lng? }`), `engine`, `features` (string[]), `condition`.

### Legacy v1.0 read compatibility

Existing on-chain passports may use:

- `version: "1.0"`
- `mileage_km` instead of `mileageKm`
- snake_case legacy keys: `fuel_type`, `body_type`, `color`, `created_at`
- Parser normalizes to app type `PassportMetadata` (camelCase) and preserves `version: "1.0" | "1.1"`.

### PII (J1)

Wire JSON must **not** include `ownerName`, `phone`, or `email`. Build path rejects these keys before upload.

### Anchor vs cosmetic (edit confirmation)

`diffPassportMetadata` classifies changes before calling `setPassportURI`:

- **Anchor:** `vin`, `make`, `model`, `year`, `type`, `photos`, and `mileageKm` when delta > **500 km**
- **Cosmetic:** description, colour, power, and other optional fields; small mileage updates (≤ 500 km)

From **VERIFIED**, any URI change that reaches the contract triggers `VerificationReset` (§3); anchor/cosmetic is a product guard before upload, not enforced on-chain.

Run metadata unit tests: `pnpm test:metadata` · records: `pnpm test:records`

---

# Part V — Version policy



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

---

# Part IV — Migration reference (v1 → generation v2)



| Feature | v1.x | Generation v2 |
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

*Last updated: June 27, 2026 — generation v2 deployed to Base Sepolia (84532) as `-rc.1` release candidates; 238 Hardhat tests.*

---

## Appendix A — Local E2E Local E2E (Phase 4)

Local dev stack on **Hardhat chain 31337** — full passport lifecycle before Phase 5 Sepolia redeploy.

### Dev stack

| Component | Command / artifact |
|-----------|-------------------|
| Hardhat node | `npx hardhat node` (:8545) |
| Deploy Model X | `pnpm deploy:local` → `deployments/31337.json` |
| Orchestration | `./scripts/dev-local.sh` |
| One-shot E2E | `./scripts/e2e-local.sh` |

### Env vars (local)

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_ENABLE_LOCAL_CHAIN=1` | Add chain 31337 to wagmi |
| `NEXT_PUBLIC_CHAIN_ID=31337` | Default UI chain |
| `NEXT_PUBLIC_RPC_BY_CHAIN` | Include `"31337":"http://127.0.0.1:8545"` |

Export addresses after deploy: `eval "$(node --import tsx scripts/lib/print-local-env.ts)"`

### E2E scenario (`pnpm test:e2e`)

Requires running Hardhat node + `pnpm deploy:local` (or use `./scripts/e2e-local.sh`).

| Step | Action | Assert |
|------|--------|--------|
| 1 | `becomeVerifierNative` | verifier active |
| 2 | `mintPassport` | UNVERIFIED, tokenId 0 |
| 3 | `verifyPassport` | VERIFIED |
| 4 | `setPassportURI` | `VerificationReset`, UNVERIFIED |
| 5 | `verifyPassport` | VERIFIED |
| 6 | `disputePassport` | DISPUTED |
| 7 | `resolveDispute(false)` | UNVERIFIED |
| 8 | `setPassportURI` | OK (T9) |
| 9 | re-verify, `list` + `buyWithNative` | buyer owns NFT, listing inactive |
| 10 | `appendRecord` on VERIFIED | status unchanged (T10) |

Run: `pnpm test:e2e` (sets `KARGAIN_E2E_LOCAL=1`) · `pnpm typecheck` · `pnpm hardhat test`

**Note:** `localhost` Hardhat network uses the node's default funded accounts, not `DEPLOYER_PRIVATE_KEY`.

## 14. Contract test coverage (June 2026)

| Criterion | Status |
|-----------|--------|
| T10 — `appendRecord` on VERIFIED leaves status unchanged | ✅ |
| E5 — buyer inherits status on transfer (no auto-reset) | ✅ |
| Listed passport — owner `appendRecord` reverts `NotOwner` | ✅ |
| Resolve gating — any active verifier (§5) | ✅ documented |
| README metadata reset policy | ✅ |

Contract tests: `pnpm hardhat test` · trust helpers: `pnpm test:trust` · Ponder handler unit tests (indexer): `pnpm test:ponder`

**Deferred (contract / product, Phase 6+):** on-chain evidence requirements for `reportDiscrepancy`. (`buyWithUsdc` UI shipped June 2026 — see AGENTS milestone.)

---

*Last updated: June 27, 2026 — generation v2 on Base Sepolia (84532), semver `-rc.1` on testnet.*
