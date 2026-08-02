# Nuclear #4 — sell UNVERIFIED + ascending-only VERIFIED (84532 + 11155111)

**Status: LIVE** (August 2, 2026). Both commercial chains cut over; PENDING Nuclear #4 closed.

**Local only.** Empty-testnet full redeploy of the commercial stack. KarPassport is immutable → not UUPS-in-place. No 48h wait for mode upgrades on this path.

**Register:** [PENDING-REDEPLOY.md](../../PENDING-REDEPLOY.md) — empty (Nuclear #4 closed).  
**Tooling:** existing `deploy:nuclear:dry-run`, `deploy:sepolia`, `deploy:sepolia:eth`, `verify:*`, `smoke:*`, `bridge:wire*`, `lz:snapshot`, `ponder:config`; Phase F spot-check `scripts/nuclear-4-live-proof.ts`.  
**Keys:** hardhat/dotenv only — never log secrets.

---

## What this ships (bytecode)

| Contract | New VERSION | Why fresh |
|----------|-------------|-----------|
| KarProPass | `1.1.0-rc.1` (unchanged) | Nuclear order; new address with staking |
| KarProStaking | `2.1.0-rc.1` (unchanged) | Nuclear order |
| KarPassport | `1.10.0-rc.1` | Drop VERIFIED from `may(OpenConsignment)`; unlock `VerificationReset` only from VERIFIED |
| FixedPriceConsignment | `2.4.0-rc.1` (unchanged source) | Address cutover; open UNVERIFIED via passport `may` |
| AscendingConsignment | `2.4.0-rc.1` | `PassportNotVerified` at ascending open only |
| KarPassportBridgeGateway | `1.3.0-rc.1` (unchanged logic) | Constructor binds new passport |
| Timelock48h | may reuse or redeploy | Prefer existing Timelock if still trusted |

**Product law after cutover:**

- Fixed-price open/grant while UNVERIFIED allowed (encumbrance permitting).
- Ascending **open** requires VERIFIED; ascending **grant** may precede verify.
- Never-verified bridge return does not emit `VerificationReset` (no false reset banner).

**One-shot (cannot fix without another Nuclear):**

- Gateway ctor passport argument  
- `passport.setBridgeGateway` (`GatewayAlreadySet`)  
- Passport `karProStakingAddress` immutable at initialize  

---

## Prerequisites

1. Source + Phase D gates green.  
2. `.env.local`: `DEPLOYER_PRIVATE_KEY`, `COMMERCE_GUARDIAN` (≠ deployer, ≠ Timelock).  
3. `pnpm compile`  
4. `pnpm deploy:nuclear:dry-run` green (parity + feeds + encumbrance order).

---

## Steps (do in order)

### 0 — Dry-run

```bash
pnpm deploy:nuclear:dry-run
```

**Produces:** parity table 84532 vs 11155111; step list; feed freshness; USDC admit note (84532 feed=0).  
**Must be true before next:** exit 0; shared params identical; no ordering abort.

---

### 1 — Deploy Base Sepolia (84532)

```bash
pnpm deploy:sepolia
```

**Produces:** `deployments/84532.json` (addresses, blocks, `indexFromBlock`, VERSIONS).  
**Script order (do not reorder by hand):** Timelock → KarProPass → KarProStaking → setStaking → KarPassport → FixedPrice → Ascending libs/impl/proxy → `addEncumbranceSource` ×2 → admit USDC → gateway → `setBridgeGateway` → transfer ownership to Timelock.

**Read back over RPC before next:**

| Check | Expect |
|-------|--------|
| `KarPassport.VERSION` | `1.10.0-rc.1` |
| `Ascending.VERSION` / `FixedPrice.VERSION` | `2.4.0-rc.1` / `2.4.0-rc.1` |
| `KarProStaking.VERSION` | `2.1.0-rc.1` |
| `passport.bridgeGateway()` | new gateway |
| `isEncumbranceSource(fixedPrice)` / `(ascending)` | true |
| USDC enabled on both modes | true; FixedPrice feed **zero** |
| `owner()` modes/passport/staking | Timelock |

**Functional spot-check (optional before Eth):** UNVERIFIED FixedPrice open succeeds; Ascending open UNVERIFIED reverts `PassportNotVerified`.

**One-shot already spent:** `setBridgeGateway`. Wrong gateway → new passport Nuclear.

---

### 2 — Deploy Ethereum Sepolia (11155111)

```bash
pnpm deploy:sepolia:eth
```

**Produces:** `deployments/11155111.json`.  
**Same read-back as step 1**, except FixedPrice USDC feed = measured `0xA2F78…` tolerance **172992**.

---

### 3 — Verify (best-effort)

```bash
pnpm verify:sepolia
pnpm verify:sepolia:eth
```

**Produces:** Etherscan matches. HHE80009 → non-blocking unless `--strict`.

---

### 4 — LayerZero wire (both new gateways)

```bash
pnpm lz:snapshot          # if snapshot stale
pnpm bridge:wire:read-only
pnpm bridge:wire
```

**Produces:** peers + `enforcedOptions` + `pathwayConfigHash`.  
**Read back:** reciprocal peers; hash recorded in both manifests / SPEC after cutover.  
**Must be true before smoke bridge:** read-only exit 0 (or known clean diffs only).

---

### 5 — Smoke

```bash
pnpm smoke:sepolia
# with a home passport token you mint after cutover:
pnpm smoke:bridge --token-id <id>
```

**Must be true:** smoke PASS; bridge delivery on dest RPC.

---

### 6 — App + indexer cutover (same change window as mirrors)

1. Archive Nuclear #3 manifests under `docs/ops/deploys/archive/`.  
2. Cut over `COMMERCIAL_ACTIVE` + denylist Nuclear #3 addresses + SPEC I.9.  
3. Close PENDING Nuclear #4 entry.  
4. `pnpm ponder:config` (sanity).  
5. VPS: pull → set new `indexFromBlock` values → rebuild ponder → **full reindex** ([OPERATIONS.md](../../indexer/OPERATIONS.md)).  
6. Smoke: `/ready`, `/status`, `/consignments`, obligations, notifications.  
7. Deploy app.  
8. Phase F live matrix: **spot-check done on 84532** (`scripts/nuclear-4-live-proof.ts` — FixedPrice UNVERIFIED open; Ascending → `PassportNotVerified`). Optional remainder: grant UNVERIFIED → verify → ascending open; VERIFIED bridge consent → list OK; never-verified return → no reset banner.

---

## P4 admit reminders (baked into deploy script)

| Chain | USDC | Fiat×USDC |
|-------|------|-----------|
| 84532 | feed `0`, asset-only | Must refuse in UI |
| 11155111 | measured feed, tol 172992 | Allowed |

Native tolerances: 84532 **2444s**; 11155111 **7392s**.

---

## Do not

- UUPS-upgrade old mode proxies “to save addresses” for this Nuclear.  
- Partial deploy of one entry.  
- Update address tables before RPC read-back.  
- Call Timelock expand ops before handoff completes.
