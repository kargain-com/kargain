# Nuclear #2 — full-stack deploy rehearsal runbook (84532 + 11155111)

> **HISTORICAL — July 2026.** Nuclear #2 was superseded by Nuclear #3 then **Nuclear #4**. Do **not** use this runbook for production ops. Live stack: [nuclear-4.md](../nuclear-4.md) · SPEC I.9. Kept as construction/admission rehearsal history; local proof: `pnpm hardhat test test/nuclear-rehearsal.test.ts`.

Operator steps for the July 2026 commercial Nuclear wave (archived). **Cursor never runs live txs.**

> **FixedPrice `2.3.0-rc.1` (July 2026):** per-feed oracle staleness replaces global `maxFeedStaleness`. Shipped on Nuclear #2 then carried into Nuclear #3.

| | |
|--|--|
| Scope | Timelock → KarPro → Passport → FixedPrice + **AscendingHoldLib → AscendingOpenLib → Ascending** (**owner=deployer**) → encumbrance register → **USDC admission (with per-feed tolerance)** → gateway → **mode ownership handoff** → passport/staking handoff → post-handoff Timelock ops |
| Chains | Base Sepolia **84532** and Ethereum Sepolia **11155111** (identical protocol params) |
| Script | `pnpm deploy:sepolia` / `pnpm deploy:sepolia:eth` → [`scripts/deploy.ts`](../../../scripts/deploy.ts) |
| Dry-run | `pnpm deploy:nuclear:dry-run` (parity + structural encumbrance/admission order; no txs) |
| Local rehearsal | `pnpm hardhat test test/nuclear-rehearsal.test.ts` |
| Spec | [SPEC §I.10](../../contracts/SPEC.md#i10-deploy-sequence) |

**Ascending Nuclear initialize defaults** (must match model §11; asserted by `test/ascending-nuclear-defaults-parity.test.ts`):

| Parameter | Value |
|-----------|-------|
| Extension window | 900 seconds |
| Minimum increment | 300 bps |
| Duration bounds | 3–30 days |
| Protection bounds | 7–45 days (opener chooses at open) |
| Settlement challenge window | 14 days |
| Abandonment window | 30 days |
| Challenge bond | 0.01 ETH |

---

## Prerequisites

- `.env.local`: `DEPLOYER_PRIVATE_KEY`, `COMMERCE_GUARDIAN` (EOA **distinct** from deployer and from Timelock)
- `pnpm compile`; `pnpm deploy:nuclear:dry-run` green (includes **`assertNuclearFeedsFresh`** per configured tolerance)
- Guardian key available for **pause** and **soft-revoke**; deployer is Timelock proposer + executor on both chains
- Modes refuse `open*` unless `isEncumbranceSource(mode)` (bytecode + tooling)

---

## Structural ordering (all abort the run)

| Constraint | Enforcement |
|------------|-------------|
| Mode proxies → `addEncumbranceSource` ×2 → admit USDC → gateway → mode handoff → passport handoff | **Structural** — `assertNuclearEncumbranceOrdering` in plan/dry-run |
| AscendingHoldLib → AscendingOpenLib → AscendingConsignmentImpl → Proxy | **Structural** — linked libraries before Ascending impl; manifest stores `ascendingHoldLib` / `ascendingOpenLib` |
| Register before gateway | Live/local deploy **aborts** if `isEncumbranceSource` is false |
| Admit before mode ownership handoff | Live/local deploy **aborts** if USDC not **enabled** on both modes, or FixedPrice feed read-back ≠ configured `usdcUsdFeed` (including zero), or tolerance read-back ≠ configured value |
| FixedPrice USDC/USD feed | `resolveUsdcUsdFeedForAdmit` — non-zero feed → admit with measured oracle **and `stalenessTolerance`**; **zero feed → admit asset-only and announce fiat unavailable** (never invent a feed / silent peg). Base Sepolia (84532) has **no** Chainlink USDC/USD (RPC-probed 2026-07-30). Eth Sepolia has `0xA2F78…270E` with tolerance **172 992s** (P4: obs 86496 ×2, hb 86400). Mainnet rows (`1`, `8453`) carry verified feeds for future config but are **not** Nuclear targets (`isCommercialChainId` → 84532\|11155111 only) |
| FixedPrice native ETH/USD tolerance | From `CHAINLINK_FEEDS.nativeUsdStalenessTolerance` — **84532: 2444s** (obs 1222, hb 1200); **11155111: 7392s** (obs 3696, hb 3600). Rule: `2 × max(obs, publishedHeartbeat)` — see commerce-model P4 |
| Open requires live encumbrance source | On-chain `ModeNotEncumbranceSource` in `ConsignmentBase._requireCanOpen` |

---

## Maintainer steps (order)

### 1. Dry-run parity

```bash
pnpm deploy:nuclear:dry-run
```

Confirm shared params, step list (includes admission + mode handoff), Timelock expand/restore ops, guardian-immediate ops, and **feed freshness lines** (`assertNuclearFeedsFresh`). Expect:

- `84532: admit USDC with feed 0x0…0` plus a `LIMITATION:` line that fiat-denominated USDC sales are unavailable; native/USD tolerance **2444s**
- `11155111: <feed> — admit OK with measured feed, stalenessTolerance=172992s`; native/USD tolerance **7392s**

Abort if ordering assert fails.

### 2. Deploy Base Sepolia (84532)

```bash
pnpm deploy:sepolia
```

Expect console:

- `✓ encumbrance sources registered (refusing gateway until this holds)`
- `✓ USDC admitted on both modes (FixedPrice feed zero — fiat unavailable; asset-denominated only)` plus the same `LIMITATION:` announcement
- Do **not** expect a deploy abort solely because `usdcUsdFeed` is zero

Record manifest `deployments/84532.json` addresses + `blocks.*` / `indexFromBlock`.

**Deployment-record notes for 84532 (write into the ops deploy log):**

- Fiat-denominated sales in USDC are unavailable on Base Sepolia because no Chainlink USDC/USD aggregator exists on 84532 (probed 2026-07-30).
- Fiat-denominated USDC sales are exercised on **Ethereum Sepolia (11155111)** with feed `0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E`.
- Base **mainnet** carries a verified USDC/USD feed at `0x7e860098F58bBFC8648a4311b374B1D669a2bc6B` (config only — not a Nuclear target).
- The untested pairing is Base Sepolia × fiat USDC, which corresponds to no production configuration.
- Path forward: Timelock `approvePaymentToken(USDC, feed, stalenessTolerance)` with a real aggregator when one appears; once set, feed is **monotonic** and cannot be cleared. Do **not** deploy a mock / private-key price contract on any commercial chain.

### 3. Deploy Ethereum Sepolia (11155111)

```bash
pnpm deploy:sepolia:eth
```

Same structural checks. FixedPrice USDC admit uses the measured feed. Manifest `deployments/11155111.json`.

### 4. Ownership shape (read back on each chain)

For FixedPrice, Ascending, KarPassport, KarProStaking:

- `owner()` == Timelock48h
- Mode `guardian()` == `COMMERCE_GUARDIAN` (≠ Timelock, ≠ deployer)
- Passport `isEncumbranceSource(fixedPrice)` and `isEncumbranceSource(ascending)` are true
- Both modes: USDC payment token **enabled** (admitted at construction)
- FixedPrice `paymentTokens(USDC).feed`: **non-zero** on 11155111; **zero** on 84532 (asset-only — announced)
- `bridgeGateway()` bound

Prove guardian can `pause()` and `revokePaymentToken(usdc)` (soft-disable); guardian **cannot** `approvePaymentToken` / `unpause` — only Timelock schedule/execute those.

### 5. Post-handoff Timelock ops (feeds / re-approve / rules)

Initial USDC admission is **already done at deploy**. Use Timelock for later expands/restores:

| Target | Example |
|--------|---------|
| FixedPrice | `setCurrencyFeed(code, feed, stalenessTolerance)`, `setNativeUsdStalenessTolerance`, re-`approvePaymentToken(token, feed, stalenessTolerance)` (**must keep or replace feed — cannot clear to zero**), `unpause`, `setGuardian`, UUPS |
| Ascending | `setAuctionRules`, re-`approvePaymentToken`, `unpause`, `setGuardian`, UUPS |
| KarPassport | `addEncumbranceSource` / `removeEncumbranceSource` (post-handoff) |

Schedule → wait `getMinDelay()` (48h) → execute.

**Feed freshness:** `setCurrencyFeed`, feed-bearing `approvePaymentToken`, and `setNativeUsdStalenessTolerance` run `_validateFeed` at **execute** time against **that feed’s configured tolerance**. Live Chainlink aggregators must stay within the tolerance across 48h. Dry-run (`pnpm deploy:nuclear:dry-run`) probes the same bounds before any tx. Do not point Timelock ops at a static mock feed without refreshing it before execute.

**Chain without USDC/USD feed:** Nuclear **admits** USDC with `feed=0` and announces fiat unavailable. Do not pass a fabricated address as a peg. Ascending admit (asset-only) does not need a payment-token feed. Populating mainnet `usdcUsdFeed` in `CHAINLINK_FEEDS` does **not** enable `pnpm deploy:sepolia`-style Nuclear on mainnet — commercial allowlist stays testnet-only until §7.6 clears.

### 6. Guardian-immediate ops (no delay)

- `pause` / soft-`revokePaymentToken` on either mode
- Soft-revoke keeps decimals/feed so **in-flight** buy/bid/settle still complete via the **measured** feed when one was set; **new** opens in that asset fail until Timelock re-approves with a non-zero feed (84532 starts with no feed — soft-revoke still disables new opens)

### 7. Cutover app + indexer (after both manifests)

1. Update `COMMERCIAL_ACTIVE` / committed addresses from both manifests (same PR as deploy).
2. `pnpm ponder:config` — confirm mode addresses + start blocks from manifests.
3. VPS: pull, rebuild ponder, **full reindex** from Nuclear `indexFromBlock` ([OPERATIONS.md](../../indexer/OPERATIONS.md)).
4. Smoke: `/ready`, `/status`, mode listings empty until first open.

### 8. Local working system (dev)

```bash
# terminal A
pnpm hardhat node
# terminal B
pnpm deploy:local
# then bring app + ponder against deployments/31337.json
./scripts/e2e-local.sh
```

Local deploy also **aborts** if encumbrance register or USDC admission fails before writing the manifest. Local stack uses a mock `$1` feed for FixedPrice fiat paths in tests only — never on commercial chains.

### 9. Bridge wire (after both commercial stacks)

```bash
pnpm bridge:wire:read-only   # audit first
pnpm bridge:wire             # when ready
```

---

## Rehearsal findings (closed / retained)

1. **~~`approvePaymentToken` at deploy impossible as deployer~~** — **closed.** Modes initialize with `owner=deployer`; admission runs before Timelock handoff.
2. **~~Open without register~~** — **closed.** Bytecode `ModeNotEncumbranceSource` + tooling abort.
3. **`setCurrencyFeed` freshness is evaluated at Timelock execute** — live feeds OK; static feeds go stale across 48h. **Retained.**
4. **~~Zero `usdcUsdFeed` aborted whole Nuclear deploy~~** — **closed.** Tooling admits with feed=0 and announces fiat unavailable; contracts refuse fiat open/quote (`PaymentTokenFeedRequired`).

**Misplaced-ops (report only — not moved):** `removeEncumbranceSource` and clearing a currency feed reduce LeaveChain / quote surface but stay Timelock-delayed (shared with expand paths).

---

## Post-deploy checklist

- [ ] Both manifests committed; `COMMERCIAL_ACTIVE` updated
- [ ] Guardian pause + soft-revoke smoke on each mode
- [ ] USDC enabled on both modes / both chains (construction admission); 84532 FixedPrice feed zero + limitation recorded; 11155111 feed non-zero
- [ ] Ponder reindexed; `/ready` + `/status`
- [ ] Bridge wire when both chains live
- [ ] First public fiat-USDC lot preferred on **11155111** until Base Sepolia has a real USDC/USD aggregator
