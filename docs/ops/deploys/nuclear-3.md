# Nuclear #3 — full commercial redeploy (84532 + 11155111)

**Local only.** Empty testnets: deploy **every** contract fresh. No UUPS-in-place. No stake/passport migration. No 48h wait for mode upgrades.

**Register:** [PENDING-REDEPLOY.md](../../PENDING-REDEPLOY.md) entries **1–6**.  
**Tooling:** existing `deploy:nuclear:dry-run`, `deploy:sepolia`, `deploy:sepolia:eth`, `verify:*`, `smoke:*`, `bridge:wire*`, `lz:snapshot`, `ponder:config`.  
**Cursor never signs txs or reads `.env` keys.**

---

## What this ships (bytecode)

| Contract | New VERSION | Why fresh |
|----------|-------------|-----------|
| KarProPass | `1.1.0-rc.1` (unchanged) | Nuclear order; new address with staking |
| KarProStaking | `2.1.0-rc.1` | S33, S34, S35 |
| KarPassport | `1.9.0-rc.1` | S30 |
| FixedPriceConsignment | `2.4.0-rc.1` | S32, S36, §5 floor |
| AscendingConsignment | `2.3.0-rc.1` | S32, S36, S30, NatSpec |
| KarPassportBridgeGateway | `1.3.0-rc.1` (unchanged logic) | Constructor binds new passport |
| Timelock48h | may reuse or redeploy | Prefer existing Timelock if still trusted; script may deploy new |

**One-shot (cannot fix without another Nuclear):**

- Gateway ctor passport argument  
- `passport.setBridgeGateway` (`GatewayAlreadySet`)  
- Passport `karProStakingAddress` immutable at initialize  

---

## Prerequisites

1. Source + gates green (this prep task).  
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
| `KarPassport.VERSION` | `1.9.0-rc.1` |
| `KarProStaking.VERSION` | `2.1.0-rc.1` |
| `FixedPrice.VERSION` / `Ascending.VERSION` | `2.4.0-rc.1` / `2.3.0-rc.1` |
| `passport.bridgeGateway()` | new gateway |
| `isEncumbranceSource(fixedPrice)` / `(ascending)` | true |
| USDC enabled on both modes | true; FixedPrice feed **zero** |
| `owner()` modes/passport/staking | Timelock |
| `windowDuration()` on passport + ascending | `1209600` |

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

1. Update `COMMERCIAL_ACTIVE` + SPEC **I.9.1 / I.9.2** + HANDOFF deployed-state **from RPC** (not from memory).  
2. Confirm `lib/commerce/agented-split.ts` already matches S32 (shipped in prep).  
3. `pnpm ponder:config`  
4. VPS: pull → rebuild ponder → **full reindex** from new `indexFromBlock` ([OPERATIONS.md](../../indexer/OPERATIONS.md)).  
5. Smoke: `/ready`, `/status`, `/consignments`, obligations, notifications.  
6. Deploy app.  
7. Close PENDING-REDEPLOY entries **1–6** with this deploy record.

---

## P4 admit reminders (baked into deploy script)

| Chain | USDC | Fiat×USDC |
|-------|------|-----------|
| 84532 | feed `0`, asset-only | Must refuse in UI |
| 11155111 | measured feed, tol 172992 | Allowed |

Native tolerances: 84532 **2444s**; 11155111 **7392s**.

---

## Do not

- UUPS-upgrade old mode proxies “to save addresses” on this empty testnet.  
- Partial deploy of one entry.  
- Update address tables before RPC read-back.  
- Call Timelock expand ops before handoff completes.
