# Nuclear #2 — full-stack deploy rehearsal runbook (84532 + 11155111)

Operator steps for the next commercial Nuclear wave. **Cursor never runs live txs** — execute these yourself. Local proof lives in `pnpm hardhat test test/nuclear-rehearsal.test.ts` (construction admission + Timelock expand/restore path).

| | |
|--|--|
| Scope | Timelock → KarPro → Passport → FixedPrice + Ascending (**owner=deployer**) → encumbrance register → **USDC admission** → gateway → **mode ownership handoff** → passport/staking handoff → post-handoff Timelock ops |
| Chains | Base Sepolia **84532** and Ethereum Sepolia **11155111** (identical protocol params) |
| Script | `pnpm deploy:sepolia` / `pnpm deploy:sepolia:eth` → [`scripts/deploy.ts`](../../../scripts/deploy.ts) |
| Dry-run | `pnpm deploy:nuclear:dry-run` (parity + structural encumbrance/admission order; no txs) |
| Local rehearsal | `pnpm hardhat test test/nuclear-rehearsal.test.ts` |
| Spec | [SPEC §I.10](../../contracts/SPEC.md#i10-deploy-sequence) |

---

## Prerequisites

- `.env.local`: `DEPLOYER_PRIVATE_KEY`, `COMMERCE_GUARDIAN` (EOA **distinct** from deployer and from Timelock)
- `pnpm compile`; `pnpm deploy:nuclear:dry-run` green
- Guardian key available for **pause** and **soft-revoke**; deployer is Timelock proposer + executor on both chains
- Modes refuse `open*` unless `isEncumbranceSource(mode)` (bytecode + tooling)

---

## Structural ordering (all abort the run)

| Constraint | Enforcement |
|------------|-------------|
| Mode proxies → `addEncumbranceSource` ×2 → admit USDC → gateway → mode handoff → passport handoff | **Structural** — `assertNuclearEncumbranceOrdering` in plan/dry-run |
| Register before gateway | Live/local deploy **aborts** if `isEncumbranceSource` is false |
| Admit before mode ownership handoff | Live/local deploy **aborts** if USDC not enabled on both modes |
| Open requires live encumbrance source | On-chain `ModeNotEncumbranceSource` in `ConsignmentBase._requireCanOpen` |

---

## Maintainer steps (order)

### 1. Dry-run parity

```bash
pnpm deploy:nuclear:dry-run
```

Confirm shared params, step list (includes admission + mode handoff), Timelock expand/restore ops, and guardian-immediate ops. Abort if ordering assert fails.

### 2. Deploy Base Sepolia (84532)

```bash
pnpm deploy:sepolia
```

Expect console:

- `✓ encumbrance sources registered (refusing gateway until this holds)`
- `✓ USDC admitted on both modes (refusing handoff until this holds)`

Record manifest `deployments/84532.json` addresses + `blocks.*` / `indexFromBlock`.

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
- Both modes: USDC payment token **enabled** (admitted at construction)
- `bridgeGateway()` bound

Prove guardian can `pause()` and `revokePaymentToken(usdc)` (soft-disable); guardian **cannot** `approvePaymentToken` / `unpause` — only Timelock schedule/execute those.

### 5. Post-handoff Timelock ops (feeds / re-approve / rules)

Initial USDC admission is **already done at deploy**. Use Timelock for later expands/restores:

| Target | Example |
|--------|---------|
| FixedPrice | `setCurrencyFeed`, `setMaxFeedStaleness`, re-`approvePaymentToken`, `unpause`, `setGuardian`, UUPS |
| Ascending | `setAuctionRules`, re-`approvePaymentToken`, `unpause`, `setGuardian`, UUPS |
| KarPassport | `addEncumbranceSource` / `removeEncumbranceSource` (post-handoff) |

Schedule → wait `getMinDelay()` (48h) → execute.

**Feed freshness:** `setCurrencyFeed` / feed-bearing `approvePaymentToken` run `_validateFeed` at **execute** time. Live Chainlink aggregators stay fresh across 48h. Do not point Timelock ops at a static mock feed without refreshing it before execute.

### 6. Guardian-immediate ops (no delay)

- `pause` / soft-`revokePaymentToken` on either mode
- Soft-revoke keeps decimals/feed so **in-flight** buy/bid/settle still complete; **new** opens in that asset fail until Timelock re-approves

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

Local deploy also **aborts** if encumbrance register or USDC admission fails before writing the manifest.

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

**Misplaced-ops (report only — not moved):** `removeEncumbranceSource` and clearing a currency feed reduce LeaveChain / quote surface but stay Timelock-delayed (shared with expand paths).

---

## Post-deploy checklist

- [ ] Both manifests committed; `COMMERCIAL_ACTIVE` updated
- [ ] Guardian pause + soft-revoke smoke on each mode
- [ ] USDC enabled on both modes / both chains (construction admission)
- [ ] Ponder reindexed; `/ready` + `/status`
- [ ] Bridge wire when both chains live
