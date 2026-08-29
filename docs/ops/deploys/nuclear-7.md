# Nuclear #7 — explorer-verifiable redeploy (identical source)

**Status: READY TO DEPLOY — NOT STARTED.** Parallel stack beside Nuclear #4 (live app), #5, and #6. **Do not** edit `COMMERCIAL_ACTIVE`, reindex Ponder, or merge for app cutover until **S9**. App / indexer still serve Nuclear #4.

**Local only.** Empty-testnet full redeploy. Manifests: `deployments/84532.json` · `deployments/11155111.json` (gitignored). N6 manifests must be archived locally before overwrite.

**Reason:** Nuclear #6 executable bodies match this repository (`verify:bytecode-identity`), and Sourcify accepted **Match** on Passport / Staking / Gateway, but **Basescan and Etherscan** still show those three unverified — deploy-time `build-info` was wiped before explorer verify (N6-9 V1/V2, N6-10). Nuclear #7 redeploys **the same source** with N6-9 V3 evidence retention so explorers can verify **before** any recompile. No contract, SPEC, or VERSION change.

**Register:** no PENDING until S9 cutover planning.  
**Tooling:** `deploy:nuclear:dry-run`, `deploy:sepolia`, `deploy:sepolia:eth`, `verify:deploy-evidence`, `verify:bytecode-identity`, `verify:sepolia`, `verify:sepolia:eth`, Sourcify v2, `smoke:*`, `bridge:wire*` (**not in this runbook**), `lz:snapshot`, `ponder:config`.  
**Keys:** hardhat/dotenv only — never log secrets.

**Lesson (N6):** Never clean-recompile between deploy and explorer verify; persist `build-info` in the same deploy write as the manifest — N6 lost the CID trail by wiping artifacts before verify.

---

## No source changes

| Contract | VERSION (unchanged from N6) |
|----------|-------------------------------|
| KarPassport | `1.11.0-rc.1` |
| KarPassportBridgeGateway | `1.4.0-rc.1` |
| KarProPass | `1.1.0-rc.1` |
| KarProStaking | `2.2.0-rc.1` |
| FixedPriceConsignment | `2.4.0-rc.1` |
| AscendingConsignment | `2.5.0-rc.1` |
| Timelock48h | fresh per chain (new address; same source) |

Expected CBOR-stripped executable bodies ≡ N6-8 / `verify:bytecode-identity` (Passport / Staking / Gateway digests unchanged in source).

---

## Role signers (carried forward from N6)

| Role | Env var | Address |
|------|---------|---------|
| Fee sink (`platformRecipient`) | `PLATFORM_RECIPIENT` | `0x484f2e7bB362bCcE38d41DB7BCE2EAD955890B24` |
| Forfeit sink (`forfeitRecipient`) | `FORFEIT_RECIPIENT` | `0x8d97a127A3Cf9a94c460BcaA06a429FFE75eF1A1` |
| Commerce guardian | `COMMERCE_GUARDIAN` | `0xcfe194fea9727bD04dA8F78c2362680986e02dF1` |

Three **distinct** addresses. Fee/forfeit cold; guardian hot (pause). Deployer EOA separate.

---

## Binding step order (do not reorder)

Each step exists so the next cannot destroy or ignore evidence.

| # | Step | Why it precedes the next |
|---|------|---------------------------|
| 1 | Clean tree (`git status --porcelain` empty) + **one** `pnpm compile` | Live deploy refuses dirty trees; compile once so deploy and verify share one artifact set |
| 2 | `pnpm deploy:nuclear:dry-run` | Refuse live deploy on plan / role / feed drift |
| 3 | `pnpm deploy:sepolia` then `pnpm deploy:sepolia:eth` | Writes manifests **and** `{chainId}.build-info.json` + `.artifacts/` + `buildInfoSha256` / `artifactDigests` in the **same** deploy |
| 4 | **Do not recompile** | Any clean rebuild changes metadata CID → explorer HHE80009 (N6 failure mode) |
| 5 | `pnpm verify:deploy-evidence` then `--eth` | Refuses explorer verify if build-info missing, digest mismatch, or on-disk artifacts rebuilt since deploy |
| 6 | `pnpm verify:bytecode-identity` then `--eth` | Proves on-chain body ≡ repo **before** publishing source |
| 7 | `pnpm verify:sepolia` / `verify:sepolia:eth` | Restores stored build-info; Basescan / Etherscan must show verified source to a visitor |
| 8 | Sourcify publish | First-class second public route; record Match/Exact + `repo.sourcify.dev` URLs |
| 9 | Recompile / `bridge:wire` | **Only after** explorers are green. **S4b** wires against **this** hub gateway — never against N6 |

**Stop rule:** if step 7 leaves Passport / Staking / Gateway unverified on the explorer, **do not** start S4b. Debug with the intact `build-info` on disk.

---

## On-chain read-back (fill after deploy)

### Base Sepolia (84532) — `indexFromBlock` **________**

| Role | Address | On-chain |
|------|---------|----------|
| Timelock48h | | |
| KarProPass | | |
| KarProStaking | | `VERSION` **2.2.0-rc.1** |
| KarPassport | | `VERSION` **1.11.0-rc.1** |
| FixedPriceConsignment | | `VERSION` **2.4.0-rc.1** |
| AscendingConsignment | | `VERSION` **2.5.0-rc.1** |
| KarPassportBridgeGateway | | `VERSION` **1.4.0-rc.1** — **S4b EVM peer for 40245↔40168** |
| AscendingHoldLib / OpenLib | | |

### Ethereum Sepolia (11155111) — `indexFromBlock` **________**

| Role | Address | On-chain |
|------|---------|----------|
| Timelock48h | | |
| KarProPass | | |
| KarProStaking | | **2.2.0-rc.1** |
| KarPassport | | **1.11.0-rc.1** |
| FixedPriceConsignment | | **2.4.0-rc.1** |
| AscendingConsignment | | **2.5.0-rc.1** |
| KarPassportBridgeGateway | | **1.4.0-rc.1** |

---

## Public verification outcomes (fill after steps 7–8)

### Explorer (visitor)

| Chain | Contract | Visitor sees |
|-------|----------|--------------|
| 84532 | KarPassport | |
| 84532 | KarProStaking | |
| 84532 | KarPassportBridgeGateway | |
| 11155111 | KarPassport | |
| 11155111 | KarProStaking | |
| 11155111 | KarPassportBridgeGateway | |

### Sourcify (first-class; not a fallback)

| Chain | Contract | Match | URL |
|-------|----------|-------|-----|
| 84532 | KarPassport | | `https://repo.sourcify.dev/84532/…` |
| 84532 | KarProStaking | | |
| 84532 | KarPassportBridgeGateway | | |
| 11155111 | KarPassport | | |
| 11155111 | KarProStaking | | |
| 11155111 | KarPassportBridgeGateway | | |

---

## Ops sequencing (do not collapse)

| Operation | When | Status |
|-----------|------|--------|
| N7-0 runbook + evidence guard | August 29 | **Done** (this file) |
| Deploy N7 both chains | after N7-0 | Not started |
| Explorer + Sourcify green | immediately after deploy; **before** recompile | Not started |
| Wire 40245↔40161 on **N7** gateways | optional before S4b | Not started |
| Wire 40245↔40168 (Solana) | **S4b** against **N7** hub gateway only | Blocked until N7 explorer-green |
| `COMMERCIAL_ACTIVE` + SPEC I.9 + VPS reindex + Vercel + merge | **S9 once** | Not started |

**Do not** wire any LayerZero pathway against Nuclear #6 (`0xFA4FcEf7…DB29`). **Do not** run `bridge:wire` in this runbook.
