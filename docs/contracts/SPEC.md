# Kargain smart contracts — specification

**Single public specification** for all on-chain contract behavior, deployments, and metadata wire formats.

| Read this if you need… | Section |
|------------------------|---------|
| Current stack (generation v2) | [Part I](#part-i--generation-v2-current) |
| Non-EVM commercial chains + parameter model | [§I.13](#i13-non-evm-commercial-chains-and-the-protocol-parameter-model-normative) |
| Historical v1.x behavior | [Part II](#part-ii--generation-v1x-historical-reference) |
| Passport JSON (`tokenURI`) | [Part III](#part-iii--metadata-wire-format) |
| v1 → v2 migration summary | [Part IV](#part-iv--migration-reference-v1--generation-v2) |
| Semver / `-rc.N` policy | [Part V](#part-v--version-policy) |
| Local E2E & tests | [Appendix](#appendix-a--local-e2e-hardhat-31337) |

**Related (not in this file):** UI → [design-spec.md](../design-spec.md) · Indexer → [indexer/README.md](../indexer/README.md) · Deploy ops → [ops/deploys/nuclear-4.md](../ops/deploys/nuclear-4.md)

**Address tables (single source within this document):**

| Generation | Section |
|------------|---------|
| Nuclear active (84532) | [Part I.9.1](#i91-active-deployment-base-sepolia-84532) |
| Nuclear full stack (11155111) | [Part I.9.2](#i92-active-deployment-ethereum-sepolia-11155111) |
| v1.x historical (84532) | [Part II.4](#ii4-historical-deployment-base-sepolia-84532) |

## Part 0 — Conventions

### Versioning glossary

| Term | Meaning | Examples |
|------|---------|----------|
| **Generation v2** | New contract **stack** vs v1/v1.1 | `generation: "v2"`, `deploy.ts` |
| Semver (`VERSION`) | Per-contract release identity | **Live (Nuclear #4):** KarPassport `1.10.0-rc.1`, FixedPriceConsignment `2.4.0-rc.1`, AscendingConsignment `2.4.0-rc.1` |
| **`-rc.N`** | Release candidate on testnet; drop suffix on mainnet | `-rc.1` on Base Sepolia today |
| **Not Kargain v2** | Third-party names | LayerZero **EndpointV2** |

**Rule:** Use **generation v2** for stack/migration. Use **`X.Y.Z-rc.N`** for on-chain compatibility.

**Amend-in-place while shipping a VERSION:** Source `VERSION` strings in `CONTRACT_VERSIONS` must match Solidity. **Nuclear #4** ship VERSIONS are **live** on I.9 (August 2, 2026). Further pre-deploy changes to an unshipped VERSION amend that string in place.

---

# Part I — Generation v2 (current)

### I.1. Overview and version matrix

### Contract family

| Contract | VERSION constant | Upgrade model | Role |
|----------|------------------|---------------|------|
| KarPassport | `1.10.0-rc.1` | Immutable | Vehicle passport ERC-721, verification lifecycle, BondedChallenge verification challenges, encumbrance `may`, claim payouts, bridge mint/burn/lock hooks |
| KarProPass | `1.1.0-rc.1` | Immutable | Soulbound verifier credential (one per wallet) |
| KarProStaking | `2.1.0-rc.1` live · **`2.2.0-rc.1` N5 source** | Immutable | Verifier stake + `isActiveVerifier` + claim payouts on leave (N5 source: native-only join) |
| Timelock48h | `1.0.0-rc.1` | Immutable | 48h governance for UUPS commerce mode proxies |
| KarPassportBridgeGateway | `1.3.0-rc.1` | Immutable | Symmetric hub↔spoke LayerZero gateway (Nuclear Model X); leave via `may(LeaveChain)` |
| FixedPriceConsignment | `2.4.0-rc.1` | UUPS proxy | **Commerce surface** — fixed-price consignment (Mandate / Recall / ConsignmentBase / BondedChallenge) |
| AscendingConsignment | `2.3.0-rc.1` | UUPS proxy | **Commerce surface** — English ascending auction consignment + settlement hold + BondedChallenge |

**Retired (not live product contracts):** `MarketplaceEscrow` and `AuctionEscrow` — sources and app/indexer consumers removed in commerce cutover §15.2 step 5 (July 2026). On-chain proxies from the July 2026 Nuclear cutover remain **denylisted** after Nuclear #2 ([I.9.1 / I.9.2 retired escrows](#i91-active-deployment-base-sepolia-84532)).

Source of truth for VERSION strings: `scripts/lib/contract-versions.ts` (must match Solidity `VERSION` constants). Historical thin ONFT / `ProxyONFT721Adapter` retained in `CONTRACT_VERSIONS` for verify/historical label lookups only — retired by §I.12; live smoke uses `KarPassportBridgeGateway`.

### v1.x → generation v2 summary

| Area | v1.x | Generation v2 |
|------|------|-----|
| Listing currency | Enum (`USD` / `EUR`) | `bytes32` registry + Chainlink feeds per currency |
| Marketplace governance | Deployer EOA as `upgradeAuthority` | `Timelock48h` as `upgradeAuthority` |
| Agent sales | None | Dépôt-vente: mandate grant → `open*FromMandate` → fee split |
| External payment | None | `setSettlementNote` + `confirmExternalPayment` |
| KarPassport tokenId | Sequential from 0 | `chainId << 128 \| localSequence` |
| Disputes | Deposit-free; D6 withdraw via `reportDiscrepancy` | BondedChallenge `open`/`withdraw`/`judge`/`conclude`; exact `disputeDeposit`; encumbrance `may` |
| Verifier pricing | None on-chain | `verificationFee` (informational) |
| Bridge | None | LayerZero ONFT (lock on hub, mint on spoke) → **end-state:** Unified Passport v1.3 + symmetric `KarPassportBridgeGateway` ([§I.12](#i12-multi-chain-architecture-normative)) |
| Checkout | ETH + USDC | Native + any approved ERC-20 payment token |

### Fee configuration note

| Context | `platformFeeBps` | Notes |
|---------|------------------|-------|
| `scripts/deploy.ts` (production deploy) | `10` (0.1%) | Intended testnet/mainnet default |
| `scripts/lib/local-stack.ts` (Hardhat tests) | `250` (2.5%) | Test-only; not deploy default |

---

### I.2. KarPassport (`1.10.0-rc.1`)

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
     │                              │ open (+ exact bond via BondedChallenge)
     │                              ▼
     │                          DISPUTED
     │                         /    |    \
     │            withdraw     /     |     \  conclude (anyone, after window)
     │         (opener, <14d) /      |      \
     │                       ▼       |       ▼
     │                   VERIFIED    |   UNVERIFIED (lapse)
     │                               |
     │              judge (independent KarPro, <14d)
     │              Upheld ──► UNVERIFIED
     │              Rejected ──► VERIFIED
     │
     └── setPassportURI from VERIFIED ── VerificationReset ──► UNVERIFIED
```

**Exit from DISPUTED:** `withdraw` (opener, **before** window) **or** `judge` (independent active verifier — not opener, owner, or recorded verifier — **before** window) **or** `conclude` (anyone, **after** window). Challenge state lives in `BondedChallenge`; the passport supplies eligibility, exclusion, qualification, bond amount, and domain terminals only. Owner cannot `setPassportURI` while DISPUTED.

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

### Verification challenge (BondedChallenge instance)

| Parameter | Default (deploy.ts) | Admin |
|-----------|---------------------|-------|
| `disputeDeposit` | `0.01 ether` (must be **non-zero**) | `setDisputeDeposit` (owner → Timelock48h after Nuclear handoff); exact match at `open` |
| `DISPUTE_WINDOW` | `14 days` (constant → library window) | — |
| `platformRecipient` | Immutable ctor / forfeit recipient | — |
| `totalLockedBonds` | Sum of active challenge bonds (library) | Rescue accounting |
| `challengeOpenedAt` | Stamped on open; cleared on every terminal | — |

| Action | Caller | Effect | Bond |
|--------|--------|--------|------|
| `open` | Anyone (payable, exact bond) | VERIFIED → DISPUTED; captures window + bond | Locked in library |
| `withdraw` | Opener only, **before** window end | DISPUTED → VERIFIED; free full refund | → opener |
| `judge(Upheld)` | Active KarPro ≠ opener ≠ `ownerOf` ≠ `passportVerifier`, **before** window | → UNVERIFIED; clear verifier | → opener |
| `judge(Rejected)` | Same independent judge, **before** window | → VERIFIED; keep verifier | → **`platformRecipient`** (never judge) |
| `conclude` | Anyone, **after** window | → UNVERIFIED; clear verifier | → **`platformRecipient`** |

`JudgeOutcome`: `Upheld` (0) = verification lapses; `Rejected` (1) = verification stands. Expiry does **not** decide merits and does **not** restore VERIFIED — the assertion lapses for lack of professional backing within the window.

#### Accountability event surface (BondedChallenge + passport domain)

A state transition a party can be held to must leave a log complete enough to reconstruct without reading storage.

| Transition | Event | Notes |
|---|---|---|
| Challenge open | `ChallengeOpened(subjectId, challenger, bondAmount, windowDuration, openedAt)` | Emitted by `BondedChallenge` (both instances). Indexed: `subjectId`, `challenger`. |
| Challenge withdraw | `ChallengeWithdrawn(...)` | Full refund reconstructable from args |
| Challenge judge | `ChallengeJudged(..., judge, outcome, bondRecipient, ...)` | Indexed: `subjectId`, `challenger`, `judge` |
| Challenge conclude | `ChallengeConcluded(...)` | After window; bond → forfeit recipient |
| Status → DISPUTED | `PassportDisputed` | Domain only (kept); bond mechanics are `ChallengeOpened` |
| Status → UNVERIFIED (lapse) | `VerificationLapsed` | After upheld / expired |
| Status → VERIFIED (stand) | `VerificationStood` | After rejected / withdrawn |

**Removed (duplicates of library challenge events):** `DisputeDepositPaid`, `DisputeResolved`, `DisputeExpired`, `DisputeWithdrawn`. Governance still emits `DisputeDepositUpdated` on `setDisputeDeposit`.

#### Commerce mode events (ConsignmentBase / Mandate / Recall / modes)

| Transition | Event |
|---|---|
| Mandate grant / revoke | `MandateGranted` / `MandateRevoked` |
| Snapshot floor / commission lower | `ConsignmentFloorLowered` / `ConsignmentCommissionLowered` |
| Recall request | `RecallRequested` |
| Consignment open | `ConsignmentOpened` (full terms + snapshotted `platformFeeBps`) |
| Price amend | `ConsignmentPriceSet` |
| Close / return | `ConsignmentClosed(tokenId, CloseReason)` |
| Settlement split | `ConsignmentSplitPaid` (owner/agent/platform legs) |
| Ascending terms at open | `AscendingTermsSnapshotted` (required: `_auction` deleted at settle) |
| Outbid refund | `BidRefunded` |
| Reversal begins | `ReversalStarted` |

`CloseReason`: `Returned` · `Sold` · `ExternalConfirmed` · `HoldReleased` · `Recalled` · `ReversalCompleted` · `ReversalAbandoned`.

FixedPriceConsignment `VERSION` **`2.4.0-rc.1`**. AscendingConsignment **`2.4.0-rc.1` live (Nuclear #4 I.9)** · **`2.5.0-rc.1` N5 source** (S3.5 prep on `feat/solana-svm-port`, not cut over).

**Ascending admin surface (live Nuclear #4):** auction bounds (`minDuration` … `abandonmentWindow`) plus challenge bond are read via `auctionRules()` and replaced atomically with `setAuctionRules` → `AuctionRulesSet` (full set).

**Ascending admin surface (N5 source — ships at next cutover):** the seven auction bounds are **`public constant`** in bytecode (same numeric values as today’s deploy defaults); `auctionRules()` still returns eight fields (constants + stored bond); `initialize` emits `AuctionRulesSet` with those constants + init bond; Timelock may rotate **only** the settlement challenge bond via `setChallengeBond(uint256)` → `AuctionRulesSet` (constants + new bond). `setAuctionRules` is removed.

**Both generations:** protection fields are opener **bounds** only — lot hold length is chosen at `openAscendingDirect` / `openAscendingFromMandate` (`duration` + `protectionWindow_` args; `ProtectionOutOfBounds` outside min/max) and snapshotted in `AscendingTermsSnapshotted` / `auctionProtectionWindow(tokenId)`. Mandate path does not add a mandate floor field for protection — the agent chooses within bounds at open, as with duration. Payment-token approve stays owner-only; revoke is guardian **or** owner (soft-disable). Lot open still emits `ConsignmentOpened` then `AscendingTermsSnapshotted` (two emits; merge rejected after size fit).

**EIP-170:** Ascending deployed bytecode **23855** (limit 24576, headroom **721**) with linked **`AscendingHoldLib`** + **`AscendingOpenLib`** (Hardhat link → `DELEGATECALL`; bid stays on the mode). FixedPrice **18070** (headroom **6506**). Combined mode headroom **7227**. Accountability event surface unchanged. Headroom is hundreds of bytes — not a multi-KB buffer; next feature that does not fit remains a model-boundary question ([I.5 Mode authority](#i5-commerce-modes-fixedpriceconsignment--ascendingconsignment)).

**Open gate:** `_requireCanOpen` refuses unless `IEncumbranceRegistry(passport).isEncumbranceSource(address(this))` — `ModeNotEncumbranceSource`. Registration is not answered inside `may` (previews stay bool / `SourceUnanswerable` only).

**Mode authority (G3):**

| Op | Authority |
|----|-----------|
| `pause` | Guardian (`NotGuardian`) |
| `revokePaymentToken` | Guardian **or** owner (Timelock) — soft-disable; in-flight buy/bid/settle keep stored config (`NotGuardianOrOwner`) |
| `unpause` / `approvePaymentToken(token, feed, stalenessTolerance)` / `setGuardian` / UUPS / `setAuctionRules` (live) · **`setChallengeBond`** (N5 source) / `setCurrencyFeed(code, feed, stalenessTolerance)` / `setNativeUsdStalenessTolerance` | Owner (Timelock) |
| Passport `addEncumbranceSource` / `removeEncumbranceSource` / `setDisputeDeposit` / `rescueExcessEth` | Owner (Timelock); `setBridgeGateway` one-shot |

**Encumbrance:** `may(tokenId, Intent)` answers challenge + governed external sources only. **`OpenConsignment` does not require VERIFIED** — FixedPrice may open while UNVERIFIED when encumbrance allows. Ascending open enforces VERIFIED at the mode (`PassportNotVerified`). **`LeaveChain` readiness** is always true when encumbrance allows (unverified may travel). Registration is owner/timelock (`addEncumbranceSource` / `removeEncumbranceSource`). The passport holds no registry entry for itself.

**E6 — unanswerable source forbids by name:** each registered source is probed with a bounded `staticcall` (`SOURCE_MAY_GAS` = 100 000). Revert, empty returndata, unreadable returndata, or gas exhaustion → `SourceUnanswerable(source)` (never treat silence as permission). A healthy `false` still returns `false` without naming. Governance removes the named address to restore service.

**Party exclusion:** covers the opener, the passport **owner**, and the **recorded `passportVerifier`**. Qualification is active KarPro (`NotQualifiedJudge`). Exclusion is checked before qualification.

**`setDisputeDeposit`:** rejects zero (`ZeroDisputeDeposit`) so the deterrent cannot be switched off by value. There is **no** on-chain ceiling; governance can raise the bond high enough to make verifications effectively unchallengeable — control is Timelock48h visibility and cancellability. Open challenges keep the bond captured at open.

**Accepted risk — open-window griefing freeze:** a freeze of up to `DISPUTE_WINDOW` is available for the cost of gas. It blocks auctions, bridging, and metadata updates — **not** a FixedPrice consignment already offered for buy. New consignments are refused via `may(OpenConsignment)` while challenged.

### Unchanged v1.1 behaviors

- **`setPassportURI` (verification reset policy):** from VERIFIED, a new metadata URI emits `VerificationReset` → UNVERIFIED; from DISPUTED → revert; same URI → `SameURI`.
- `appendRecord`, `reportDiscrepancy`, `appendAttestation` — record-only paths unchanged in role.
- `verifyPassport`: active verifier only; `CannotSelfVerify` if verifier owns token.
- **E5:** Buyer inherits `passportStatus` on transfer; no auto-reset on sale.
- Mode (or other protocol) custody of the NFT blocks owner-only mutations (`NotOwner` while `ownerOf` is not the wallet).

### KarPassport — function reference

| Function | Access | Behavior |
|----------|--------|----------|
| `chainIdOf` / `localIdOf` | view | Decode tokenId namespace |
| `may` | view | Permission for `LeaveChain` / `OpenConsignment` (challenge + sources; no status readiness on Open) |
| `addEncumbranceSource` / `removeEncumbranceSource` | owner | Governed external obligation registry |
| `setDisputeDeposit` | owner | Update exact bond for next `open` (**≠ 0**); emits `DisputeDepositUpdated` |
| `rescueExcessEth` | owner | Withdraw ETH not in `totalLockedBonds` or pending claims |
| `mintPassport` | anyone | Mint UNVERIFIED passport; increment chain-local id |
| `setPassportURI` | token owner | Metadata URI update; resets verification when status is VERIFIED (see Part III § anchor vs cosmetic) |
| `verifyPassport` | active verifier | UNVERIFIED → VERIFIED |
| `open` | anyone + exact ETH | VERIFIED → DISPUTED; BondedChallenge open |
| `withdraw` | challenge opener (before window) | DISPUTED → VERIFIED + full refund |
| `judge` | independent active KarPro (before window) | Resolve; Upheld → UNVERIFIED / Rejected → VERIFIED; bond by fault |
| `conclude` | anyone (after window) | DISPUTED → UNVERIFIED; bond → platform |
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
| `EmptyField` | Required string empty |
| `ZeroAddress` | Zero address where forbidden |
| `ZeroDisputeDeposit` | Ctor or `setDisputeDeposit` with zero bond |
| `SameURI` | URI unchanged |
| `WrongValue` | `open` bond ≠ `disputeDeposit` |
| `NotDisputeOpener` | `withdraw` not opener |
| `NoActiveDispute` | No active challenge |
| `CannotResolveOwnDispute` | Judge is opener, owner, or recorded `passportVerifier` |
| `NotQualifiedJudge` | Judge is not an active KarPro |
| `DisputeWindowActive` | `conclude` before window end |
| `DisputeWindowElapsed` | `withdraw` or `judge` after window end |
| `SourceAlreadyRegistered` | Duplicate encumbrance source |
| `SourceNotRegistered` | Remove unknown source |
| `SourceUnanswerable` | Registered source could not answer `may` (revert / empty / unreadable / OOG within `SOURCE_MAY_GAS`) |
| `NothingToRescue` | Rescue amount invalid (free balance excludes locked bonds **and** outstanding native claims) |
| `NoClaim` | `withdrawClaim` with zero pending balance |
| `TransferFailed` | `withdrawClaim` transfer failed (push paths credit a claim instead) |
| `TokenIdSpaceExhausted` | 2^128 mints on chain |

---

### I.3. KarProPass (`1.1.0-rc.1`)

Soulbound ERC-721: **one pass per wallet**, non-transferable after mint.

- `tokenId = uint256(uint160(holderAddress))`.
- Only `KarProStaking` may `mint` / `burn`.
- `updateProfile` is the canonical holder path for category, name, metadata URI.
- `setStaking`: **`ZeroAddress` guard** — cannot point staking to zero; emits **`StakingSet`**.
- Category args are range-checked (`InvalidCategory` when `category > Category.OTHER`).

### KarProPass — function reference

| Function | Access | Behavior |
|----------|--------|----------|
| `setStaking` | owner | Wire staking contract (non-zero); emits `StakingSet` |
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
| `InvalidCategory` | Category enum cast out of range |

---

### I.4. KarProStaking (`2.1.0-rc.1` live · **`2.2.0-rc.1` N5 source**)

- **`isActiveVerifier(address)`** — single source of truth (active stake record); **false immediately after `leave`**, including during unbonding.
- **`becomeVerifierNative`** — permissionless native join; mints KarProPass; reverts `UnbondPending` if a prior leave has not been claimed. **Product UI:** join is **native only** (`KarProJoinForm` → `becomeVerifierNative`).
- **N5 source (S3.5 prep):** ERC-20 stake path removed — no `stakeToken`, `becomeVerifierToken`, or `setStakeToken`. Native-only join is the shipped model (§13.11). KarProPass + KarProStaking deploy as a **pair**; retargeting `setStaking` on an existing pass without redeploying both traps re-join (`test/kargain.contracts.test.ts` “retarget trap blocks re-join”).
- **Live Nuclear #4:** bytecode still exposes dormant `becomeVerifierToken` / `setStakeToken` (never enabled; production `StakeTokenSet` count **0** on both commercial chains). UI already withholds token-join (S22). N5 cutover removes the dormant surface.
- **`Stake.asset`** — always `address(0)` (native ETH) on N5 source; live chains may record ERC-20 only if token join had ever been enabled (never on commercial testnet). Claim refunds the recorded asset. Same native convention as `ClaimablePayouts` / Modes payment asset (`address(0)` = native).
- **Two-phase leave:** `leave()` ends the role immediately (`active = false`, burn try/catch), sets `unlockAt = now + UNBONDING_PERIOD` (**14 days**, equal to passport `DISPUTE_WINDOW` by design). `claimStake()` after unlock pays via ClaimablePayouts (failed push → withdrawable claim). **No slashing** in this ship. There is **no** dispute↔leave coupling — a future slash design must use a monotonic “not before” unlock timestamp (bug → early unlock), never a decrementing challenge counter (bug → permanent lock).
- **`minStakeNative`** — default `0.05 ether`; owner adjustable but **`MIN_STAKE_FLOOR = 0.001 ether`** minimum.
- **`verificationFee`** — verifier-set wei amount; **informational only** (no on-chain payment enforcement on KarProStaking). The Kargain `/kar-pro` UI composes service margin (nav display currency) plus an estimated `verifyPassport` gas cost at save time and writes the sum as a single wei value via `setVerificationFee`. Accepted off-chain payment methods are signaled in Nostr kind 0 as optional `verifierPaymentMethods` (`eth`, `usdc`, `lightning`; absent = all three). Workflow: verifier sets fee → passport owner may pay the verifier directly (Kargain UI supports native ETH with an on-chain memo, USDC `transfer`, or a Lightning payment resolved from the verifier's Nostr kind 0 `lud16` — none escrowed or enforced by contracts) → verifier calls `verifyPassport` after inspection.
- Constructor requires non-zero `proPass` (`ZeroAddress`). Stake storage layout ships only via full Nuclear redeploy.

### KarProStaking — function reference

| Function | Access | Behavior |
|----------|--------|----------|
| `becomeVerifierNative` | anyone + ETH | Stake native (`asset = 0`); mint pass |
| `leave` | active verifier | End role; start 14d unbond; attempt burn (no payout yet) |
| `claimStake` | after unlock | Pay native stake (or credit claim); clear unbond state |
| `setMinStakeNative` | owner | New minimum (≥ floor) for **new** joiners |
| `isActiveVerifier` | view | Active stake check |
| `setVerificationFee` | active verifier | Set public fee signal (wei) |

*Live Nuclear #4 only (removed in N5 source):* `becomeVerifierToken`, `setStakeToken`.

### KarProStaking — error reference

| Error | When |
|-------|------|
| `BelowMinStake` | Native stake below minimum |
| `AlreadyVerifier` | Active stake exists |
| `UnbondPending` | Join while unbonding / unclaimed stake remains |
| `NotVerifier` | Leave or fee update without active stake |
| `UnbondNotReady` | `claimStake` before unlock |
| `NoUnbond` | `claimStake` with no pending unbond |
| `NoClaim` | `withdrawClaim` with zero pending balance |
| `TransferFailed` | `withdrawClaim` transfer failed (`claimStake` credits a claim on push failure) |
| `BelowMinStakeFloor` | Owner sets min below 0.001 ETH |
| `ZeroAddress` | Constructor `proPass_ == 0` |

---

### I.5. Commerce modes (FixedPriceConsignment + AscendingConsignment)

**Contractual commerce surface** (generation v2, post §15.2 step 5): **`FixedPriceConsignment`** and **`AscendingConsignment`** UUPS proxies. Shared libraries: **`ConsignmentBase`**, **`Mandate`**, **`Recall`**, **`BondedChallenge`** (also used by KarPassport verification challenges).

| Mode | VERSION | Role |
|------|---------|------|
| FixedPriceConsignment | `2.4.0-rc.1` | Mandate → open → buy / delist / recall; fiat registry + native / ERC-20 checkout; per-feed oracle staleness; agent commission splits |
| AscendingConsignment | `2.4.0-rc.1` live · **`2.5.0-rc.1` N5 source** | English ascending auction consignment + settlement hold + BondedChallenge on hold paths |

**Open refusal:** unregistered mode → `ModeNotEncumbranceSource`. Payment-token admission checked **at open only**; soft-revoked assets block new opens while in-flight sales settle.

**Trust readiness (Nuclear #4):** FixedPrice open/grant ignore `passportStatus` (encumbrance `may(OpenConsignment)` only). Ascending **`openAscendingDirect` / `openAscendingFromMandate`** require `passportStatus == VERIFIED` else `PassportNotVerified`. Mandate **`grant`** stays status-free (agent may verify before open).

**Guardian errors:** `pause` → `NotGuardian`; `revokePaymentToken` → `NotGuardianOrOwner` (guardian or Timelock owner). FixedPrice VERSION **`2.4.0-rc.1`**; Ascending VERSION **`2.4.0-rc.1`** (live on Nuclear #4 I.9).

**Denomination invariants** (P3 / M3 / N4 / P4 — this subsection is the git-canonical statement):

| Id | Rule | Enforcement |
|----|------|-------------|
| **P3** | Floor carries the same denomination as price; at settlement both relate through one rate (relationship does not float with FX). | Mandate + consignment store floor in that denomination; FixedPrice `buy` derives the asset snapshot from the quoted price amount and the Margin/Commission scale base (`_agentedFloorScaleBase` + `Math.mulDiv`) — not an independent `quote(floor)`. |
| **M3** | Floor is never converted at opening; a fiat mandate stays fiat until payment. | `open*` / `setPrice` validate floor against price in the stored denomination via `_requireAgentedPriceMeetsFloor`; no asset conversion at open. |
| **N4** | Ascending opens only under an asset-denominated mandate (P1 ∩ M3). | Ascending `open*` refuses fiat denomination. |
| **P4** | Per-feed oracle staleness; zero feed = asset-only admit. | See **FixedPrice payment-token feed (P4)** and **Per-feed oracle freshness** below — do not duplicate here. |

**FixedPrice payment-token feed (P4):** `approvePaymentToken(token, feed, stalenessTolerance)` with `feed == address(0)` admits the token for **asset-denominated sales only** (seller names token units; no conversion). `stalenessTolerance` must be **0** when `feed == 0`; otherwise it must sit in on-chain bounds **`MIN_FEED_STALENESS` = 60s** through **`MAX_FEED_STALENESS` = 259 200s (72h)** — below 60s block-time and RPC skew dominate; 72h admits `2 × max(observedMaxGap, publishedHeartbeat)` for ~24h stablecoin/FX feeds when observed gap slightly exceeds published heartbeat (see commerce-model P4 derivation). Fiat + ERC-20 opens require a non-zero feed (`PaymentTokenFeedRequired` at open and again in `_usdToTokenAmount` — no USD-stable parity). Once a non-zero feed is set it cannot be cleared by re-admission (`CannotClearPaymentTokenFeed`). Soft-revoke keeps decimals/feed/tolerance so in-flight fiat quotes still resolve via the measured feed. **No global staleness default** — the removed `maxFeedStaleness` / `setMaxFeedStaleness` cannot silently inherit across feeds.

**Per-feed oracle freshness:** native USD uses `nativeUsdStalenessTolerance` (set at `initialize` and via `setNativeUsdStalenessTolerance`); each payment token and currency feed carries its own tolerance at admit/set. Quote and buy paths compare Chainlink `updatedAt` against **that feed’s** tolerance (`StalePrice` on breach). Ascending has no feeds (unchanged). Tolerances are derived by one rule — `2 × max(observedMaxInterRoundGap, publishedHeartbeat)` — in `scripts/lib/chainlink-feeds.ts` (`deriveFeedStalenessTolerance`); `pnpm deploy:nuclear:dry-run` calls `assertNuclearFeedsFresh` against each configured tolerance before any tx. Normative write-up: commerce-model **P4 tolerance derivation**.

Nuclear FixedPrice USDC admit uses the chain’s USDC/USD aggregator from `CHAINLINK_FEEDS.usdcUsdFeed` when present; when that entry is zero, Nuclear still admits USDC with `feed=0` and **announces** that fiat-denominated USDC sales are unavailable on that chain (asset-only). Never invent a feed or treat zero as a silent peg. Timelock may later `approvePaymentToken` with a non-zero feed and tolerance; once set, feed is monotonic. **Mainnet feed rows** (Ethereum `1`, Base `8453`) in `CHAINLINK_FEEDS` are configuration only — Nuclear deploy remains `isCommercialChainId` → **84532 | 11155111**; populating mainnet feeds does not unlock a mainnet Nuclear path (§7.6). A single global bound (e.g. 3600s) cannot serve both ETH/USD (~hourly) and USDC/USD (~24h) heartbeats — Base mainnet USDC/USD would fail a 3600s global check when probed ~18–20h stale (motivation for per-feed tolerances). Seller open UI offers Fiat×token only when the admitted token has a feed (`lib/commerce/openable-terms.ts` / `deriveOpenableTerms`; same derivation for mandate grant); Asset denomination is always offered for admitted assets.

**Nuclear admit tolerances (P4 rule; RPC gap + Chainlink directory 2026-07-30):** Base Sepolia **84532** — native ETH/USD **2444s** (obs max 1222, hb 1200; obs governs); USDC feed zero (asset-only). Ethereum Sepolia **11155111** — native ETH/USD **7392s** (obs 3696, hb 3600; obs governs); USDC/USD **172 992s** (obs 86496, hb 86400; obs governs). Live on commercial chains via **Nuclear #3** (August 1, 2026; same P4 numbers as Nuclear #2 admit). Timelock patch of any prior global max-staleness slot is rejected.

**Normative product model (git):** this Part I (mandate, recall, splits, ascending lifecycle, G3 pause/revoke, commerce cutover). Local maintainer annexes are not linked from this file.

**Ascending Nuclear initialize defaults** (normative model §11 / §7.3):

| Parameter | Default | Live N4 governance | N5 source |
|-----------|---------|-------------------|-----------|
| Extension window | **900 seconds** | `setAuctionRules` | **`public constant`** |
| Minimum increment | **300 bps** | `setAuctionRules` | **`public constant`** |
| Duration bounds | **3–30 days** | `setAuctionRules` | **`public constant`** |
| Protection bounds | **7–45 days** | `setAuctionRules` | **`public constant`** |
| Settlement challenge window | **14 days** | one-shot at `initialize` | one-shot at `initialize` |
| Abandonment window | **30 days** | `setAuctionRules` | **`public constant`** |
| Challenge bond | **0.01 ETH** | `setAuctionRules` · init | **`setChallengeBond`** · init |

Numeric mirrors: `scripts/lib/verify-constructor-args.ts` (`ASCENDING_*` exports). **Lot-bound auction terms** (duration, extension, min increment, protection, abandonment length) are snapshots at open — on live N4, governance storage is read when a new lot opens; on N5 source, constants are read (model §11, C4, G1; proven by `test/ascending/AscendingConsignment.test.ts` snapshot cases). The settlement **challenge window** is one-shot at Ascending `initialize` (not lot-open); the challenge **bond** is rotatable via `setChallengeBond` on N5 source (or full `setAuctionRules` on live N4) and captured when a challenge opens. **`AuctionRulesSet` at `initialize` on N5 source** gives the indexer first-write with constant seven-tuple + init bond; event and `auctionRules()` eight-field ABI shape unchanged.

#### Parameter provenance — what to read, and from where

One table per question a screen can ask. **A screen showing the terms of a specific lot never reads `auctionRules()`; a screen where someone is choosing terms reads nothing else.** Mixing the two is the defect this table exists to prevent.

| Parameter | Fixed when | Governance surface | Per-subject getter | Read from |
|---|---|---|---|---|
| Duration | chosen at open, within bounds | `auctionRules().min/maxDuration` | `auctionDuration(tokenId)` | create → bounds · lot → getter |
| Extension window | captured at open | `auctionRules().extensionWindow` | `auctionExtensionWindow(tokenId)` | lot → getter |
| Minimum increment | captured at open | `auctionRules().minIncrementBps` | `auctionMinIncrementBps(tokenId)` | bid panel → getter |
| Protection window | **chosen at open**, within bounds (H1) | `auctionRules().min/maxProtectionWindow` | `auctionProtectionWindow(tokenId)`; after `settle` the *deadline* is `holdProtectionEndsAt(tokenId)` | create → bounds · lot → getter · hold → deadline |
| Abandonment window | captured at open; deadline set when reversal becomes pending | `auctionRules().abandonmentWindow` | `auctionAbandonmentWindow(tokenId)`, then `holdAbandonmentWindow` / `holdAbandonmentDeadline(tokenId)` | reversal panel → deadline |
| Settlement challenge bond | rotatable; captured into `Challenge` at open | `auctionRules().challengeBond` · live: `setAuctionRules` · N5: **`setChallengeBond`** | `challengeBondAmount(subjectId)` | pre-open → `auctionRules()` · open → getter |
| **Settlement challenge window** | **one-shot at `initialize`; immutable per instance** | **none — not in `setAuctionRules` / `setChallengeBond`** | `challengeWindowDuration(subjectId)`, **zero unless a challenge is open** | pre-open → **no getter exists**, use the deploy record · post-open → getter, or Ponder `challenge.windowDuration` from `ChallengeOpened` |
| Verification challenge window | compile-time constant | none | `KarPassport.DISPUTE_WINDOW` (public constant) | anywhere — **chain read only**; never shadow with an app-side seconds constant |
| Verification challenge bond | rotatable; captured into `Challenge` at open | `KarPassport.disputeDeposit` (public) | `challengeBondAmount(tokenId)` | pre-open → `disputeDeposit` · open → getter |
| Platform fee bps | snapshotted into the consignment at open | `platformFeeBps` (public, live) | in `ConsignmentOpened`; storage cleared on close | lot → event/indexer |
| Recall cooldown | compile-time constant, not governed | none | `recallCooldown()` | anywhere |

Two traps this table encodes:

- **After `settle`, `AuctionTerms` is deleted** (`AscendingHoldLib.settle`), so every lot getter above returns zero for a completed lot. Terms of a finished auction come from `AscendingTermsSnapshotted` via the indexer — never from chain. The protection *deadline* is the exception: it lives on the `Hold` and survives.
- **The settlement challenge window has no readable source before a challenge exists.** It is deploy-time configuration with no getter and no governance path. Any pre-open display is a committed value that must be labelled as such, and it will drift the first time a chain is deployed with a different one. Tracked for correction with the next Ascending implementation change.

**Settlement challenge vs protection:** a challenge may open only while the protection hold is active; opening freezes remaining protection; the challenge window then bounds judgement. KarPassport verification challenges use a separate BondedChallenge instance with a **14-day** window ([verification challenge](#verification-challenge-bondedchallenge-instance)).

**Indexer / HTTP:** `GET /consignments*`, mandate routes (`GET /agents/:address/mandates`, `GET /owners/:address/mandates`), shared `GET /challenges`, config mirrors `GET /commerce-modes` / `/commerce-payment-tokens` / `/commerce-currency-feeds` — [indexer/README.md](../indexer/README.md).

**Live addresses:** FixedPrice + Ascending proxies are on `COMMERCIAL_ACTIVE` (84532 + 11155111) after Nuclear #4 (August 2, 2026); Ponder indexes from hub **44957457** / Eth **11404204**. Local Hardhat (`pnpm deploy:local`) deploys and indexes both modes.

**Accountability events:** ConsignmentOpened / MandateGranted / RecallRequested / ChallengeOpened / … — see KarPassport § commerce mode events above.

#### Retired — MarketplaceEscrow

`MarketplaceEscrow` Solidity, app consumers, and Ponder `marketplace_*` tables were **removed** in commerce cutover §15.2 step 5 (July 2026). July 2026 Nuclear proxies remain on-chain at [I.9.1 / I.9.2 retired escrows](#i91-active-deployment-base-sepolia-84532) and are **denylisted** after Nuclear #2; the app uses `kargainContractDenylist(chainId)` — no new listings. Historical v1 marketplace behavior: [Part II.7](#ii7-marketplace-unchanged-in-phase-1).

---

### I.6. Timelock48h v1.0.0

OpenZeppelin `TimelockController` with fixed **`MIN_DELAY_SECONDS = 48 hours`**.

| Role | Purpose |
|------|---------|
| Proposer | Schedule operations |
| Executor | Execute after delay |
| Admin | Optional; renounce after setup (`address(0)` in constructor to skip) |

Used as **owner / UUPS authority** on commerce mode proxies (`FixedPriceConsignment`, `AscendingConsignment`) after deploy handoff. KarPassport / KarProPass / KarProStaking remain immutable — timelock governs mode upgrades, feed registry, approve, and guardian replacement. Guardian may pause and soft-revoke payment tokens immediately.

---

### I.7. Bridge architecture

> **Superseded for the multichain end-state by [§I.12](#i12-multi-chain-architecture-normative).** §I.7 documents Bridge-1–7 (thin ONFT + `ProxyONFT721Adapter`, lock-and-mint hub → ONFT spoke). The end-state is the Unified Passport v1.3 + symmetric `KarPassportBridgeGateway` (§I.12); custody/trust/metadata rules are normative in §I.12. §7.4 (EIDs/pathway) and §7.6 (LayerZero security) remain in force for every pathway.

### 7.1 Design decisions

- **Lock-and-mint** on hub (adapter locks underlying KarPassport); **mint/burn** on spoke (`KarPassportONFT721`).
- KarPassport core contract stays bridge-agnostic; bridge is external adapter + spoke ONFT.
- Destination mint: status **UNVERIFIED** (trust not ported); `tokenURI` carried in LZ message extension.
- **Star topology only (hub ↔ spoke).** Spoke↔spoke pathways are forbidden. Hub `ProxyONFT721Adapter` embeds `tokenURI` in the LZ compose payload (`_buildMsgAndOptions`); spoke `KarPassportONFT721` uses base `ONFT721Core` outbound debit (burn only) and does **not** embed `tokenURI` on send — spoke↔spoke would drop metadata. Wire tooling enforces the `{40245, 40161}` star (`scripts/bridge-wire.ts` / `layerzero-pathway`); see also §7.6 EID allowlist.
- **Never wire testnet EIDs to mainnet EIDs** in `setPeer`.

### 7.2 ProxyONFT721Adapter v1.1.0-rc.1 (hub) — historical Bridge-1–7

- Wraps existing KarPassport ERC-721.
- `_debit`: reverts **`ListedInMarketplace`** if `marketplace.isListed(tokenId)`; then reverts **`PassportDisputed`** if `passportStatus(tokenId) == DISPUTED` (via minimal status view on `innerToken`).
- `_buildMsgAndOptions`: embeds `tokenURI(tokenId)` as `abi.encode(string)` compose payload.
- **Superseded** for Nuclear stacks by **`KarPassportBridgeGateway` `1.3.0-rc.1`** — leave is a single `may(LeaveChain)` question ([§12.6](#126-outbound-guards)); no marketplace/auction/status reads.

### 7.3 KarPassportONFT721 v1.0.0 (spoke)

- Standalone ONFT ERC-721 on destination chain.
- `_lzReceive`: mint to recipient; decode URI from compose extension; emit `ONFTReceived`.
- URI decode is guarded at the helper (`_memoryTail`); compose extensions ≤ 32 bytes yield a mint without URI.
- `_debit`: burn on outbound bridge.

### 7.4 LayerZero EndpointV2 — testnet EIDs

| Network | chainId / namespace | EID |
|---------|-------------------|-----|
| Base Sepolia | 84532 | 40245 |
| Ethereum Sepolia | 11155111 | 40161 |
| Solana Devnet | `2_000_040_168` (S4b Devnet stack; [§I.13](#i13-non-evm-commercial-chains-and-the-protocol-parameter-model-normative)) | 40168 |
| Polygon Amoy | 80002 | 40267 |

EndpointV2 (testnet): `0x6EDCE65403992e310A62460808c4b910D972f10f` (`scripts/lib/chainlink-feeds.ts`).

**Active pathway (40245 ↔ 40161)** — addresses from committed snapshot `scripts/lib/layerzero-metadata.snapshot.json` (refreshed via `pnpm lz:snapshot`). Metadata API keys: `base-sepolia` / `sepolia-testnet`. H2 pathway hash `0x7e8c7fd4…983b8` (must stay unchanged when adding 40168).

**Devnet pathway (40245 ↔ 40168)** — S4b COMPLETE; **S5-recover-R5** re-closed (August 30, 2026) after Y5-frozen UA lock. Hub OApp = N7 gateway `0x73240468…1827`; spoke OApp = Solana gateway_config PDA (not program id; live PDA in [ops/deploys/s4b-devnet.md](../ops/deploys/s4b-devnet.md)). DVNs **LayerZero Labs + P2P** both directions; confirmations **5**. Solana **receive** budget (not send CU) pinned in `lib/web3/bridge/lz-receive-gas.ts` (`SOLANA_DEVNET_*`; provenance in `svm/lab/RESULTS.md`). Deployer retains upgrade authority on S4–S8 ([§13.8](#138-governance-and-upgradeability)). **No** Solana `COMMERCIAL_ACTIVE` until S9. Library / executor / DVN addresses: **from snapshot** only.

**Planned (historical note):** pre-S4b prose called 40168 “planned”; treat the Devnet pathway row above as current for testnet star spokes.

| Side | sendUln302 | receiveUln302 | executor |
|------|------------|---------------|----------|
| Hub 40245 (Base Sepolia) | `0xC1868e054425D378095A003EcbA3823a5D0135C9` | `0x12523de19dc41c91F7d2093E0CFbB76b17012C8d` | `0x8A3D588D9f6AC041476b094f97FF94ec30169d3D` |
| Spoke 40161 (Ethereum Sepolia) | `0xcc1ae8Cf5D3904Cef3360A9532B477529b177cCE` | `0xdAf00F5eE2158dD58E0d3857851c432E34A3A851` | `0x718B92b5CB0a5552039B593faF724D182A881eDA` |

| Side | Required DVNs (LayerZero Labs + Nethermind) | Backup (snapshot only) |
|------|---------------------------------------------|------------------------|
| Hub 40245 | Labs `0xe1a12515F9AB2764b887bF60B923Ca494EBbB2d6` · Nethermind `0xd9222CC3Ccd1DF7c070d700EA377D4aDA2B86Eb5` | P2P · Horizen |
| Spoke 40161 | Labs `0x8eebf8b423B73bFCa51a1Db4B7354AA0bFCA9193` · Nethermind `0x68802e01D6321D5159208478f297d7007A7516Ed` | P2P · Horizen |

Confirmations: **5** both directions — explicit fallback (`confirmations.source: "explicit-fallback"`); the metadata API does not expose pathway defaults for this pair.

**enforcedOptions floors:** type1 **100k** / type2 **250k** (pathway floor for typical URIs). Hub sender may add Executor lzReceive gas via `extraOptions` from URI-length policy in `lib/web3/bridge/lz-receive-gas.ts` (long compose URIs); do not raise the pathway floor without a re-wire.

Wire tooling: `pnpm bridge:wire` / `pnpm bridge:wire:read-only` ([`scripts/bridge-wire.ts`](../../scripts/bridge-wire.ts)). Live Nuclear pathway recorded in [I.9.2](#i92-active-deployment-ethereum-sepolia-11155111) (July 21, 2026).
### 7.5 Bridge flow (step by step)

1. **Preconditions (Nuclear gateway):** Owner on hub; `may(LeaveChain)` true ([§12.6](#126-outbound-guards)); LZ peers wired (testnet↔testnet only; star per §7.1 / §7.6). *(Historical thin-ONFT also refused marketplace-listed and `DISPUTED`.)*
2. **Hub:** User calls ONFT send via **`KarPassportBridgeGateway`** → `_debit` reverts **`LeaveChainRefused`** when `may(LeaveChain)` is false; locks home NFT / burns foreign rep; message carries tokenId + URI compose. *(Historical `ProxyONFT721Adapter` used `ListedInMarketplace` / `PassportDisputed`.)*
3. **LayerZero:** Message delivered to spoke endpoint (DVN quorum / confirmations per §7.4 / §7.6).
4. **Spoke:** `KarPassportONFT721._lzReceive` mints same tokenId to recipient; sets URI from compose when present. Spoke ONFT has **no** on-chain `passportStatus` — **UNVERIFIED** is product/UI semantics for a fresh spoke mint (trust not ported), not a written hub status field.
5. **Return path (end-state, [§I.12.3](#i12-multi-chain-architecture-normative)):** Burn representation on spoke → unlock on home via gateway debit/credit pairing. **On unlock the home row is set to `UNVERIFIED`** (verifier/verifiedAt cleared). **`VerificationReset` is emitted only when prior status was VERIFIED** (mirrors `setPassportURI` — never-verified returns do not invent a reset). Returned URI adopted when provided (§I.12.5). *Note: the Bridge-1–7 thin ONFT preserved hub status on return; that is superseded — once commerce exists at the destination, preserving trust across a round trip re-attaches verification to a possibly-mutated asset/new owner.*

### 7.6 LayerZero security configuration (normative)

Normative rules for every LayerZero OApp/ONFT pathway used by Kargain. This section is the git-canonical rule set; Phase 2 ops live in [ops/deploys/phase2-checkpoint-dossier.md](../ops/deploys/phase2-checkpoint-dossier.md).

- **No defaults.** Default send/receive library and DVN configurations are forbidden. Every OApp/ONFT deployment MUST explicitly pin send and receive libraries and the per-pathway DVN set (required + optional). Never depend on LayerZero Labs-controlled defaults.
- **DVN quorum.** Minimum **2** required DVNs from independent operators on testnet pathways; **3–5** on any mainnet pathway. LayerZero Labs DVN MAY be one required DVN; it MUST NOT be the only one. **1-of-1** DVN configurations are forbidden permanently.
- **EID allowlist + star topology.** Testnet wire scripts allow hub↔spoke stars only (no spoke↔spoke peers). Live allowlist today: `{40245, 40161}`; planned addition `{40245, 40168}` per [§I.13](#i13-non-evm-commercial-chains-and-the-protocol-parameter-model-normative). Never wire testnet EIDs to mainnet EIDs.
- **Read-back.** After every config write, re-read on-chain state and fail if `requiredDVNCount < 2`, a default library is in use, a dead DVN is in the required set, or peers are non-reciprocal. Ops drift check: `pnpm bridge:wire:read-only` (zero transactions).
- **Receive library change policy.** Initial `setReceiveLibrary` only. Changing an already-set **non-default** receive library is refused by `bridge-wire` — use the explicit `setReceiveLibraryTimeout` / grace-period procedure (out of scope for the wire script).
- **Pinned metadata.** Library and DVN addresses MUST come from the committed LayerZero metadata snapshot (`pnpm lz:snapshot`), not from chat or memory. Snapshot `endpointV2` MUST equal `LZ_ENDPOINT_V2_BY_CHAIN`.
- **Config authority.** OApp delegate / config ownership follows the same governance pattern as other protocol contracts (Timelock48h upgrade authority). No EOA-held config ownership on mainnet.
- **Provider isolation.** LayerZero imports are confined to bridge adapter modules (`ProxyONFT721Adapter`, `KarPassportONFT721`, and their deploy/config scripts). Core contracts, `app/`, `lib/`, and `hooks/` remain messaging-provider agnostic so the provider is swappable (e.g. CCIP / Hyperlane) at the adapter boundary.
- **Monitoring.** Bridge config and ownership changes MUST be observable (LayerZero Console or equivalent alerting) before any mainnet pathway goes live.
- **Phase 2 checkpoint.** Bridge remains **testnet-scope** until a maintainer re-assessment clears the gates below. Before any mainnet pathway, the following testnet→mainnet deltas **MUST** be re-derived (testnet values are not portable). Maintainer dossier (prepared, **not activated**): [ops/deploys/phase2-checkpoint-dossier.md](../ops/deploys/phase2-checkpoint-dossier.md).
  - **(a) Confirmations.** Shipped testnet pathway uses confirmations **5/5** (explicit-fallback on 40245↔40161). Mainnet MUST re-derive confirmations from the pinned metadata snapshot for the mainnet EID pair — do not copy testnet 5/5.
  - **(b) Config delegate.** Testnet may use deployer EOA as OApp/ONFT / gateway config owner and recovery authority. Mainnet MUST move config ownership **and** gateway owner / `recoverLockedHome` to **Timelock48h** (no EOA-held config; see Config authority above and [recovery-bridge.md](../ops/recovery-bridge.md)).
  - **(c) DVN count.** Testnet minimum is **2** required DVNs (Labs + Nethermind). Mainnet MUST use **3–5** independent required DVNs.
  - **(d) Research gates.** Also confirm from the research doc: (1) LayerZero **default migration** to 5/5 (or documented floor) is complete, (2) a **timelock on library upgrades** is in place, and (3) **6+ months** without new LayerZero security incidents.
  - **(e) No ops smoke-mint on mainnet.** Mainnet forbids ops/smoke `mintPassport` and live `pnpm smoke:bridge` on commercial KarPassport (infra proof = `bridge:wire:read-only` / §7.6 read-back). Placeholder URIs (e.g. `ar://nuclear-smoke`) are forbidden on commercial stacks. Testnet live smoke requires a **pre-minted** `--token-id` with valid metadata — auto-mint is disabled (`scripts/lib/smoke-bridge-policy.ts`). Home passport has **no user burn** (permanent invariant; foreign `bridgeBurn` only) — ops must not create leftover commercial home NFTs.
  - **(f) Upgrade-authority revocation.** Before any commercial mainnet pathway on a chain whose programs are upgradeable, decide and record whether the upgrade authority is revoked (or equivalently locked under Timelock-only governance with no residual deployer key). BPF chains that revoke upgrade authority lose the ability to patch defects without redeploy — the decision is explicit, not default-open.
  - **(g) Dedicated RPC for non-EVM commercial mainnet.** Any non-EVM commercial mainnet MUST run against a dedicated RPC node (not a shared public endpoint relied on as production infrastructure). Testnet may use public endpoints per [§I.13](#i13-non-evm-commercial-chains-and-the-protocol-parameter-model-normative).
- **Risk framing.** Kargain bridges passport identity/metadata (spoke mints **UNVERIFIED** per §7.1; trust is never ported), not fungible value custody. Blast radius of a messaging compromise is data integrity, not fund loss. This framing does **not** relax any rule above.

### 7.7 Messaging fee payer (normative)

Normative rule for XMTP (or any successor) network fees on commercial mainnet. Same gate class as [§7.6](#76-layerzero-security-configuration-normative) Phase 2: an external protocol dependency on the critical path to commercial mainnet product completeness — not a messaging-phase backlog item.

**Payer ownership.** When the messaging network charges for traffic, the payer is the user (or an equivalent protocol user-pays path). Kargain MUST NOT fund a payer allowance, MUST NOT deposit USDC (or any fee token) into a Payer Registry for user messages, and MUST NOT hold a payer private key that pays for user messages. Platform treasury never subsidizes messaging.

**Fail-closed consequence (explicit).** Until a protocol path exists where fees for user-originated messages are charged to the user’s own payer balance (or an equivalent user-pays mechanism), commercial mainnet Kargain ships **without** buyer↔seller private messaging. Cold buyer contact is a product surface (consent / Requests); that surface stays unavailable on paid mainnet rather than running on a platform-funded gateway. Clearing this gate is required for commercial mainnet messaging — the same class of blocker as clearing §7.6 before a mainnet bridge pathway.

**Third-party gateways allowed.** This rule forbids Kargain funding and Kargain-held payer keys. It does **not** forbid a user paying a third-party gateway operator for signing and forwarding — the same pattern as a user paying an RPC provider. Whether such operators exist is outside this specification; client wiring MAY point at a user-chosen third-party gateway when the fee is not drawn from a Kargain-funded allowance.

**Not in this section.** Whether fees are currently enforced on the live XMTP network, migration timelines, and issue trackers for user-funded / delegated signing are maintainer status (HANDOFF), not SPEC law. This section remains true after fees turn on.

---

### I.8. Security model

### Non-custodial properties

- Commerce modes hold NFTs only during live consignments / holds; payments settle atomically via `_paySplit` / ClaimablePayouts (failed pushes become withdrawable claims).
- KarProStaking locks user stake; owner cannot drain verifier stakes.
- Platform does not hold user keys; `platformRecipient` receives fee slice only.

### Dispute deposit economics

Default **0.01 ETH** exact bond on `open` (non-zero; Timelock-gated after Nuclear handoff). Upheld → opener compensated; Rejected / Expired → **`platformRecipient`** (never the judge). Withdraw before the 14-day window → full free refund to opener.

### Accepted risks (audit + design)

| Risk | Mitigation / acceptance |
|------|-------------------------|
| **`platformRecipient` immutable** | Wrong address at deploy is permanent; verify before deploy |
| **`MIN_STAKE_FLOOR` bytecode constant** | Pinned at 0.001 ether in `KarProStaking`; a non-ETH-native EVM commercial chain would need a bytecode change for a correct sybil floor. Recorded; not scheduled; not Nuclear #5 volume A |
| **Open-window griefing freeze** | Up to 14d freeze (auctions/bridge/URI) for gas cost; FixedPrice buy on an already-offered consignment still allowed; counter = owner-funded independent Reject → bond to platform |
| **No bond ceiling** | Governance can raise deposit enough to make verifications unchallengeable; Timelock48h visibility + cancel is the control |
| **Reverting seller** | Seller contract wallet that reverts on native receive does **not** block settlement: `_paySplit` → `_payNative` (`ClaimablePayouts`, `NATIVE_PUSH_GAS`) credits a claim and the lot closes. The seller can only block **their own** payout until a successful `withdrawClaim` |
| **Agent price / commission** | Under Commission the agent may lower (never raise) snapshotted `commissionBps` (C2); under Margin there is no agent fee object — the agent sets price and keeps the residual. Owner protection is snapshotted `floor` via `_computeAgentedSplitAmounts` / `BelowFloor` (C6). **Split arithmetic (live Nuclear #3):** platform floored first `⌊S·p/B⌋`, owner floored kept rate `⌊S·(B−p−c)/B⌋`, agent residual. Off-chain mirror: `lib/commerce/agented-split.ts`. Buyers should quote immediately before purchase |
| **Oracle staleness** | Per-feed `stalenessTolerance` on FixedPrice (native, payment token, currency); bounds 60s–72h; P4 rule `2 × max(obs, publishedHb)`; stale feeds revert quote/buy (`StalePrice`); no global default |
| **External payment trust** | `confirmExternalPayment` is seller attestation — no on-chain payment proof |
| **`verificationFee`** | Informational on-chain signal only — no escrow or payment enforcement; Kargain UI may facilitate direct owner→verifier ETH (memo) or USDC transfer |
| **Bridge trust** | LayerZero + ONFT config per §7.6 (pinned config, ≥2 independent DVNs, no defaults); misconfigured peers are operational risk |

### Permanent invariants

- **`CannotSelfVerify`:** verifier cannot verify own passport.
- **`CannotResolveOwnDispute`:** opener, passport owner, and recorded `passportVerifier` cannot resolve; a later hired independent verifier may.

---

### I.9. Multi-chain deployment matrix

| Network | chainId | tokenIdOffset | Initial currencies (config) | Status |
|---------|---------|---------------|------------------------------|--------|
| Base Sepolia | 84532 | `84532 << 128` | USD | Deployed (Nuclear #4) — [I.9.1](#i91-active-deployment-base-sepolia-84532) |
| Ethereum Sepolia | 11155111 | `11155111 << 128` | USD | Deployed (Nuclear #4) — [I.9.2](#i92-active-deployment-ethereum-sepolia-11155111) |
| Polygon Amoy | 80002 | `80002 << 128` | USD | Planned |
| Base | 8453 | `8453 << 128` | USD, EUR, GBP, CAD, AUD | Planned mainnet |
| Ethereum | 1 | `1 << 128` | TBD feeds | Planned |
| Polygon | 137 | `137 << 128` | TBD feeds | Planned |

Historical v1.x / pre-Nuclear addresses: [Part II.4](#ii4-historical-deployment-base-sepolia-84532). **Nuclear #4** August 2, 2026 — production Ponder **full reindexed** from hub `indexFromBlock` **44957457** and Eth **11404204**.

### I.9.1 Active deployment (Base Sepolia 84532)

> **Single source of truth** for active 84532 contract addresses and semver. Other docs link here. Matches `lib/web3/commercial-active.ts` (`COMMERCIAL_ACTIVE[84532]` / `SEPOLIA_ACTIVE`). Local `deployments/84532.json` is a deploy-machine artifact (not in git).

Nuclear #4 cutover August 2, 2026 · KarPassport **`1.10.0-rc.1`** · FixedPrice **`2.4.0-rc.1`** · Ascending **`2.4.0-rc.1`** · KarProStaking **`2.1.0-rc.1`** · `indexFromBlock`: **44957457** · committed: `COMMERCIAL_ACTIVE[84532]` · commerce guardian `0xcfe194fea9727bD04dA8F78c2362680986e02dF1`

| Contract | VERSION | Address | Basescan |
|----------|---------|---------|----------|
| Timelock48h | `1.0.0-rc.1` | `0x274515B5b2Ba32bDce7E97122C69cfDa343E85Fb` | [code](https://sepolia.basescan.org/address/0x274515B5b2Ba32bDce7E97122C69cfDa343E85Fb#code) |
| KarProPass | `1.1.0-rc.1` | `0x046DB61Ac23520bd6f9466a7f8B033325795B32c` | [code](https://sepolia.basescan.org/address/0x046DB61Ac23520bd6f9466a7f8B033325795B32c#code) |
| KarProStaking | `2.1.0-rc.1` | `0xCBfCDfebbb6fDF4C3bbD30F363558FE618C986aE` | [code](https://sepolia.basescan.org/address/0xCBfCDfebbb6fDF4C3bbD30F363558FE618C986aE#code) |
| KarPassport | `1.10.0-rc.1` | `0x8354697d0DdCe6a3AA9aD33DDc1585e4b60CbC76` | [code](https://sepolia.basescan.org/address/0x8354697d0DdCe6a3AA9aD33DDc1585e4b60CbC76#code) |
| KarPassportBridgeGateway | `1.3.0-rc.1` | `0xb1aEEA9466b8C67Ba9D8931987E26A2Bef59B7Dc` | [code](https://sepolia.basescan.org/address/0xb1aEEA9466b8C67Ba9D8931987E26A2Bef59B7Dc#code) |
| FixedPriceConsignment | `2.4.0-rc.1` | `0x73F41293bb207443990006b951CE9BC38Ef2eB3b` | [code](https://sepolia.basescan.org/address/0x73F41293bb207443990006b951CE9BC38Ef2eB3b#code) |
| AscendingConsignment | `2.4.0-rc.1` | `0xABd47E54595b814625B1B911BC3A078397Abb973` | [code](https://sepolia.basescan.org/address/0xABd47E54595b814625B1B911BC3A078397Abb973#code) |
| USDC | — | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | [token](https://sepolia.basescan.org/address/0x036CbD53842c5426634e7929541eC2318f3dCF7e) |
| Native USD feed | — | `0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1` | [feed](https://sepolia.basescan.org/address/0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1) |
| LayerZero EndpointV2 | — | `0x6EDCE65403992e310A62460808c4b910D972f10f` | [contract](https://sepolia.basescan.org/address/0x6EDCE65403992e310A62460808c4b910D972f10f) |

**FixedPrice oracle (84532):** native ETH/USD stalenessTolerance **2444s**; USDC admitted **asset-only** (feed zero — no Chainlink USDC/USD on Base Sepolia).

**Retired escrows (denylisted — not in `COMMERCIAL_ACTIVE`; removed from app/indexer July 2026 step 5):**

| Contract | VERSION | Address |
|----------|---------|---------|
| MarketplaceEscrow impl | `2.0.0-rc.1` | `0x0F98B21857386dF0c3B0323c94e63e140533495F` |
| MarketplaceEscrow proxy | `2.0.0-rc.1` | `0x60336c550946AF79c8FCfaDfA65d76224B356323` |
| AuctionEscrow impl | `1.0.1-draft` | `0x5aB1947806d9D28bb5CAB770A586a968EAeaDfF2` |
| AuctionEscrow proxy | `1.0.1-draft` | `0x37Fa0460Cfc46EC17E1d11D86AA4F9C9e0D79a04` |

**Parameters:** `disputeDeposit` 0.01 ETH · `platformFeeBps` 10 · `minStakeNative` 0.05 ETH · `upgradeAuthority` Timelock48h · USD-only currency registry · USDC payment token enabled · `platformRecipient` `0xcfe194fea9727bD04dA8F78c2362680986e02dF1` · `deployer` `0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77` · `COMMERCE_GUARDIAN` `0xcfe194fea9727bD04dA8F78c2362680986e02dF1`

> **Superseded (Nuclear #3 hub, denylisted August 2, 2026):** Timelock `0x886328…F4BE` · KarProPass `0xF4bCec…B32c` · KarProStaking `0xB7563a…0FD5` · KarPassport `0xEf7403…a52C` · gateway `0xd4728a…0daa` · FixedPrice `0x233B0e…B99E` · Ascending `0xC0ADc2…2039`. **Nuclear #2 / July 21 / pre-Nuclear hub** remain denylisted — see [Part II.4](#ii4-historical-deployment-base-sepolia-84532).

**Ops:** `pnpm smoke:sepolia` · `pnpm verify:sepolia` · `pnpm ponder:config` · `pnpm bridge:wire` · `pnpm smoke:bridge` · Nuclear deploy: [§I.10](#i10-deploy-sequence) · Nuclear #4 runbook: [ops/deploys/nuclear-4.md](../ops/deploys/nuclear-4.md)

### I.9.2 Active deployment (Ethereum Sepolia 11155111)

> **Single source of truth** for the Nuclear #4 full commercial stack on Ethereum Sepolia and the wired hub↔eth gateway pathway. Other docs link here. Matches `lib/web3/commercial-active.ts` (`COMMERCIAL_ACTIVE[11155111]`). Local `deployments/11155111.json` is a deploy-machine artifact (not in git).

Nuclear #4 cutover August 2, 2026 · KarPassport **`1.10.0-rc.1`** · FixedPrice **`2.4.0-rc.1`** · Ascending **`2.4.0-rc.1`** · KarProStaking **`2.1.0-rc.1`** · `indexFromBlock`: **11404204** · committed: `COMMERCIAL_ACTIVE[11155111]` · hub peer gateway: [I.9.1](#i91-active-deployment-base-sepolia-84532)

| Contract | VERSION | Address | Etherscan |
|----------|---------|---------|-----------|
| Timelock48h | `1.0.0-rc.1` | `0x95D9A432B53ceB42a0681b1900f52e7Fe2247586` | [code](https://sepolia.etherscan.io/address/0x95D9A432B53ceB42a0681b1900f52e7Fe2247586#code) |
| KarProPass | `1.1.0-rc.1` | `0xb83b89f4a7303f005dA8c0787e904104a1030128` | [code](https://sepolia.etherscan.io/address/0xb83b89f4a7303f005dA8c0787e904104a1030128#code) |
| KarProStaking | `2.1.0-rc.1` | `0x5dF3f185D9fAb40D1BEBC74b63268F8528a02906` | [code](https://sepolia.etherscan.io/address/0x5dF3f185D9fAb40D1BEBC74b63268F8528a02906#code) |
| KarPassport | `1.10.0-rc.1` | `0x1016BCA92B98Ea2C648074cAAf04C5d0B3Baf8eC` | [code](https://sepolia.etherscan.io/address/0x1016BCA92B98Ea2C648074cAAf04C5d0B3Baf8eC#code) |
| KarPassportBridgeGateway | `1.3.0-rc.1` | `0xec44167ab1e2619C9aCaA87F5B06DcAFe1BF7269` | [code](https://sepolia.etherscan.io/address/0xec44167ab1e2619C9aCaA87F5B06DcAFe1BF7269#code) |
| FixedPriceConsignment | `2.4.0-rc.1` | `0xc416f642a85E3E104A42c2B067bB31485947891d` | [code](https://sepolia.etherscan.io/address/0xc416f642a85E3E104A42c2B067bB31485947891d#code) |
| AscendingConsignment | `2.4.0-rc.1` | `0xbFdA994743feF37b268aA70ffF8a91eF3d10936E` | [code](https://sepolia.etherscan.io/address/0xbFdA994743feF37b268aA70ffF8a91eF3d10936E#code) |
| USDC | — | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | [token](https://sepolia.etherscan.io/address/0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238) |
| Native USD feed | — | `0x694AA1769357215DE4FAC081bf1f309aDC325306` | [feed](https://sepolia.etherscan.io/address/0x694AA1769357215DE4FAC081bf1f309aDC325306) |
| USDC/USD feed | — | `0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E` | [feed](https://sepolia.etherscan.io/address/0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E) |
| LayerZero EndpointV2 | — | `0x6EDCE65403992e310A62460808c4b910D972f10f` | [contract](https://sepolia.etherscan.io/address/0x6EDCE65403992e310A62460808c4b910D972f10f) |

**FixedPrice oracle (11155111):** native ETH/USD stalenessTolerance **7392s**; USDC/USD **172992s** (P4 rule).

**Retired escrows (denylisted — same policy as [I.9.1](#i91-active-deployment-base-sepolia-84532)):**

| Contract | VERSION | Address |
|----------|---------|---------|
| MarketplaceEscrow impl | `2.0.0-rc.1` | `0x7d37e7cbcc42308264B608429a82D03B7C3112F4` |
| MarketplaceEscrow proxy | `2.0.0-rc.1` | `0x4FC74e0B7eE0A741707A553D43Efff68126D198B` |
| AuctionEscrow impl | `1.0.1-draft` | `0xCf78b714DB70960bf1BB418C3370e4502AcFFC64` |
| AuctionEscrow proxy | `1.0.1-draft` | `0x796Fb1476440C3D8A34a8EC2Fa56664864531499` |

**Parameters:** same Nuclear policy as [I.9.1](#i91-active-deployment-base-sepolia-84532) (USD-only registry, `disputeDeposit` 0.01 ETH, `platformFeeBps` 10, `minStakeNative` 0.05 ETH, `upgradeAuthority` Timelock48h) · `platformRecipient` `0xcfe194fea9727bD04dA8F78c2362680986e02dF1` · `deployer` `0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77`

> **Superseded (Nuclear #3 Eth, denylisted August 2, 2026):** Timelock `0x20683c…FAb1` · KarProPass `0xFc12ea…0054` · KarProStaking `0xea8Ee6…02CB` · KarPassport `0xc903fe…1869` · gateway `0x3aC463…2E41` · FixedPrice `0xe9c062…84a1` · Ascending `0x07f9c1…542D`. **Nuclear #2 Eth** remains denylisted.

> **Superseded thin ONFT (denylisted):** KarPassportONFT721 `0x5b7fD0ffF9B82255AD4d043a491e81948b76e703` (July 20 spoke) — retired by Nuclear full stack.

**Wired pathway (testnet-only values):** EIDs **40245 ↔ 40161** · peers hub gateway `0xb1aEEA9466b8C67Ba9D8931987E26A2Bef59B7Dc` ↔ eth gateway `0xec44167ab1e2619C9aCaA87F5B06DcAFe1BF7269` · required DVNs Labs + Nethermind (committed snapshot `scripts/lib/layerzero-metadata.snapshot.json`) · confirmations **5 / 5** · enforcedOptions type1 **100k** gas / type2 **250k** gas (**floors**; sender may raise lzReceive via `extraOptions` from URI-length policy in `lib/web3/bridge/lz-receive-gas.ts`) · `pathwayConfigHash` `0x7e8c7fd4c6fbc0687a14335bfaae5d6fd4ecac1ea067ec955a6444e5893983b8`

`pathwayConfigHash` is an off-chain digest of the applied-config object. S2 changed `metadataSha256` from the whole snapshot to the two chain objects of this pathway (on-chain ULN, peers, libraries, and enforcedOptions are unchanged). **Founder ops:** run `pnpm bridge:wire` — every setPeer/setConfig/setEnforcedOptions should **skip**; the write updates the gitignored deployment manifest hash only — then `pnpm bridge:wire:read-only` remains PASS. Previous digest (whole snapshot) was `0x84c7ea51e28cedf54a79d9edc81b07019ad1a47cc3d5dc08471d681e4e81cf1e`.

**Ops:** `pnpm bridge:wire:read-only` (recurring §7.6 audit) · `pnpm smoke:bridge` · `pnpm verify:sepolia:eth` · Nuclear #4 runbook: [ops/deploys/nuclear-4.md](../ops/deploys/nuclear-4.md) · security policy: [§7.6](#76-layerzero-security-configuration).

---

### I.10. Deploy sequence

**Nuclear** commercial deploy (matches `scripts/deploy.ts`) for **84532** and **11155111** — identical protocol parameters; chain-specific externals only from `CHAINLINK_FEEDS` / `LZ_ENDPOINT_V2_BY_CHAIN` (`scripts/lib/chainlink-feeds.ts`). Dry-run parity: `pnpm deploy:nuclear:dry-run`. Live: `pnpm deploy:sepolia` (Base) / `pnpm deploy:sepolia:eth` (Ethereum Sepolia).

1. Deploy **Timelock48h** (proposer, executor, admin — typically deployer).
2. Deploy **KarProPass** (always fresh — no reuse on Nuclear redeploy).
3. Deploy **KarProStaking** (pass address + owner); `minStakeNative` = contract default **0.05 ETH**.
4. **`KarProPass.setStaking(staking)`**.
5. Deploy **KarPassport** `1.8.0-rc.1` (staking, owner, `disputeDeposit` = **0.01 ETH**, **`platformRecipient`**).
6. Deploy **FixedPriceConsignment** impl + ERC1967Proxy → `initialize(…, owner=deployer, guardian=COMMERCE_GUARDIAN, …)`; **USD-only** currency registry at init (native USD feed).
7. Deploy **AscendingHoldLib** then **AscendingOpenLib** (no ctor deps), then **AscendingConsignment** impl linked to those libraries + ERC1967Proxy → `initialize(…, owner=deployer, guardian=COMMERCE_GUARDIAN, …)`. Manifest stores `ascendingHoldLib` / `ascendingOpenLib` beside impl/proxy.
8. **`addEncumbranceSource(fixedPrice)`** and **`addEncumbranceSource(ascending)`** on KarPassport while Ownable is still deployer — **deploy scripts abort if `isEncumbranceSource` is false** before gateway. On-chain `open*` also refuses unless the mode is a live source (`ModeNotEncumbranceSource`).
9. **`approvePaymentToken(token, feed, stalenessTolerance)`** on both modes while deployer still owns them (FixedPrice: USDC + `CHAINLINK_FEEDS.usdcUsdFeed` and `usdcUsdStalenessTolerance` — **zero feed allowed** for asset-only with tolerance 0; Ascending: USDC, asset-only, no feed). FixedPrice `initialize` also sets `nativeUsdStalenessTolerance` from `CHAINLINK_FEEDS.nativeUsdStalenessTolerance`. When `usdcUsdFeed` is zero, scripts **admit and announce** that fiat-denominated USDC sales are unavailable on that chain (never invent a feed / silent peg). **`pnpm deploy:nuclear:dry-run`** runs `assertNuclearFeedsFresh` against each feed’s configured tolerance before txs. Scripts **abort** only if admission read-back fails (token not enabled or feed ≠ configured). **Post-handoff** approve / `setCurrencyFeed` / `setNativeUsdStalenessTolerance` still go through Timelock48h — `_validateFeed` runs at **execute** time against **that feed’s** tolerance (live Chainlink must stay fresh across the delay). Re-admission cannot clear a FixedPrice payment-token feed once set.
10. Deploy **KarPassportBridgeGateway** `1.3.0-rc.1` (**passport**, LZ endpoint, delegate only).
11. **`KarPassport.setBridgeGateway(gateway)`** (one-time bind).
12. **Mode ownership handoff:** `FixedPrice.transferOwnership(timelock)` then `Ascending.transferOwnership(timelock)` — scripts abort if owners ≠ Timelock.
13. **Passport / staking handoff:** `KarPassport.transferOwnership(timelock)` then `KarProStaking.transferOwnership(timelock)`.
14. **Configure LayerZero peers** (separate `pnpm bridge:wire`) — testnet EIDs to testnet only; mainnet to mainnet only.

**Retired:** steps that deployed `MarketplaceEscrow` / `AuctionEscrow` were removed in commerce cutover §15.2 step 5. **`pnpm deploy:auction`** and **`pnpm upgrade:auction`** are removed — do not redeploy legacy escrows.

After step 13, Timelock48h owns expand/restore ops (48h delay); guardian keeps immediate pause + soft-revoke:

| Contract | Authority |
|----------|-----------|
| KarPassport | Timelock: `setDisputeDeposit`, `rescueExcessEth`, `addEncumbranceSource` / `removeEncumbranceSource` (`setBridgeGateway` already consumed one-time) |
| KarProStaking | Timelock: `setMinStakeNative` (live N4 also: `setStakeToken` — removed N5 source) |
| FixedPrice / Ascending | **Guardian:** `pause`, `revokePaymentToken`. **Timelock (owner):** `unpause`, `approvePaymentToken(token, feed, stalenessTolerance)`, `setGuardian`, UUPS, `setCurrencyFeed(code, feed, stalenessTolerance)`, `setNativeUsdStalenessTolerance` (FixedPrice only), `setAuctionRules` (Ascending live) · **`setChallengeBond`** (Ascending N5 source) |

Write `deployments/<chainId>.json` with `generation: "v2"`, `tokenIdOffset` (`chainId << 128`), `contractVersions`, `indexFromBlock`, mode + library + gateway addresses (`fixedPriceConsignment`, `ascendingHoldLib`, `ascendingOpenLib`, `ascendingConsignment`, `bridgeGateway`).

**Parameters (both commercial chains):** `disputeDeposit` 0.01 ETH · `platformFeeBps` 10 · FixedPrice per-feed oracle tolerances from `CHAINLINK_FEEDS` (native + USDC at admit; bounds 60s–72h — see [I.5](#i5-commerce-modes-fixedpriceconsignment--ascendingconsignment)) · `minStakeNative` 0.05 ETH · Ascending Nuclear windows (this I.5 table): extension **900s**, protection **bounds 7–45 days** (opener chooses at open), settlement challenge **14 days**, abandonment **30 days**, min increment **300 bps**, duration **3–30 days**, challenge bond **0.01 ETH** · USD-only currency registry at mode deploy · USDC admitted at construction before handoff · same `platformRecipient` as prior 84532 deploy · `COMMERCE_GUARDIAN` for pause + soft-revoke · **FixedPrice `2.3.0-rc.1` full redeploy** (no in-place Timelock patch). Commerce behavior: [I.5](#i5-commerce-modes-fixedpriceconsignment--ascendingconsignment). Nuclear end-state: [§12.10](#1210-84532-hub-migration-testnet--nuclear).

---

### I.11. Retired — AuctionEscrow

**Retired** with `MarketplaceEscrow` in the commerce cutover (July 2026). Replaced by **`AscendingConsignment`** for English reserve auctions with settlement hold. Product, app, and indexer no longer target `AuctionEscrow` events or legacy `GET /auctions*` routes. Denylisted proxy addresses: [I.9.1 / I.9.2 retired escrows](#i91-active-deployment-base-sepolia-84532). Ops log: [ops/deploys/archive/84532-auction.md](../ops/deploys/archive/84532-auction.md).

---


### I.12. Multi-chain architecture (normative)

> **Single source of truth** for bridge custody, trust, and metadata across chains. Supersedes the custody/trust wording in §7.1/§7.5. §7.4/§7.6 remain the LayerZero pathway and security reference.

### 12.1 Model

Every commercial Kargain chain runs the **identical** stack: `KarPassport` + KarProPass + KarProStaking + **FixedPriceConsignment** + **AscendingConsignment** + one `KarPassportBridgeGateway`. There is exactly **one** passport contract type and **one** bridge contract type across all chains. The thin `KarPassportONFT721`, `ProxyONFT721Adapter`, and legacy **`MarketplaceEscrow` / `AuctionEscrow`** are retired.

**Identity.** High 128 bits of `tokenId` are a **Kargain chain namespace** (historically an EVM EIP-155 `chainId`). `tokenId = (namespace << 128) | localSeq`; `chainIdOf(tokenId)` is the immutable **origin/home** namespace. tokenIds are globally unique and **travel unchanged** — the gateway never re-encodes an id. Non-EVM namespace allocation: [§I.13](#i13-non-evm-commercial-chains-and-the-protocol-parameter-model-normative).

**Custody = lock-and-mint.** A token's canonical row lives on its home chain. When bridged away, the home gateway **locks** it and the destination gateway **mints a representation** with the same tokenId. *Origin/home* (`chainIdOf`) and *routing hub* (the LayerZero star center, currently EID 40245 Base) are **distinct**: messages relay **through the hub**, not "to the origin first." Star topology (hub↔spoke only; no spoke↔spoke peers) and the EID allowlist are in §7.6; planned third spoke EID 40168 in [§I.13](#i13-non-evm-commercial-chains-and-the-protocol-parameter-model-normative).

### 12.2 Master custody invariant

For every `tokenId`, the number of **usable** instances across all chains is **exactly one**: one free home token, or one locked-home + one representation, or transiently zero in-flight (locked/burned on source, retriable message not yet credited). No guard may permit two usable instances.

### 12.3 Trust never survives a crossing (supersedes §7.5 "preserved on return")

Every crossing lands **UNVERIFIED**, in **both** directions. Outbound mints the representation UNVERIFIED. **On unlock at home, status is set to UNVERIFIED** (`passportVerifier`/`passportVerifiedAt` cleared). **`VerificationReset` emits only when prior status was VERIFIED** — a never-verified passport does not increment reset accounting. Verification is chain-local; re-verify with a local KarPro or sell FixedPrice while UNVERIFIED. Ascending open still requires VERIFIED. KarPro is per-chain.

### 12.4 Custody-lock freezes the home trust surface

`KarPassport v1.7` tracks `custodyLocked[tokenId]` (set by the gateway on lock, cleared on unlock). While locked, **all trust-mutating paths revert**: `verifyPassport`, `open` / `withdraw` / `judge` / `conclude`, `reportDiscrepancy`, `appendAttestation`, `appendRecord`, `setPassportURI`.

### 12.5 Metadata authority is symmetric

URI is embedded on **every** send (both directions) and written by the receiver: `bridgeMint` sets the representation URI; **unlock overwrites the home URI** with the returned URI, then resets trust. The traveling side is the metadata source of truth while away.

### 12.6 Outbound guards

The gateway asks one permission question: **`KarPassport.may(tokenId, LeaveChain)`**. If false (or if a registered source is unanswerable → `SourceUnanswerable`), debit reverts **`LeaveChainRefused`**. The gateway holds **no** marketplace/auction references and does **not** read `passportStatus` (E2/E5).

LeaveChain is refused when: an intrinsic verification challenge is active; a registered FixedPrice live consignment forbids; a registered Ascending unresolved settlement forbids; or a registered source cannot answer (E6). Idle UNVERIFIED passports may leave (verification is not required to travel). Legacy escrow-listed NFTs on denylisted retired proxies are an ops concern only (those proxies are not in `COMMERCIAL_ACTIVE`) — the gateway reads **`may(LeaveChain)`**, not escrow custody.

### 12.7 Bridge entrypoints (gateway-only)

`KarPassport` exposes, callable **only** by the bound `bridgeGateway`: `bridgeMint(to, tokenId, uri)` (require `chainIdOf != local`, not-exists; status UNVERIFIED); `bridgeBurn(tokenId)` (require `chainIdOf != local`); `setCustodyLock(tokenId, bool)`; `bridgeResetOnUnlock(tokenId, uri)` (status→UNVERIFIED, clear verifier; emit `VerificationReset` only if prior was VERIFIED; set URI when provided). The gateway is bound **once** via `setBridgeGateway` (one-time, owner-only — `GatewayAlreadySet` after first bind). **`KarProPass.setStaking` is not the same pattern:** it may be called again with a non-zero address (no already-set guard); only `ZeroAddress` is refused. Do not equate the two bindings in ops or prose. Unlock releases only a token the gateway actually holds and had locked. `KarPassport` imports no LayerZero — it knows only a `bridgeGateway` address (§7.6 provider isolation).

### 12.8 Records are chain-sharded, globally aggregated

Each chain stores records appended while the token lived there, keyed by the same global tokenId. The **indexer** unions `passport_record`/`passport_uri_history` by global tokenId across chains. The **usable copy** lives on exactly one network (I1), distinct from origin. With a non-EVM spoke, that location is **not** stored by comparing wall clocks across VMs (D-05 clocks are incomparable). It is a **read-time fold** of guid-linked crossings: each hop is a departure carrying LayerZero `guid` on one stream plus the matching arrival on the other (`ONFTSent` / `ONFTReceived` and SVM analogs). A departure without an observed arrival leaves the usable copy on the source (in-flight = fail-closed, same as an unindexed `PassportBridgeBurned`). An incomplete fold — lagging stream, missing guid pair — is **unresolved**, never a silent fallback to origin. HTTP still returns `custodyChain` when the fold is complete; the read contract already fail-closes when that field is absent.

### 12.9 Unlock = crown-jewel

The home-unlock path is **asset-custodial** (a forged unlock steals a real NFT); the §7.6 "data integrity, not fund loss" framing does **not** apply to unlock. Before any mainnet unlock pathway: ≥3 independent DVNs, Timelock48h as OApp config owner, no default libraries, monitoring live.

### 12.10 84532 hub migration (testnet) — Nuclear

`KarPassport` is immutable; commerce **modes** are UUPS. **Nuclear #4** (August 2, 2026) redeployed the full stack (passport + modes + gateway) on both 84532 and 11155111; Nuclear #3 and earlier stacks are denylisted. Ponder full-reindexed from hub **44957457** / Eth **11404204**. Empty-testnet passports from prior stacks were abandoned (no user value).

### 12.11 Recovery (Approach A) — kill then restore

If a bridge message is permanently undeliverable, a home-origin passport can be stranded locked in the gateway (`ownerOf == gateway`, `custodyLocked`). Restoration is **governed**, not a user one-click:

1. **Kill** the stuck inbound on the destination LayerZero EndpointV2 (`skip` / `nilify` / `burn` / `clear` as applicable). Callable by the OApp or its **delegate** — production delegate is **Timelock48h**. No new Kargain contract code for the kill side.
2. **Restore** on the home chain: `KarPassportBridgeGateway.recoverLockedHome(tokenId, to)` (`onlyOwner`; production owner = Timelock48h). Requires home-origin id and that the gateway holds the token; calls `bridgeResetOnUnlock(tokenId, "")` then `transferFrom` to `to`; emits `RecoveredLockedHome`. **No mint/burn path.**

**Contract guarantee:** `recoverLockedHome` can only release one token the gateway already custodies — structurally incapable of minting a duplicate home instance.

**Governed guarantee:** cross-chain non-duplication depends on step 1 preceding step 2 (observers get the 48h Timelock delay). This is the standard ONFT recovery model.

Procedure: [ops/recovery-bridge.md](../ops/recovery-bridge.md). Hardhat gate: gateway suite **#10** (blocks live C2 cutover until green).

### 12.12 Cross-chain address identity

Contract addresses are **not** unique across networks. The same CREATE address hex can appear on different chains when one deployer hits the same nonce (observed: Base Sepolia historical adapter vs Ethereum Sepolia retired Nuclear #2 KarPassport `0xC219…6Fb0`; earlier Base historical vs Eth July 21 Nuclear KarPassport `0x637846…4507` / MarketplaceEscrow `0x4FC74e…198B`).

**Normative:**

- Every off-chain identify / filter of protocol contracts **must** use `(chainId, address)` — never an address string alone. For non-EVM commercial chains, `address` is the chain-native account encoding (not assumed hex); parsing and comparison are VM-aware ([§I.13](#i13-non-evm-commercial-chains-and-the-protocol-parameter-model-normative)).
- Denylist, address resolvers, and indexer compound keys are **per-chain**.
- Today's `SEPOLIA_HISTORICAL_DENYLIST` is **84532-only**; `kargainContractDenylist(chainId)` builds per-chain lists from `COMMERCIAL_ACTIVE` + that historical set. Applying Base historical addresses chain-blind would treat live 11155111 contracts as abandoned.

**Hard requirements for upcoming work:**

- **C3 (indexer):** entity / API keys include `chainId` (no address-only identity across commercial chains).
- **C4 (app):** messaging/profile denylist is per-chain via `kargainContractDenylist(chainId)` (C4.1); do not reuse Base historical addresses for other `chainId`s.

---

---

### I.13. Non-EVM commercial chains and the protocol parameter model (normative)

> **Scope.** Extends [§I.12](#i12-multi-chain-architecture-normative) for commercial chains whose execution environment is not the EVM, and states the protocol-wide parameter and money model that every commercial chain (EVM and non-EVM) must obey. LayerZero pathway security remains [§7.6](#76-layerzero-security-configuration-normative). Where this section and §I.12 conflict on namespace identity, wire format, star routing, or non-EVM address identity, **this section wins**; custody/trust/metadata invariants §12.2–§12.5 are restated as binding with no exception.

#### 13.1 Chain namespace registry

Extends §12.1 identity. Supersedes the assumption that the high 128 bits of `tokenId` are always an EIP-155 chain id.

- High 128 bits of `tokenId` are a **Kargain chain namespace**. EVM commercial chains use their EIP-155 id (84532, 11155111, …).
- Non-EVM commercial chains use the reserved band **`2_000_000_000 … 2_147_483_647`**, allocated as **`2_000_000_000 + LayerZero EID`**.
- First allocation: Solana Devnet LayerZero EID **40168** → namespace **`2_000_040_168`**.
- **Commercial stack registry** (`COMMERCIAL_ACTIVE` in app code): keyed by **namespace**. An EVM row’s key equals its EIP-155 id; a non-EVM row’s key is its reserved-band namespace (never a fabricated EIP-155). A reserved namespace **without** a registry row is not a commercial network — tooling and UI must fail closed (no selectable chain, no silent hub fallback).
- **Why the upper bound:** every Ponder `chainId` / `custodyChain` column in `ponder.schema.ts` is `t.integer()` → Postgres `integer` (int4) max **2_147_483_647**. The band must stay inside that type so indexer keys remain exact.
- **Why below 2^53:** JavaScript `Number` is IEEE-754 float with a 53-bit integer mantissa; namespaces must remain exactly representable in client and Node tooling without BigInt-only paths for every filter.
- **Disjointness:** no EVM commercial EIP-155 id may fall in the reserved band; no two commercial chains may share a namespace. Enforced as a `test:verify` obligation on the commercial stack registry.

#### 13.2 Why the deployed EVM stack needs no change for interop

Load-bearing facts (do not “fix” them for SVM):

- Gateway `_isHome(tokenId)` ⇔ `(tokenId >> 128) == block.chainid` (`KarPassportBridgeGateway`).
- `bridgeMint` / `bridgeBurn` refuse when `chainIdOf(tokenId) == block.chainid` (foreign-only); home paths use lock/unlock.

A Solana-origin token has namespace `2_000_040_168 ≠ 84532` and `≠ 11155111`, so every live EVM gateway already treats it as foreign: mint/burn representation paths apply; home lock/unlock paths do not. **Interop with a new namespace requires no bytecode change on existing EVM passports/gateways** for the home/foreign branch — only peers, pathways, and destination programs.

#### 13.3 Wire format (ONFT721 message)

Extends §12.5 (URI travels). Codec as compiled in `@layerzerolabs/onft-evm` `ONFT721MsgCodec.sol`:

| Region | Bytes | Constant | Content |
|--------|-------|----------|---------|
| `sendTo` | `[0, 32)` | `SEND_TO_OFFSET = 32` | 32-byte recipient key |
| `tokenId` | `[32, 64)` | `TOKEN_ID_OFFSET = 64` | `uint256` tokenId |
| compose payload | `[64, …)` | length > 64 ⇒ `isComposed()` | ONFT compose extension |

- `composeMsg` after the 32-byte `composeFrom` sender prefix is a Solidity **ABI-encoded `string`** (the URI). Kargain’s gateway always builds `composeMsg = abi.encode(uri)` so the message is composed whenever encode reports compose; **`SEND` vs `SEND_AND_COMPOSE` is selected in Executor options**, not by omitting URI bytes.
- **`composeFrom` semantics (non-authorizing):** the 32-byte prefix is the **EOA that invoked `send()`** on the source chain (`ONFT721MsgCodec.encode` uses `msg.sender`). It is **not** the source OApp/gateway identity. **No receiver on any VM may authorize** based on `composeFrom` — peer authorization uses LayerZero **`Origin.sender`** alone. Rust/TS decoders may skip these bytes; test and fixture corpus values for `composeFrom` are **arbitrary by design** once this rule is in force — do not re-derive them as source identity.
- Receiver skips exactly **32** bytes of sender (`_SENDER_BYTES`) before `abi.decode(..., (string))`.
- Non-EVM → EVM: left-pad a 20-byte EVM address into `sendTo`. EVM → non-EVM: write the full 32-byte destination key unchanged.
- `KarPassportBridgeGateway` **overrides `_lzReceive`** and **does not call `sendCompose`**; compose data is carried in the ONFT message body and consumed in-gateway.

#### 13.3a Metadata transport

Extends §12.5 / §12.8. Three classes:

| Class | Travels? |
|-------|----------|
| Content bytes on Arweave (or equivalent) | No |
| URI pointer | Yes — every message, both directions |
| Records / URI history / verification status | No — chain-sharded; indexer unions per §12.8 |

**Ordering invariant:** URI is read **before** debit (`KarPassportBridgeGateway.send`: `tokenURI` then `_debit`). Reason: foreign `bridgeBurn` must not clear metadata mid-send.

**Compose on send:** a non-EVM sender MUST always build compose (same obligation as the live EVM gateway).

**Live EVM receive when compose is absent or tail ≤ 32 bytes** (read `_lzReceive`): `uri` stays the empty string `""`; **mint or unlock still proceeds**. This is **not** fail-closed on the EVM gateway. A non-EVM receiver **MAY** be strictly fail-closed on absent/short compose — named asymmetry (preserves I3 metadata authority by refusing a silent empty write at destination policy).

**Empty URI on unlock:** `bridgeResetOnUnlock` adopts URI only when `bytes(uri).length > 0`; empty means **do not change** home URI. Production path that intentionally unlocks with empty URI: `recoverLockedHome` (Approach A, §12.11).

**Destination budget:** if the destination execution budget cannot cover the full URI, **refuse the send — never truncate** the pointer (§12.9 / I7: truncation forges metadata on a custodial path).

#### 13.4 Executor options by destination class

| Destination class | `gas` meaning | `value` |
|-------------------|---------------|---------|
| EVM | EVM gas | zero |
| Non-EVM | destination execution budget | funds rent for accounts created during receive |

**`combineOptions` (read `OAppOptionsType3.combineOptions`):** if no enforced options, return caller `_extraOptions` (even empty/legacy); if no caller options, return enforced; if both, require type-3 extras, then **`bytes.concat(enforced, _extraOptions[2:])`** — append extra option bytes after stripping the 2-byte type prefix from extras. NatSpec documents that duplicated lzReceive gas/value options are **combined additively off-chain by verifier/executor**; the Solidity function itself concatenates option payloads, it does not arithmetic-sum gas fields on-chain.

**URI ceiling (normative — Nuclear #6):** **160** UTF-8 bytes.

| Layer | Owner |
|-------|--------|
| Canonical constant | `lib/web3/declared-uri-ceiling.ts` → `DECLARED_PASSPORT_URI_CEILING_BYTES` |
| Solidity mirror | `contracts/lib/PassportUriCeiling.sol` → `BYTES` (sole Solidity literal) |
| Rust mirror | `svm/crates/kargain-errors` → `PASSPORT_URI_CEILING_BYTES` (sole Rust literal) |

**Enforced at:**

1. **Passport write** — sole `_setTokenURI` wrapper (`_setTokenURIChecked`); refuses with `UriTooLong(length, max)`. Covers `mintPassport`, `setPassportURI`, `bridgeMint`, and non-empty `bridgeResetOnUnlock` adopt. Empty unlock URI skips the setter (no length check).
2. **Gateway leave / quote** — `_buildMsgAndOptionsWithUri` (covers `send` and `quoteSend`); refuses with `UriExceedsBridgeCeiling(length, max)` **before** debit / fee consumption. Distinct from write `UriTooLong`.
3. **SVM** — passport mint / `set_passport_uri` → `UriTooLong`; gateway send → `UriExceedsBridgeCeiling`.
4. **Client** — `lib/web3/bridge/lz-receive-gas.ts` consumes the declared ceiling (refuse quote/send UX when over).

**Coupled rules (restated for 160):** (1) every commercial VM’s local URI-write cap equals this ceiling; (2) receive budgets assume messages that already cleared send-side ceiling; (3) **receive never rejects solely on URI length** — a message that arrived already fitted a destination tx (EVM gas path or Solana packet).

**EVM receive gas model** (documentation of headroom, not a second ceiling): from `lib/web3/bridge/lz-receive-gas.ts`:

`required = max(ENFORCED_GAS_SEND_AND_COMPOSE, ceil((LZ_RECEIVE_GAS_BASE + len × LZ_RECEIVE_GAS_PER_URI_BYTE) × (10_000 + LZ_RECEIVE_GAS_MARGIN_BPS) / 10_000))` with floor **250_000**, base **137_973**, per-byte **1_000**, margin **1_500** bps, cap **1_000_000**.

- `len = 160` → required **342_669** ≤ cap (and ≤ historical off-chain “731” gas model).
- Historical measure `len = 731` → required **999_319** ≤ cap; that figure is **not** the product ceiling.

**Headroom derivation (S4a-2 h=3, no ALT):** production foreign-mint account list **18** metas → assembled size at URI=160 **1208** ≤ Solana packet **1232** (margin **+24**). Mock stand list (13 metas) measures smaller — do not equate to 1208. See `svm/lab/RESULTS.md` S4a-1/S4a-2/N6-4.

**ALT asymmetry (normative — Solana):**

| Direction | ALT | Oversize consequence |
|-----------|-----|----------------------|
| **Receive** (hub→Solana `lzReceive`) | **Forbidden** for the product path | Assembled tx >1232 is permanently unexecutable without ALT/split → custody stranded on home; exit only via admin `recoverLockedHome` (D-20) |
| **Send** (Solana→hub) | **Permitted** | Oversize fails **locally before debit** → user retries; no stranded foreign custody from tx-size alone |

**Durable ALT authority:** any **shared long-lived** Address Lookup Table that a product send path depends on MUST NOT be closeable by a single hot key. Authority = multisig/timelock (or recreate-per-tx with **no** shared dependency). Test tooling MAY create ephemeral per-send ALTs under the deployer; that pattern MUST NOT be promoted to a durable product dependency. Closing/deactivating a required durable ALT breaks every v0 send that references it.

**Executor / committer stall (product condition — UI owner = S8):** a message MAY be DVN-verified and still not executed (testnet committer lag or executor skip). The product UI MUST surface that state and offer an action (commit / execute or equivalent). Tooling nudges in `pnpm svm:y5-rt` are **not** the product path.

#### 13.5 Star topology with N spokes

Extends §12.1 routing; amends §7.6 allowlist wording.

- Hub: EID **40245** (Base Sepolia). Spokes: **40161** (Ethereum Sepolia), **40168** (Solana Devnet — S4b COMPLETE; no commercial registry row until S9).
- Spoke↔spoke peers **forbidden**.
- Spoke↔spoke transfer = **two user transactions**: spoke A → hub, then hub → spoke B. UI MUST present two hops. §12.2 holds at every step: after hop 1 usable instance is on the hub; after hop 2 on spoke B; never two usable instances.
- Required-DVN sets and confirmations are **per pathway** (minimum 2 independent operators on testnet; 3–5 on mainnet per §7.6). A new pathway’s operator set is chosen from the pinned snapshot for **both** ends — never copied from an existing pathway. A pathway whose snapshot does not expose two independent DVNs present at both ends is refused; the 1-of-1 prohibition admits **no** non-EVM exception (§7.6 + §13.13).

#### 13.6 Trust, custody-lock, metadata authority

Restates §12.3, §12.4, §12.5 as binding with **no** exception on any commercial VM.

On a chain whose NFT substrate offers a freeze primitive: custody-lock is **program state checked by every mutating instruction**; freeze is a **second layer** against transfers outside the program — **never a substitute**, because freezing does not block metadata update. Where the substrate uses a permanent freeze plugin, the plugin MAY remain attached with `frozen=false` at rest; freeze authority that must act in-program is a **program PDA** (a bare program id cannot ed25519-sign).

#### 13.7 Encumbrance without read-only cross-program calls

Extends §12.6 / encumbrance E1–E6.

- The answer belongs to the **source**. Each registered source maintains an answer record at an address derived from a registry-declared seed under its own program; the passport derives that address per currently registered source and reads it.
- Map: **E1** register sources; **E4** add/remove; **E5** intrinsic challenge forbids without self-registry; **E6** unanswerable → named refuse (`SourceUnanswerable` / equivalent).
- Uninitialised record = no obligation. Wrong owning program, wrong discriminator, or insufficient data = unanswerable.
- **`may` does not consult `custodyLocked`** (`KarPassport.may`: exists → active challenge → staticcall sources). A locked home token is prevented from leaving by **custody** (gateway owns the NFT after lock) plus `_requireNotBridgedAway` on owner trust-mutating paths — not by `may`.
- Encumbrance is the **secondary** guard; custody is **primary**. `AscendingConsignment.may` answers on **unresolved settlement**, not on “live lot exists.”

#### 13.7a Active-verifier proof without read-only CPI (S5)

Same answer-account pattern as §13.7, applied to verifier status:

- Sole owner of “is active verifier” is the **staking** program’s stake account at PDA `["stake", verifier]`.
- `verify_passport` accepts that account only when: (1) owner program == passport config’s `staking_program`; (2) discriminator and length match the stake layout; (3) account key equals the PDA re-derived from that seed **and the signing verifier**; (4) `active == true`. Failures (1)–(3) → `SourceUnanswerable`; (4) → `NotActiveVerifier`. Never treat a substitution as silent inactive.
- Self-verify compares the signer to the Metaplex Core asset **owner** field (not a copied owner in passport state).
- **No** active-verifier registry on the passport.

**Pass as projection (leave divergence):** On EVM, `KarProStaking.leave` wraps pass burn in try/catch so unbonding always starts. Solana has no equivalent — a failing CPI would abort leave and trap stake. Therefore the soulbound pass is minted on join and closed by a **separate** instruction; `leave` writes stake state only (`active = false`, unbond clock, clear `verificationFee`). Every reader of verifier status reads the stake account and never the pass.

**Pair init:** staking and pass initialise together and bind each other (Nuclear A3 retarget trap shape: a pass bound to a replaced staking program leaves holders unable to leave or re-join).

**SVM `SetStakingProgram`:** EVM passport binds staking immutably in the constructor. On SVM, config authority may set `staking_program` (testnet migration mock→commercial and A3 pair swap). Refuse zero.

#### 13.8 Governance and upgradeability

- EVM today: KarPassport, KarProPass, KarProStaking **immutable**; FixedPrice / Ascending **UUPS**.
- On BPF: equivalent of immutability is **revoking upgrade authority**, which also removes defect-fix without redeploy.
- **Testnet hot-role split (refinement):** **upgrade authority** = bytecode replace for `kar_passport` / `kar_gateway` / commercial SVM programs — **deployer pubkey** for S4–S8 (`SOLANA_UPGRADE_AUTHORITY` in `.env` **must equal** the pubkey of `SOLANA_DEPLOYER_PRIVATE_KEY`; same simplest-testnet pattern as EVM). **Gateway config authority** = peers / `recoverLockedHome` / bind — deployer hot key on testnet, same class as EVM §7.6 Phase 2 **(b)** hot gateway owner. Do not conflate the two roles. Handing upgrade authority to an unreachable pubkey (especially with `--skip-new-upgrade-authority-signer-check`) locks programs (X3 + Y5-frozen abandon). Standing runbook: `docs/ops/deploys/svm-devnet.md`. Evidence honesty: `pnpm verify:svm-authority`.
- **Commercial mainnet:** §7.6 Phase 2 **(b)** cold/multisig obligation applies to **both** upgrade authority and gateway config authority — gateway config MUST NOT remain forever on a single hot key. Revocation / cold cutover: §7.6 Phase 2 **(f)** — co-signed only; never skip-signer.

#### 13.9 Key roles and the treasury

Normative deploy law:

| Role | Temperature | On-chain surface |
|------|-------------|------------------|
| Fee sink | Cold | Modes `platformRecipient` |
| Forfeit sink | Cold | Passport `platformRecipient` (forfeit alias) + Ascending `forfeitRecipient` |
| Guardian | Hot | Modes `guardian` (`setGuardian` under Timelock) |

Three **distinct** accounts. Sinks are **immutable by design** (Accepted risk: *`platformRecipient` immutable — Wrong address at deploy is permanent; verify before deploy*). Rotation = smart account whose **signers** rotate without changing the on-chain address. Deploy-time: a native push to each cold sink MUST succeed within `NATIVE_PUSH_GAS` (**30_000**); otherwise every payout silently becomes a claim (`ClaimablePayouts`). **No recipient setter** is added: the passport is not upgradeable; a Timelock setter would widen that containment boundary.

#### 13.10 Protocol parameter model (three tiers)

Protocol-wide (not SVM-specific). **N5 source (S3.5 prep):** seven Ascending bounds + settlement challenge window are **model constants** in bytecode; bond stays weight-derived via `setChallengeBond`. **Live Nuclear #4:** bounds remain Timelock-mutable via `setAuctionRules` until cutover.

| Tier | Examples | Where / how changed |
|------|----------|---------------------|
| **Model constants** | Auction duration bounds, extension window, min increment bps, protection bounds, abandonment window, settlement challenge window; already-constant `DISPUTE_WINDOW`, recall cooldown, unbonding period; **`MIN_STAKE_FLOOR`** (on generation v2 EVM the sybil floor is pinned in bytecode at the ETH-denominated weight) | Implementation bytecode; identical on every chain; change by SPEC revision + redeploy/upgrade — **not** a Timelock knob |
| **Locally governed** | Payment tokens, feeds, staleness, guardian, encumbrance sources, gateway bind | Each chain’s own Timelock; non-portable |
| **Weight-derived** | `minStakeNative`, verification `disputeDeposit`, ascending settlement `challengeBond` | Native storage per chain; derived from declared weight |

**Declared economic weight (unit ETH)** — intentional amounts (Nuclear #4 live law):

| Parameter | Weight (ETH) |
|-----------|--------------|
| `minStakeNative` | **0.05** |
| `MIN_STAKE_FLOOR` | **0.001** |
| Verification `disputeDeposit` | **0.01** |
| Ascending settlement `challengeBond` | **0.01** |

On ETH-native chains the on-chain wei equals the weight. Elsewhere derive native amounts via a script that reads **only on-chain** FX sources and records result, source, address, and block/slot in the manifest. **Non-EVM testnet:** the minimum may be a **stated constant** of the same order as the declared ETH weight — record it as such in deploy evidence (`minStakePin`), not as an FX observation. **Mainnet:** must be derived from an observed on-chain rate with source + address/slot + timestamp, and **re-derived at every redeploy**. Pin the result in staking config (`min_stake_lamports` / floor). Join never quotes an exchange rate. `test:verify` checks every commercial manifest against this table within a stated tolerance band. **No quotation appears in any stake/bond instruction** — the bond requires an exact amount, the buyer’s protection window is finite, and a challenge that cannot open is a remedy lost irreversibly. Bids, prices, floors, bps shares, and second-denominated windows are never FX-converted. **Unit-change rule:** switching the declared unit (e.g. ETH→BTC) costs one sentence in this section and one derive-script branch — **zero** contract change, because no contract stores a unit tag. **No chain is a parameter anchor or remote writer.** Cross-chain parameter push is outside this section and requires its own security review if ever proposed.

#### 13.11 Money vocabulary

On every commercial chain: native gas token carries gas, verifier stake, challenge bonds, and the informational `verificationFee`; price / bid / floor / checkout use that chain’s native token or an admitted stablecoin-class payment token; the verifier credential is a soulbound NFT and not money. Kargain issues **no** fungible token of its own. Wrapping native solely to satisfy a token standard for stake/bonds is forbidden. **Verifier join is native-only** on N5 source (ERC-20 stake path removed). Live Nuclear #4 bytecode still carries a dormant token path that was never enabled and is deleted at N5 cutover.

#### 13.12 Indexer projection rebuild

A non-EVM projection is rebuilt from the indexer’s own append-only **raw** layer, never from chain history depth (public endpoints are not a production history guarantee; shipping model remains schema change → full reindex). Catch-up applies only within a bounded lag window; exceeding it is an incident. The raw layer has exactly one writer and is never rewritten.

**Usable-copy location (I1).** Derive at read from guid-linked crossings across the EVM and SVM append-only streams (§12.8). Do not compare `block.timestamp` to Solana `Clock` to decide custody. Incomplete chain → unresolved (same fail-closed class as a missing `custodyChain` on the HTTP passport), not origin. One module owns the fold; routes do not recompute it.

#### 13.13 §7.6 applied to a non-EVM pathway

Every §7.6 rule binds unchanged. Additions: pathway refused if the pinned snapshot does not expose two independent DVN operators **present at both ends**; 1-of-1 has no non-EVM exception. §12.9 (unlock = crown-jewel) applies identically to a non-EVM home unlock.

#### 13.14 Named divergences

Each entry: mechanism may differ; named invariant preserved. A divergence without a preserved invariant is a defect.

| # | Non-EVM / port note | EVM counterpart | Preserved invariant |
|---|---------------------|-----------------|---------------------|
| D-01 | Claims exist for the **admitted SPL asset** only. A native lamport credit from a program-owned account cannot fail on this substrate, so there is **no** native-push→claim branch (including stake `ClaimStake`). For SPL settlement legs, **payout reachability is decided before any transfer CPI** — from the recipient token-account state (existence, owning token program, layout, mint, initialisation, **freeze**). **Frozen** accounts are unreachable: the Token program refuses inbound transfer (`0x11` — measured on local validator). Unreachable → credit claim and move tokens to the claim ATA **without attempting** a transfer to the recipient. Reachable → transfer. **Attempt-then-catch is impossible here:** a failing CPI aborts the whole transaction (same substrate fact as §13.7a / D-21 — “Solana has no equivalent — a failing CPI would abort leave and trap stake”). | ClaimablePayouts after failed native or ERC-20 push | **I5** — settlement completes; unpaid SPL → claim; native always lands |
| D-02 | No reentrancy-guard construct | OZ `ReentrancyGuard` | Single-entry critical sections by program design |
| D-03 | Libraries merged (no EIP-170 split) | Ascending Open/Hold libs | Same external behavior / event order |
| D-04 | Account layout: each money-bearing PDA holds value for one party/purpose (claim `(recipient, mint)` amount field; challenge-subject bond lamports; consignment escrow). Amounts are never inferred from an unrelated account’s lamports. No program-global pending/locked totals; no `rescueExcess` — nothing is unattributable. | `msg.value` / pull + mapping claims + rescue over free balance | Exact-bond / exact-credit accounting; I5 |
| D-05 | Clock source (slot/time) | `block.timestamp` | Window maths in seconds as specified |
| D-06 | Upgrade authority vs immutability | Immutable passport / UUPS modes | §13.8 + §7.6 (f) |
| D-07 | Oracle + confidence bound: sole owner `kargain-price` decodes `PriceUpdateV2_msg@41` (134 B; disc soft-check). Purchase refuses **StalePrice**, **BadOracleAnswer**, and **ConfidenceTooWide** (SVM-only named; not folded into StalePrice). Admit pins `price_program` + `feed_id` + staleness ∈ [60, 259200] + `max_confidence_bps`. LIVE negatives prove decoder+gates on lab-owned mirror accounts — not vendor feed mutation. Mainnet pins must be **re-derived** from observation (not Devnet medians). | Chainlink + staleness (no conf field) | P4-class freshness; D-07 confidence rule on SVM |
| D-08 | `SourceUnanswerable` mechanism | staticcall gas + returndata | E6 — silence ≠ permission |
| D-09 | Escrow approval carrier — see **D-25** (approval = TransferDelegate / `approved_for`; custody = ownership transfer) | ERC-721 approve / setApprovalForAll | Custody before open |
| D-10 | Record storage | `records[]` | §12.8 chain-sharded history |
| D-11 | Credential non-transferability | soulbound `_update` | One pass per address; freeze ≠ full substitute |
| D-12 | No ERC-165 / receiver callbacks as on EVM | IERC721Receiver | Safe mint/transfer semantics named |
| D-13 | No Solidity storage gaps | `__gap` | Layout discipline per program |
| D-14 | `may` ignores custody-lock | same on EVM | Custody primary; encumbrance secondary |
| D-15 | Native amounts only for stake/bonds | `address(0)` wei | §13.10–§13.11 |
| D-16 | Receive may fail-closed on absent compose | EVM leaves `uri=""` and continues | I3 — named asymmetry |
| D-17 | Records/passport **state** survive burn of representation; mint existence = live Core asset account (a one-byte Core burn tombstone still owned by Core is **not** a live asset — remint must not be refused by leftover state PDA) | `bridgeBurn` leaves `records[]`; `_ownerOf` / `_requireExists` | §12.8; TokenExists ≠ state PDA |
| D-18 | Gateway bind one-shot vs staking rebind | `setBridgeGateway` vs `setStaking` | §12.7 corrected prose |
| D-19 | Namespace ≠ EIP-155 | EVM chainId-as-namespace | §13.1 / I1 uniqueness |
| D-20 | Over-ceiling URI on **inbound** receive | — | **EVM:** OOG on `EndpointV2.lzReceive` is **retryable** (atomic clear+execute; pin LayerZero-v2 `9c741e7f…`). **SVM:** assembled tx **>1232** is **permanently unexecutable** without ALT/split. Product ceiling **160** (Nuclear #6) keeps production no-ALT path ≤1232 (S4a-1/S4a-2 / N6-4). Receive still never length-rejects. |
| D-21 | Pass close separate from leave (no try/catch) — same substrate reason as D-01: a failing CPI aborts the instruction (§13.7a) | `leave` try/catch burn | Unbonding always starts; `active` sole status owner; pass is projection (§13.7a) |
| D-22 | Caller must supply payout recipient accounts; program verifies each **non-zero** leg (platform ← mode config; seller/agent ← consignment snapshot; fee bps ← **lot snapshot**). Wrong account → `Wrong{Platform,Seller,Agent}Recipient`; required absent → `Missing{Platform,Seller,Agent}Recipient`. Zero leg needs no account. | Recipients read from storage in `_paySplit` | No silent skip of a non-zero leg (theft of that leg) |
| D-23 | When an SPL leg is unreachable, the settling instruction creates the **claim record PDA and the claim-owned token account** in the same transaction. Rent for **both** is funded by the settlement **fee-payer**; on `withdrawClaim` close of the claim ATA and claim PDA, the **recipient** reclaims that rent. Token legs are never reduced to fund rent. | EVM storage has no per-claim rent | No shortened participant payout; no unattributable lamports |
| D-24 | Mode refuses the shared open signature without Solidity virtual override: mode program exposes `openDirect`/`openFromMandate` discriminators only as immediate `AscendingOpenPath` (same error name), and provides mode-specific opens that call shared `_write_open` internals. | `AscendingConsignment` `pure override` → `AscendingOpenPath` | Wrong entry refuses by name; real open check order unchanged |
| D-25 | Escrow **approval** carrier = Core `TransferDelegate` (or harness `approved_for`) toward the mode custody authority. Escrow **custody** = real ownership transfer (`TransferV1` / harness `owner` field move) to a program-owned custody PDA — never leaving the asset under seller+delegate as “in escrow.” Frozen Core assets refuse transfer (lab); open fails closed. | ERC-721 `approve` / `setApprovalForAll` then `transferFrom` | D-09 — custody before open; approval ≠ custody |
| D-26 | Encumbrance answers are **cross-program PDAs** (`EncumbranceAnswer`); passport `may` reads them. Shared hooks `_may` / `_isSelfEncumbranceSource` are supplied by the mode/harness call site. | Same-contract `isEncumbranceSource` + `may` staticcall | E6 / D-08 — silence ≠ permission |
| D-27 | Lot snapshot mutation at settle (FixedPrice fiat floor rewrite to asset units) is a **mode** call through shared `set_snapshot_floor` before split/pay. Shared layer never invents a second floor path. Scale via `agented_floor_scale_base` (Margin/Commission) then `floor_asset = base_asset * floor / base_fiat`. | FixedPrice `buy` mutates floor then `_paySplit` | One floor owner; settle uses lot snapshot fee bps + mode config `platformRecipient` |
| D-28 | Programs emit **structured** payloads (`sol_log_data` / program-data logs — not `msg!` strings) with the **same event name and field order** as the Solidity `event` declaration (indexed EVM fields still appear in the body: SVM has no topics). Type widths follow the encoding table below — that table is **encoding**, not a behavioural divergence. **Log budget:** the runtime truncates a transaction’s logs; a truncated tail is silent loss (same class as D-20 unexecutable tx and D-01 aborted CPI). The heaviest instruction (three reachable split legs + `ClaimRecorded` + phase/close) must be **measured** on a local validator; if it can hit the cap, S7a chooses split encoding or account-state facts **before** ingest. **Measured:** see `svm/lab/RESULTS.md` §S7a (fixture `measure-heaviest-settle`, ix `Buy`; `getTransaction` json + base64 `Program data:` decode, fail-closed). | Solidity `event` ABI + log bloom | Indexer reconstructability; I5 outcomes visible |
| D-29 | FixedPrice P4 two-layer: fiat offered **iff** payment-token feed path pinned at admit (`feed_id` non-zero). Asset-only admit (zeros) → Fiat open → `PaymentTokenFeedRequired`. Native fiat refused while config has no native USD feed → `CurrencyNotAvailableOnChain`. Ascending remains oracle-banned (`FiatDenominationRefused`). No Hermes/HTTP; price account in settling tx. | Fiat + Chainlink quote at buy | P4 asymmetry — no silent peg / no “fiat off because crank stopped” |
| D-30 | **Two rules, one money crate.** (1) **Admit:** `require_admitted_spl_mint_account` proves mint (owner Token\|Token-2022; classic 82-byte OK; Token-2022 TLV@166 after AccountType@165; TransferFee → `TransferFeeExtensionForbidden`; decimals from mint byte 44 — never ix args). (2) **Pull delivery:** every SPL pull into mode escrow (FixedPrice buy now; Ascending bid in S6 #4) measures ATA balance delta via `require_full_delivery` → `ShortDelivery` if under-delivered. Not a second TransferFee parser — measured amount vs requested. Closes admit-regression class (e.g. wrong TLV walk that wrongly admitted a fee mint). Soft-revoke does not re-check `enabled` on buy. EVM: no FoT ban at admit, ShortDelivery is primary; SVM: FoT ban at admit **and** delivery measure on pull. | ERC-20 `balanceOf` delta | Admit properties + pull delivery; no dead `require_full_delivery` |
| D-31 | Soft revoke clears `enabled` only; mint/decimals retained; in-flight buy settles after revoke. | Same | In-flight settle survives revoke |
| D-32 | `confirmExternalPayment` issues no pay CPI; money accounts unchanged (asserted by balance reads). Closes `ExternalConfirmed`. | No `_paySplit` on external path | R4 / C7 — external moves asset + closes only |
| D-33 | Ascending **two vessels** per lot: (1) escrow PDA (+ SPL ATA) holds bid/gross in settlement asset; (2) challenge PDA holds **native lamports** bond even for SPL lots. Separate rent funders/reclaimers (opener / challenger / fee-payer). | Single EVM contract balance | Named rent; no leg shortened for rent |
| D-34 | Settle is **one instruction**: close auction PDA (rent → fee-payer) + create hold PDA + release custody to buyer. **No money move** (escrow lamports/tokens asserted unchanged). `abandonmentWindow` copied into Hold; `abandonmentDeadline` stays 0 until uphold. | `AscendingHoldLib.settle` | Auction gone ⇒ window must live on Hold; lamport conservation measurable |
| D-35 | Outbid unreachable prior bidder: classify → claim (D-01); claim PDA+ATA rent funded by **new bidder** (bid fee-payer); prior reclaim on withdraw (D-23). Not attempt-then-catch. | EVM `_payNative`/`_payErc20` → claim | Settlement completes; rent attributable |
| D-36 | Ascending encumbrance `may`: unresolved Hold (`buyer != 0`) forbids **both** LeaveChain and OpenConsignment intents (same as EVM). Published for passport via mode/harness answer. | `AscendingConsignment.may` | E6 — hold blocks both intents |
| D-37 | Frozen protection clock: challenge open sets `frozenRemaining = protectionEndsAt - now` without zeroing `protectionEndsAt`; withdraw restores `protectionEndsAt = now + frozenRemaining`; uphold atomically sets `reversalPending`, zeros protection+frozen, sets `abandonmentDeadline = now + abandonmentWindow`. No durable gap with protection 0 and abandonment unset. | HoldLib freeze/thaw/onUpheld | Observable before/after reads; no startReversal API |
| D-38 | `VerificationLapsed` — EVM-emitted verification terminal; **no Ponder handler** (out of census). SVM emits via `passport_terminal` with same field order as Solidity (`tokenId` only). | KarPassport verification lapse | Structured payload identity (`tokenId` only); no indexer projection required |
| D-39 | `VerificationStood` — same class as D-38 for verification stood terminal. SVM `passport_terminal`; field order matches Solidity (`tokenId` only). | KarPassport verification stood | Structured payload identity (`tokenId` only); no indexer projection required |
| D-40 | `CurrencyFeedSet` — EVM admin feed table emit; **SVM has no equivalent log** (feed pinned per payment-token at admit — D-29). Census row retained for EVM indexer parity. | FixedPrice `setCurrencyFeed` | **P4 (D-29):** fiat offered iff feed path pinned at payment-token admit; no second mode-global currency-feed config surface on SVM |
| D-41 | `NativeUsdStalenessToleranceSet` — EVM mode-global native-USD staleness admin emit. On SVM, oracle freshness/confidence is pinned **per admitted payment token** at admit (D-07: staleness ∈ [60, 259200]); native USD has no on-chain feed path (D-29). | FixedPrice `setNativeUsdStalenessTolerance` | **D-07 + D-29:** staleness is a property of the admitted feed record, not a mode-global admin knob; native USD feed admin surface absent on SVM |
| D-42 | `ProfileUpdated` on KarProPass — EVM emit on profile write. SVM pass holds no separate profile authority. | KarProPass `updateProfile` | **D-21:** pass is projection only; sole verifier-status owner is stake PDA `active` — no KarPro profile emit path on SVM |
| D-43 | EVM custom errors may carry typed parameters (`EmptyField(string fieldName)`, …); SVM answers with the **same error name** as an ordinal only — parameters do not travel in the refusal surface. | Solidity `error` ABI | **Same refusal name**; UI/copy uses static name-based messages; no parameter-dependent SVM payload |

**Event payload encoding (not a divergence).** D-28 “same field order” is checkable only with one type map. SVM payloads use the **domain type already chosen for that value in account state**, not a second widening “to look like uint256”. HTTP / projection encoding of addresses (hex vs base58) is a later VM-aware layer; on-chain payload identity is:

| Solidity ABI field | SVM payload | Rule |
|--------------------|-------------|------|
| `address` | `[u8; 32]` pubkey | Party on this VM. **Not** a left-padded 20-byte EVM address. |
| `uint256 tokenId` / `subjectId` | `[u8; 32]` | Big-endian `(namespace \|\| local)` — same as the ONFT codec. |
| `bytes32` (`guid`, `currencyCode`) | `[u8; 32]` | Identity copy. |
| Money / price / floor / bond already `u64` in SVM accounts (`uint128`/`uint256` on EVM) | `u64` | Domain is u64 (D-04). Intermediate `u128` exists only inside split arithmetic, not in the log. |
| Time / window already `u64` seconds (D-05) | `u64` | |
| `uint16` bps | `u16` | |
| Enum / `uint8` ordinal | `u8` | Same Solidity discriminant. |
| `string` (URI, notes) | borsh `String` (u32 LE length + UTF-8) | Value still bound by the URI ceiling (D-20). |

Declaration order includes fields that are `indexed` on EVM. Native settlement asset is `Pubkey::default()` (32 zero bytes), matching EVM `address(0)`.

**SVM money account seeds** (mode / instance program id owns the PDA):

| Account | Seeds | Rent funded by | Rent reclaimed by |
|---------|-------|----------------|-------------------|
| Claim record `(recipient, mint)` | `b"claim" \|\| recipient \|\| mint` | Settlement fee-payer | Recipient on close |
| Claim token account (holds credited SPL) | ATA (or program ATA) owned for the claim | Settlement fee-payer (same ix) | Recipient on withdraw/close |
| Challenge subject (bond) | `b"challenge" \|\| subject_id` | Challenger on open | Challenger on close (bond amount transferred separately to bond recipient) |
| Consignment escrow | `b"escrow" \|\| consignment_id` | Opener (commerce port) | Settle / close path (commerce port) |

**Three-leg rent arithmetic (D-23 worked example).** Margin `S=1000`, `p=250` bps → `P=25`, floor `700` → `O=700`, `A=275`. Seller token account unreachable; platform and agent reachable. Token moves: escrow `1000` → platform ATA `25` + **claim ATA** `700` + agent ATA `275` (sum = `S`). Extra lamports in the same ix: fee-payer pays rent `R_rec` for the claim record PDA and `R_ata` for the claim token account. Both sit on accounts attributable to the seller’s claim; on withdraw the seller receives `700` tokens and reclaimable `R_rec + R_ata`. No participant’s token leg is shortened; the program holds no orphan lamports after the instruction.

#### 13.15 Free testnet dependencies

| Dependency class | Free / public option |
|------------------|----------------------|
| EVM RPC | Public endpoints already used (e.g. base.org, publicnode) |
| Solana RPC | Public Devnet RPC + local `solana-test-validator` for heavy runs |
| LayerZero metadata | `pnpm lz:snapshot` (free API → committed snapshot) |
| Irys / Arweave upload | Devnet / free tier suitable for test pointers |
| Multisig | Squads on Devnet (faucet SOL) / Safe on EVM testnet |
| FX for derive | On-chain price accounts / Chainlink `eth_call` only |

**Rule:** no service without which the protocol cannot be built, deployed, or tested may be a **required** paid dependency on testnet. Dedicated node for commercial mainnet: §7.6 Phase 2 **(g)**.

#### 13.16 Security

- Separate key families per VM; **no** derivation path between EVM and non-EVM keys.
- Private messaging unavailable on a non-EVM account is a **named refusal in the UI**, same gate class as §7.7.
- Part III PII rules bind the indexer raw layer identically — see Part III; not restated here.

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

Normative on-chain rules: **Part I** verification challenge (BondedChallenge instance: 14-day window, party exclusion, Upheld → opener / Rejected|Expired → `platformRecipient`, permissionless `conclude`). Generation v1.x entry points below are historical only.

### On-chain (historical v1.x summary)

- `disputePassport` — VERIFIED → DISPUTED; locks deposit.
- `withdrawDispute` — opener only, before window; → VERIFIED + full refund (superseded by BondedChallenge `withdraw`).
- `resolveDispute` — independent active verifier only (not opener, owner, or recorded verifier), **before** window; afterwards only `expireDispute` (superseded by `judge` / `conclude`).
- `expireDispute` — anyone after window; → UNVERIFIED (lapse, no merits); bond → platform.
- `reportDiscrepancy` — light record only; does **not** withdraw a dispute or change status.

### Owner during DISPUTED

- `appendRecord` for clarifications when owner holds NFT.
- **Not possible while a mode holds the NFT** (`ownerOf` is the consignment contract).
- Owner cannot resolve; hire an independent KarPro.

### After Confirm or expire → UNVERIFIED

Owner may request a fresh inspection (`verifyPassport` by an active verifier). Expire is a lapse of backing, not a penalty finding.

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

Omit empty keys from JSON. Supported optional fields: `description`, `modelVariant`, `type`, `vehicleType`, `fuelType`, `bodyType`, `transmission`, `power`, `evBatteryKwh`, `colour`, `location`, `engine`, `features` (string[]), `condition`.

**`location` (city-level Place):** new uploads emit `{ label, countryCode, placeId, city?, region? }` only — **city and country**, never street address. `placeId` is the gazetteer identity (`photon:osm:…` via PlaceDirectory). `label` is a display snapshot; ranking/search should key on `placeId` / `countryCode`. Selection is via the PlacePicker (suggest + optional reverse from GPS); the browser never writes raw lat/lng. Legacy Arweave objects may still contain `{ label }` or `{ label, lat, lng }` — parsers accept them for display; edit/save requires a re-selected Place (or cleared location) and omits lat/lng on the new URI.

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
//   Upgradeable contracts (FixedPriceConsignment, AscendingConsignment):
//     UUPS upgrade = bump MINOR or MAJOR depending on scope
```

**Amend-in-place before a Nuclear ship:** Until a `VERSION` exists on a commercial chain, source VERSION strings are amended in place rather than accumulating unused pre-release increments. Storage-layout changes on UUPS contracts in that window ship only via full-stack Nuclear redeploy (not in-place upgrade of prior layouts). **Nuclear #4** (August 2, 2026) is the live ship for current VERSIONS.

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
| Dispute withdraw | Off-chain convention (`reportDiscrepancy`) | BondedChallenge `withdraw` + bond refund (KarPassport) |
| Dispute resolve | `resolveDispute(bool uphold)` | BondedChallenge `judge` / `conclude` + deposit routing |
| Self-resolve guard | None | `CannotResolveOwnDispute` (opener / owner / recorded verifier) |
| tokenId | Sequential | Chain-prefixed (`chainId << 128`) |
| Verifier fee signal | None | `verificationFee` |
| Bridge | None | ONFT adapter + spoke ONFT |
| Sale event | `fee`, `payAsset` enum | `platformFee`, `agentFee`, `payToken` address, `agent` |

---

*Last updated: August 2026 — Nuclear #4 live on 84532 / 11155111; address/VERSION tables describe **chain**. Part IV is a historical generation-v2 migration table — BondedChallenge superseded `withdrawDispute` / `DisputeOutcome`.*

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

**Dual-chain hub↔spoke:** not part of `e2e-local` (single 31337). Covered by Hardhat `gatewayHub`/`gatewaySpoke` (`KarPassportBridgeGateway` suite) + live `pnpm smoke:bridge`. Maintainer browser/ops checklist: [ops/deploys/multichain-browser-e2e-checklist.md](../ops/deploys/multichain-browser-e2e-checklist.md).

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
