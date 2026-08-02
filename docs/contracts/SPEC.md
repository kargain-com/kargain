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
| KarProStaking | `2.1.0-rc.1` | Immutable | Verifier stake + `isActiveVerifier` + claim payouts on leave |
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

FixedPriceConsignment `VERSION` **`2.4.0-rc.1`**. AscendingConsignment `VERSION` **`2.3.0-rc.1`**.

**Ascending admin surface:** live auction rules (`minDuration` / `maxDuration` / `extensionWindow` / `minIncrementBps` / `minProtectionWindow` / `maxProtectionWindow` / `abandonmentWindow` / challenge bond) are read via `auctionRules()` and replaced atomically with `setAuctionRules` → `AuctionRulesSet` (full set). Protection fields are opener **bounds** only — lot hold length is chosen at `openAscendingDirect` / `openAscendingFromMandate` (`duration` + `protectionWindow_` args; `ProtectionOutOfBounds` outside min/max) and snapshotted in `AscendingTermsSnapshotted` / `auctionProtectionWindow(tokenId)`. Mandate path does not add a mandate floor field for protection — the agent chooses within bounds at open, as with duration. Timelock queue is serialized — a later scheduled full-set execute wins over an earlier one. Payment-token approve stays owner-only; revoke is guardian **or** owner (soft-disable). Lot open still emits `ConsignmentOpened` then `AscendingTermsSnapshotted` (two emits; merge rejected after size fit).

**EIP-170:** Ascending deployed bytecode **23855** (limit 24576, headroom **721**) with linked **`AscendingHoldLib`** + **`AscendingOpenLib`** (Hardhat link → `DELEGATECALL`; bid stays on the mode). FixedPrice **18070** (headroom **6506**). Combined mode headroom **7227**. Accountability event surface unchanged. Headroom is hundreds of bytes — not a multi-KB buffer; next feature that does not fit remains a model-boundary question ([commerce-model §11](../research/commerce-model-2026.md)).

**Open gate:** `_requireCanOpen` refuses unless `IEncumbranceRegistry(passport).isEncumbranceSource(address(this))` — `ModeNotEncumbranceSource`. Registration is not answered inside `may` (previews stay bool / `SourceUnanswerable` only).

**Mode authority (G3):**

| Op | Authority |
|----|-----------|
| `pause` | Guardian (`NotGuardian`) |
| `revokePaymentToken` | Guardian **or** owner (Timelock) — soft-disable; in-flight buy/bid/settle keep stored config (`NotGuardianOrOwner`) |
| `unpause` / `approvePaymentToken(token, feed, stalenessTolerance)` / `setGuardian` / UUPS / `setAuctionRules` / `setCurrencyFeed(code, feed, stalenessTolerance)` / `setNativeUsdStalenessTolerance` | Owner (Timelock) |
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

### I.4. KarProStaking (`2.1.0-rc.1`)

- **`isActiveVerifier(address)`** — single source of truth (active stake record); **false immediately after `leave`**, including during unbonding.
- **`becomeVerifierNative`** / **`becomeVerifierToken`** — permissionless join; mints KarProPass; reverts `UnbondPending` if a prior leave has not been claimed. **Product UI (intentional):** join offers **native only** (`KarProJoinForm` → `becomeVerifierNative`). The token path stays dormant until Timelock `setStakeToken` enables a stake asset — no join or ops UI for a governance-disabled capability. Do not build a token-join screen while `stakeToken` is unset.
- **`Stake.asset`** — `address(0)` = native ETH, else the ERC-20 address recorded **at join**. Claim refunds that recorded asset (never the current `stakeToken` setting). Same native convention as `ClaimablePayouts` / Modes payment asset (`address(0)` = native).
- **Two-phase leave:** `leave()` ends the role immediately (`active = false`, burn try/catch), sets `unlockAt = now + UNBONDING_PERIOD` (**14 days**, equal to passport `DISPUTE_WINDOW` by design). `claimStake()` after unlock pays via ClaimablePayouts (failed push → withdrawable claim). **No slashing** in this ship. There is **no** dispute↔leave coupling — a future slash design must use a monotonic “not before” unlock timestamp (bug → early unlock), never a decrementing challenge counter (bug → permanent lock).
- **`minStakeNative`** — default `0.05 ether`; owner adjustable but **`MIN_STAKE_FLOOR = 0.001 ether`** minimum.
- **`verificationFee`** — verifier-set wei amount; **informational only** (no on-chain payment enforcement on KarProStaking). The Kargain `/kar-pro` UI composes service margin (nav display currency) plus an estimated `verifyPassport` gas cost at save time and writes the sum as a single wei value via `setVerificationFee`. Accepted off-chain payment methods are signaled in Nostr kind 0 as optional `verifierPaymentMethods` (`eth`, `usdc`, `lightning`; absent = all three). Workflow: verifier sets fee → passport owner may pay the verifier directly (Kargain UI supports native ETH with an on-chain memo, USDC `transfer`, or a Lightning payment resolved from the verifier's Nostr kind 0 `lud16` — none escrowed or enforced by contracts) → verifier calls `verifyPassport` after inspection.
- Constructor requires non-zero `proPass` (`ZeroAddress`). Stake storage layout ships only via full Nuclear redeploy (live: Nuclear #3).

#### Dormant ERC-20 verifier stake (recorded option — not scheduled)

After Nuclear #3, `stakeToken` is unset (`address(0)`) on both commercial chains. The constructor sets only `minStakeNative` (`KarProStaking.sol:90`); `stakeToken` / `minStakeToken` remain zero (`:59–60`). Calling `becomeVerifierToken` therefore reverts `TokenNotEnabled` (`:126`). The ERC-20 join path is a **complete but dormant** capability, not an unfinished one. Product UI already withholds token-join for that reason (S22).

**Enabling (optional, not planned):** the Timelock owner proposes `setStakeToken(token, minAmount)` (`:208–213`). Admission runs `Erc20Admission.requireConforming(token)` before the minimum check; `minAmount == 0` reverts `ZeroMinStake` (`:210`, S33). Enabling is **per commercial chain** — each chain has its own `KarProStaking`, so a token may be live on one network and unset on another.

**Rights today:** `becomeVerifierToken` records delivery (`balanceBefore` / `received`, `:131–134`) into `Stake.asset` / `amount`. `isActiveVerifier` returns only `stakes[a].active` (`:219–220`), so native and token joins currently grant the same professional gates. `KarPassport` reads that flag at `:365`, `:420`, and `:471`.

**Collateral-weight caveat:** two assets that grant identical rights can drift in value independently. A fixed `minStakeToken` does not track `minStakeNative`, and nothing re-prices either. Whether the two floors are comparable skin in the game is a decision for the Timelock act that enables the token — the contract does not answer it. `Stake.asset` preserves the distinction if rights or reporting were ever differentiated later.

This option is **recorded, not scheduled.** Do not invent a roadmap item, PENDING entry, or app task for it.

### KarProStaking — function reference

| Function | Access | Behavior |
|----------|--------|----------|
| `becomeVerifierNative` | anyone + ETH | Stake native (`asset = 0`); mint pass |
| `becomeVerifierToken` | anyone | Stake configured ERC-20 (`asset = stakeToken` at join); mint pass |
| `leave` | active verifier | End role; start 14d unbond; attempt burn (no payout yet) |
| `claimStake` | after unlock | Pay recorded asset (or credit claim); clear unbond state |
| `setMinStakeNative` | owner | New minimum (≥ floor) for **new** joiners |
| `setStakeToken` | owner | Enable/update ERC-20 stake token + min (does not rewrite existing stakes) |
| `isActiveVerifier` | view | Active stake check |
| `setVerificationFee` | active verifier | Set public fee signal (wei) |

### KarProStaking — error reference

| Error | When |
|-------|------|
| `BelowMinStake` | Native stake below minimum |
| `AlreadyVerifier` | Active stake exists |
| `UnbondPending` | Join while unbonding / unclaimed stake remains |
| `NotVerifier` | Leave or fee update without active stake |
| `UnbondNotReady` | `claimStake` before unlock |
| `NoUnbond` | `claimStake` with no pending unbond |
| `TokenNotEnabled` | Token path not configured (`stakeToken == 0`) |
| `ZeroMinStake` | `setStakeToken` with `minAmount == 0` |
| `NoClaim` | `withdrawClaim` with zero pending balance |
| `TransferFailed` | `withdrawClaim` transfer failed (`claimStake` credits a claim on push failure) |
| `TokenHasNoCode` | `setStakeToken` address has no code |
| `TokenNonConforming` | `setStakeToken` token fails ERC-20 transfer return probe |
| `BelowMinStakeFloor` | Owner sets min below 0.001 ETH |
| `ZeroAddress` | Constructor `proPass_ == 0` |

---

### I.5. Commerce modes (FixedPriceConsignment + AscendingConsignment)

**Contractual commerce surface** (generation v2, post §15.2 step 5): **`FixedPriceConsignment`** and **`AscendingConsignment`** UUPS proxies. Shared libraries: **`ConsignmentBase`**, **`Mandate`**, **`Recall`**, **`BondedChallenge`** (also used by KarPassport verification challenges).

| Mode | VERSION | Role |
|------|---------|------|
| FixedPriceConsignment | `2.4.0-rc.1` | Mandate → open → buy / delist / recall; fiat registry + native / ERC-20 checkout; per-feed oracle staleness; agent commission splits |
| AscendingConsignment | `2.4.0-rc.1` | English ascending auction consignment + settlement hold + BondedChallenge on hold paths |

**Open refusal:** unregistered mode → `ModeNotEncumbranceSource`. Payment-token admission checked **at open only**; soft-revoked assets block new opens while in-flight sales settle.

**Trust readiness (Nuclear #4):** FixedPrice open/grant ignore `passportStatus` (encumbrance `may(OpenConsignment)` only). Ascending **`openAscendingDirect` / `openAscendingFromMandate`** require `passportStatus == VERIFIED` else `PassportNotVerified`. Mandate **`grant`** stays status-free (agent may verify before open).

**Guardian errors:** `pause` → `NotGuardian`; `revokePaymentToken` → `NotGuardianOrOwner` (guardian or Timelock owner). FixedPrice VERSION **`2.4.0-rc.1`**; Ascending VERSION **`2.4.0-rc.1`** (live on Nuclear #4 I.9).

**Denomination invariants** (origin: [commerce-model-2026.md](../research/commerce-model-2026.md) P3 / M3 / N4 / P4):

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

**Normative product model:** [commerce-model-2026.md](../research/commerce-model-2026.md) (mandate, recall, splits, ascending lifecycle, G3, §15 cutover).

**Ascending Nuclear initialize defaults** (governance-mutable after deploy; normative model §11 / §7.3):

| Parameter | Default | Notes |
|-----------|---------|--------|
| Extension window | **900 seconds** | Captured into `AuctionTerms` at open; storage change affects later lots only |
| Minimum increment | **300 bps** | Captured into `AuctionTerms` at open; storage change affects later lots only |
| Duration bounds | **3–30 days** | Checked at open; Timelock `setAuctionRules` |
| Protection bounds | **7–45 days** | Bounds, not a value — the opener chooses within them at open (`protectionWindow_`), captured into `AuctionTerms`, applied at `settle` |
| Settlement challenge window | **14 days** | Ascending BondedChallenge instance — **same length** as KarPassport verification (model §7.3: discovery time lives in the protection hold, not in a second long clock) |
| Abandonment window | **30 days** | Length captured into `AuctionTerms` at open; **deadline** set when reversal becomes pending |
| Challenge bond | **0.01 ETH** | Exact match at `open` |

Constants: `scripts/lib/verify-constructor-args.ts` (`ASCENDING_EXTENSION_WINDOW`, `ASCENDING_MIN_INCREMENT_BPS`, `ASCENDING_MIN_PROTECTION_WINDOW` / `_MAX_`, `ASCENDING_CHALLENGE_WINDOW`, `ASCENDING_ABANDONMENT_WINDOW`). **Lot-bound auction terms** (duration, extension, min increment, protection, abandonment length) are snapshots at open — governance storage for those fields is read when a new lot opens (model §11, C4, G1; proven by `test/ascending/AscendingConsignment.test.ts` "B3 snapshot…" / "snapshot: minIncrementBps frozen…"). The settlement **challenge window** is one-shot at Ascending `initialize` (not lot-open); the challenge **bond** is captured when a challenge opens. See the provenance table.

#### Parameter provenance — what to read, and from where

One table per question a screen can ask. **A screen showing the terms of a specific lot never reads `auctionRules()`; a screen where someone is choosing terms reads nothing else.** Mixing the two is the defect this table exists to prevent.

| Parameter | Fixed when | Governance surface | Per-subject getter | Read from |
|---|---|---|---|---|
| Duration | chosen at open, within bounds | `auctionRules().min/maxDuration` | `auctionDuration(tokenId)` | create → bounds · lot → getter |
| Extension window | captured at open | `auctionRules().extensionWindow` | `auctionExtensionWindow(tokenId)` | lot → getter |
| Minimum increment | captured at open | `auctionRules().minIncrementBps` | `auctionMinIncrementBps(tokenId)` | bid panel → getter |
| Protection window | **chosen at open**, within bounds (H1) | `auctionRules().min/maxProtectionWindow` | `auctionProtectionWindow(tokenId)`; after `settle` the *deadline* is `holdProtectionEndsAt(tokenId)` | create → bounds · lot → getter · hold → deadline |
| Abandonment window | captured at open; deadline set when reversal becomes pending | `auctionRules().abandonmentWindow` | `auctionAbandonmentWindow(tokenId)`, then `holdAbandonmentWindow` / `holdAbandonmentDeadline(tokenId)` | reversal panel → deadline |
| Settlement challenge bond | rotatable; captured into `Challenge` at open | `auctionRules().challengeBond` | `challengeBondAmount(subjectId)` | pre-open → `auctionRules()` · open → getter |
| **Settlement challenge window** | **one-shot at `initialize`; immutable per instance** | **none — not in `setAuctionRules`** | `challengeWindowDuration(subjectId)`, **zero unless a challenge is open** | pre-open → **no getter exists**, use the deploy record · post-open → getter, or Ponder `challenge.windowDuration` from `ChallengeOpened` |
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

| Network | chainId | EID |
|---------|---------|-----|
| Base Sepolia | 84532 | 40245 |
| Ethereum Sepolia | 11155111 | 40161 |
| Polygon Amoy | 80002 | 40267 |

EndpointV2 (testnet): `0x6EDCE65403992e310A62460808c4b910D972f10f` (`scripts/lib/chainlink-feeds.ts`).

**Active pathway (40245 ↔ 40161)** — addresses from committed snapshot `scripts/lib/layerzero-metadata.snapshot.json` (refreshed via `pnpm lz:snapshot`). Metadata API keys: `base-sepolia` / `sepolia-testnet`.

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

Normative rules for every LayerZero OApp/ONFT pathway used by Kargain. Long-form incident context: [docs/research/layerzero-risk-2026.md](../research/layerzero-risk-2026.md).

- **No defaults.** Default send/receive library and DVN configurations are forbidden. Every OApp/ONFT deployment MUST explicitly pin send and receive libraries and the per-pathway DVN set (required + optional). Never depend on LayerZero Labs-controlled defaults.
- **DVN quorum.** Minimum **2** required DVNs from independent operators on testnet pathways; **3–5** on any mainnet pathway. LayerZero Labs DVN MAY be one required DVN; it MUST NOT be the only one. **1-of-1** DVN configurations are forbidden permanently.
- **EID allowlist + star topology.** Testnet wire scripts allow only EIDs `{40245, 40161}` and only the hub↔spoke star (no spoke↔spoke peers). Never wire testnet EIDs to mainnet EIDs.
- **Read-back.** After every config write, re-read on-chain state and fail if `requiredDVNCount < 2`, a default library is in use, a dead DVN is in the required set, or peers are non-reciprocal. Ops drift check: `pnpm bridge:wire:read-only` (zero transactions).
- **Receive library change policy.** Initial `setReceiveLibrary` only. Changing an already-set **non-default** receive library is refused by `bridge-wire` — use the explicit `setReceiveLibraryTimeout` / grace-period procedure (out of scope for the wire script).
- **Pinned metadata.** Library and DVN addresses MUST come from the committed LayerZero metadata snapshot (`pnpm lz:snapshot`), not from chat or memory. Snapshot `endpointV2` MUST equal `LZ_ENDPOINT_V2_BY_CHAIN`.
- **Config authority.** OApp delegate / config ownership follows the same governance pattern as other protocol contracts (Timelock48h upgrade authority). No EOA-held config ownership on mainnet.
- **Provider isolation.** LayerZero imports are confined to bridge adapter modules (`ProxyONFT721Adapter`, `KarPassportONFT721`, and their deploy/config scripts). Core contracts, `app/`, `lib/`, and `hooks/` remain messaging-provider agnostic so the provider is swappable (e.g. CCIP / Hyperlane) at the adapter boundary.
- **Monitoring.** Bridge config and ownership changes MUST be observable (LayerZero Console or equivalent alerting) before any mainnet pathway goes live.
- **Phase 2 checkpoint.** Bridge remains **testnet-scope** until a maintainer re-assessment clears the gates below. Before any mainnet pathway, the following testnet→mainnet deltas **MUST** be re-derived (testnet values are not portable). Maintainer dossier (prepared, **not activated**): [ops/deploys/phase2-checkpoint-dossier.md](../ops/deploys/phase2-checkpoint-dossier.md). Research: [layerzero-risk-2026.md](../research/layerzero-risk-2026.md).
  - **(a) Confirmations.** Shipped testnet pathway uses confirmations **5/5** (explicit-fallback on 40245↔40161). Mainnet MUST re-derive confirmations from the pinned metadata snapshot for the mainnet EID pair — do not copy testnet 5/5.
  - **(b) Config delegate.** Testnet may use deployer EOA as OApp/ONFT / gateway config owner and recovery authority. Mainnet MUST move config ownership **and** gateway owner / `recoverLockedHome` to **Timelock48h** (no EOA-held config; see Config authority above and [recovery-bridge.md](../ops/recovery-bridge.md)).
  - **(c) DVN count.** Testnet minimum is **2** required DVNs (Labs + Nethermind). Mainnet MUST use **3–5** independent required DVNs.
  - **(d) Research gates.** Also confirm from the research doc: (1) LayerZero **default migration** to 5/5 (or documented floor) is complete, (2) a **timelock on library upgrades** is in place, and (3) **6+ months** without new LayerZero security incidents.
  - **(e) No ops smoke-mint on mainnet.** Mainnet forbids ops/smoke `mintPassport` and live `pnpm smoke:bridge` on commercial KarPassport (infra proof = `bridge:wire:read-only` / §7.6 read-back). Placeholder URIs (e.g. `ar://nuclear-smoke`) are forbidden on commercial stacks. Testnet live smoke requires a **pre-minted** `--token-id` with valid metadata — auto-mint is disabled (`scripts/lib/smoke-bridge-policy.ts`). Home passport has **no user burn** (permanent invariant; foreign `bridgeBurn` only) — ops must not create leftover commercial home NFTs.
- **Risk framing.** Kargain bridges passport identity/metadata (spoke mints **UNVERIFIED** per §7.1; trust is never ported), not fungible value custody. Blast radius of a messaging compromise is data integrity, not fund loss. This framing does **not** relax any rule above.

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
| **Open-window griefing freeze** | Up to 14d freeze (auctions/bridge/URI) for gas cost; FixedPrice buy on an already-offered consignment still allowed; counter = owner-funded independent Reject → bond to platform |
| **No bond ceiling** | Governance can raise deposit enough to make verifications unchallengeable; Timelock48h visibility + cancel is the control |
| **Reverting seller** | Seller contract wallet can block ETH payout; document for buyers |
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

Historical v1.x / pre-Nuclear addresses: [Part II.4](#ii4-historical-deployment-base-sepolia-84532). **Nuclear #4** August 2, 2026 — production Ponder must **full reindex** from hub `indexFromBlock` **44957457** and Eth **11404204**.

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

**Wired pathway (testnet-only values):** EIDs **40245 ↔ 40161** · peers hub gateway `0xb1aEEA9466b8C67Ba9D8931987E26A2Bef59B7Dc` ↔ eth gateway `0xec44167ab1e2619C9aCaA87F5B06DcAFe1BF7269` · required DVNs Labs + Nethermind (committed snapshot `scripts/lib/layerzero-metadata.snapshot.json`) · confirmations **5 / 5** · enforcedOptions type1 **100k** gas / type2 **250k** gas (**floors**; sender may raise lzReceive via `extraOptions` from URI-length policy in `lib/web3/bridge/lz-receive-gas.ts`) · `pathwayConfigHash` `0x84c7ea51e28cedf54a79d9edc81b07019ad1a47cc3d5dc08471d681e4e81cf1e`

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
| KarProStaking | Timelock: `setMinStakeNative`, `setStakeToken` |
| FixedPrice / Ascending | **Guardian:** `pause`, `revokePaymentToken`. **Timelock (owner):** `unpause`, `approvePaymentToken(token, feed, stalenessTolerance)`, `setGuardian`, UUPS, `setCurrencyFeed(code, feed, stalenessTolerance)`, `setNativeUsdStalenessTolerance` (FixedPrice only), `setAuctionRules` (Ascending) |

Write `deployments/<chainId>.json` with `generation: "v2"`, `tokenIdOffset` (`chainId << 128`), `contractVersions`, `indexFromBlock`, mode + library + gateway addresses (`fixedPriceConsignment`, `ascendingHoldLib`, `ascendingOpenLib`, `ascendingConsignment`, `bridgeGateway`).

**Parameters (both commercial chains):** `disputeDeposit` 0.01 ETH · `platformFeeBps` 10 · FixedPrice per-feed oracle tolerances from `CHAINLINK_FEEDS` (native + USDC at admit; bounds 60s–72h — see [I.5](#i5-commerce-modes-fixedpriceconsignment--ascendingconsignment)) · `minStakeNative` 0.05 ETH · Ascending Nuclear windows from model §11: extension **900s**, protection **bounds 7–45 days** (opener chooses at open), settlement challenge **14 days**, abandonment **30 days**, min increment **300 bps**, duration **3–30 days**, challenge bond **0.01 ETH** · USD-only currency registry at mode deploy · USDC admitted at construction before handoff · same `platformRecipient` as prior 84532 deploy · `COMMERCE_GUARDIAN` for pause + soft-revoke · **FixedPrice `2.3.0-rc.1` full redeploy** (no in-place Timelock patch). Commerce behavior: [I.5](#i5-commerce-modes-fixedpriceconsignment--ascendingconsignment) · [commerce-model-2026.md](../research/commerce-model-2026.md). Nuclear end-state: [§12.10](#1210-84532-hub-migration-testnet--nuclear).

---

### I.11. Retired — AuctionEscrow

**Retired** with `MarketplaceEscrow` in commerce cutover §15.2 step 5 (July 2026). Replaced by **`AscendingConsignment`** for English reserve auctions with settlement hold. Product, app, and indexer no longer target `AuctionEscrow` events or legacy `GET /auctions*` routes. Historical design: [auction-design.md](../research/auction-design.md). Denylisted proxy addresses: [I.9.1 / I.9.2 retired escrows](#i91-active-deployment-base-sepolia-84532). Ops log: [ops/deploys/84532-auction.md](../ops/deploys/84532-auction.md).

---


### I.12. Multi-chain architecture (normative)

> **Single source of truth** for bridge custody, trust, and metadata across chains. Supersedes the custody/trust wording in §7.1/§7.5. §7.4/§7.6 remain the LayerZero pathway and security reference. Research annexes: [multichain-architecture-decision-2026.md](../research/multichain-architecture-decision-2026.md), [multichain-security-model-2026.md](../research/multichain-security-model-2026.md).

### 12.1 Model

Every commercial Kargain chain runs the **identical** stack: `KarPassport` + KarProPass + KarProStaking + **FixedPriceConsignment** + **AscendingConsignment** + one `KarPassportBridgeGateway`. There is exactly **one** passport contract type and **one** bridge contract type across all chains. The thin `KarPassportONFT721`, `ProxyONFT721Adapter`, and legacy **`MarketplaceEscrow` / `AuctionEscrow`** are retired.

**Identity.** `tokenId = (chainId << 128) | localSeq`; `chainIdOf(tokenId)` is the immutable **origin/home** chain. tokenIds are globally unique and **travel unchanged** — the gateway never re-encodes an id.

**Custody = lock-and-mint.** A token's canonical row lives on its home chain. When bridged away, the home gateway **locks** it and the destination gateway **mints a representation** with the same tokenId. *Origin/home* (`chainIdOf`) and *routing hub* (the LayerZero star center, currently EID 40245 Base) are **distinct**: messages relay **through the hub**, not "to the origin first." Star topology and the `{40245, 40161}` EID allowlist are unchanged (§7.6).

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

`KarPassport` exposes, callable **only** by the bound `bridgeGateway`: `bridgeMint(to, tokenId, uri)` (require `chainIdOf != local`, not-exists; status UNVERIFIED); `bridgeBurn(tokenId)` (require `chainIdOf != local`); `setCustodyLock(tokenId, bool)`; `bridgeResetOnUnlock(tokenId, uri)` (status→UNVERIFIED, clear verifier; emit `VerificationReset` only if prior was VERIFIED; set URI when provided). The gateway is bound **once** via `setBridgeGateway` (one-time, owner-only — same pattern as `KarProPass.setStaking`). Unlock releases only a token the gateway actually holds and had locked. `KarPassport` imports no LayerZero — it knows only a `bridgeGateway` address (§7.6 provider isolation).

### 12.8 Records are chain-sharded, globally aggregated

Each chain stores records appended while the token lived there, keyed by the same global tokenId. The **indexer** unions `passport_record`/`passport_uri_history` by global tokenId across chains and tracks each token's **custody chain** (distinct from origin), so provenance is continuous through moves. This is a correctness requirement.

### 12.9 Unlock = crown-jewel

The home-unlock path is **asset-custodial** (a forged unlock steals a real NFT); the §7.6 "data integrity, not fund loss" framing does **not** apply to unlock. Before any mainnet unlock pathway: ≥3 independent DVNs, Timelock48h as OApp config owner, no default libraries, monitoring live.

### 12.10 84532 hub migration (testnet) — Nuclear

`KarPassport` is immutable; commerce **modes** are UUPS. **Nuclear #4** (August 2, 2026) redeployed the full stack (passport + modes + gateway) on both 84532 and 11155111; Nuclear #3 and earlier stacks are denylisted. Ponder must full-reindex from hub **44957457** / Eth **11404204**. Empty-testnet passports from prior stacks were abandoned (no user value).

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

- Every off-chain identify / filter of protocol contracts **must** use `(chainId, address)` — never an address string alone.
- Denylist, address resolvers, and indexer compound keys are **per-chain**.
- Today's `SEPOLIA_HISTORICAL_DENYLIST` is **84532-only**; `kargainContractDenylist(chainId)` builds per-chain lists from `COMMERCIAL_ACTIVE` + that historical set. Applying Base historical addresses chain-blind would treat live 11155111 contracts as abandoned.

**Hard requirements for upcoming work:**

- **C3 (indexer):** entity / API keys include `chainId` (no address-only identity across commercial chains).
- **C4 (app):** messaging/profile denylist is per-chain via `kargainContractDenylist(chainId)` (C4.1); do not reuse Base historical addresses for other `chainId`s.

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
