# Nuclear #2 — full-stack deploy rehearsal runbook (84532 + 11155111)

Operator steps for the next commercial Nuclear wave. **Cursor never runs live txs** — execute these yourself. Local proof lives in `pnpm hardhat test test/nuclear-rehearsal.test.ts` (schedule → wait 48h → execute through Timelock48h).

| | |
|--|--|
| Scope | Timelock → KarPro → Passport → FixedPrice + Ascending (owner=Timelock, guardian=`COMMERCE_GUARDIAN`) → encumbrance register → gateway → handoff → Timelock-gated admission + ops |
| Chains | Base Sepolia **84532** and Ethereum Sepolia **11155111** (identical protocol params) |
| Script | `pnpm deploy:sepolia` / `pnpm deploy:sepolia:eth` → [`scripts/deploy.ts`](../../../scripts/deploy.ts) |
| Dry-run | `pnpm deploy:nuclear:dry-run` (parity + structural encumbrance order; no txs) |
| Local rehearsal | `pnpm hardhat test test/nuclear-rehearsal.test.ts` |
| Spec | [SPEC §I.10](../../contracts/SPEC.md#i10-deploy-sequence) |

---

## Prerequisites

- `.env.local`: `DEPLOYER_PRIVATE_KEY`, `COMMERCE_GUARDIAN` (EOA **distinct** from deployer and from Timelock)
- `pnpm compile`; `pnpm deploy:nuclear:dry-run` green
- Guardian key available for pause ops; deployer is Timelock proposer + executor on both chains
- Do **not** open consignments until both modes show `isEncumbranceSource(mode) == true`

---

## Structural vs checklist ordering

| Constraint | Enforcement |
|------------|-------------|
| Mode proxies → `addEncumbranceSource` ×2 → gateway → handoff | **Structural** — `assertNuclearEncumbranceOrdering` in plan/dry-run; live/local deploy **aborts** if `isEncumbranceSource` is false before gateway |
| Do not open consignments before register | **Checklist** — Solidity `open*` does **not** require `isEncumbranceSource(this)`; LeaveChain would be blind if you skip register. Reason: no bytecode gate without a contract change (reported, not fixed in step 9) |

---

## Maintainer steps (order)

### 1. Dry-run parity

```bash
pnpm deploy:nuclear:dry-run
```

Confirm shared params, step list, and Timelock owner-ops list. Abort if encumbrance ordering assert fails.

### 2. Deploy Base Sepolia (84532)

```bash
pnpm deploy:sepolia
```

Expect console: `✓ encumbrance sources registered (refusing gateway until this holds)`. Record manifest `deployments/84532.json` addresses + `blocks.*` / `indexFromBlock`.

### 3. Deploy Ethereum Sepolia (11155111)

```bash
pnpm deploy:sepolia:eth
```

Same checks. Manifest `deployments/11155111.json`.

### 4. Ownership shape (read back on each chain)

For FixedPrice, Ascending, KarPassport, KarProStaking:

- `owner()` == Timelock48h
- Mode `guardian()` == `COMMERCE_GUARDIAN` (≠ Timelock, ≠ deployer)
- Passport `isEncumbranceSource(fixedPrice)` and `isEncumbranceSource(ascending)` are true
- `bridgeGateway()` bound

Prove guardian can `pause()`; deployer / guardian **cannot** `unpause()` — only Timelock schedule/execute `unpause`.

### 5. Timelock-gated admission (required before USD ERC-20 sales)

Modes initialize with **owner = Timelock**. Deployer cannot call `approvePaymentToken`.

On each chain, schedule → wait `getMinDelay()` (48h) → execute:

| Target | Calldata |
|--------|----------|
| FixedPrice | `approvePaymentToken(usdc, address(0))` |
| Ascending | `approvePaymentToken(usdc)` |

Salt scheme (example):

```text
keccak256(toBytes(`kargain:${chainId}:FixedPrice:approvePaymentToken:${usdcLower}`))
```

Predecessor: `bytes32(0)`. Delay: `timelock.getMinDelay()`.

**Feed freshness:** `setCurrencyFeed` / feed-bearing `approvePaymentToken` run `_validateFeed` at **execute** time. Live Chainlink aggregators stay fresh across 48h. Do not point Timelock ops at a static mock feed without refreshing it before execute.

### 6. Optional Timelock ops (rehearsed locally)

Same schedule → wait → execute path. Local suite proved each of:

- FixedPrice / Ascending: `unpause`, `setGuardian`, `upgradeToAndCall`, payment approve/revoke
- FixedPrice: `setCurrencyFeed`, `setMaxFeedStaleness`
- Ascending: `setAuctionRules`
- KarPassport: `addEncumbranceSource` / `removeEncumbranceSource` (post-handoff)

Encode with production ABIs (`lib/contracts/abis.generated.ts`). Upgrade salt should include new impl + VERSION.

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

Local deploy also **aborts** if encumbrance register fails before writing the manifest.

### 9. Bridge wire (after both commercial stacks)

```bash
pnpm bridge:wire:read-only   # audit first
pnpm bridge:wire             # when ready
```

---

## Rehearsal findings (do not silently “fix” in ops)

1. **`approvePaymentToken` at deploy is impossible as deployer** — owner is Timelock from the proxy create tx. SPEC §I.10 corrected; ops must schedule admission.
2. **Open without register remains possible on-chain** — tooling refuses a late/missing register; bytecode does not. Checklist until a future Solidity gate (stop-and-report if product requires the gate).
3. **`setCurrencyFeed` freshness is evaluated at Timelock execute** — live feeds OK; static feeds go stale across 48h.

---

## Post-deploy checklist

- [ ] Both manifests committed; `COMMERCIAL_ACTIVE` updated
- [ ] Guardian pause smoke on each mode
- [ ] USDC approved via Timelock on both modes / both chains
- [ ] Ponder reindexed; `/ready` + `/status`
- [ ] No consignment opened before encumbrance register (checklist)
- [ ] Bridge wire when both chains live
