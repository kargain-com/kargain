# Nuclear #6 — on-chain URI ceiling (84532 + 11155111)

**Status: SOURCE READY — NOT DEPLOYED / NOT CUT OVER** (August 29, 2026). Founder runs this runbook when ready. **Do not** edit `COMMERCIAL_ACTIVE`, reindex Ponder, or merge for app cutover until **S9**. App / indexer still serve Nuclear #4. Nuclear #5 remains on-chain beside N4 until replaced by N6 (or retired by founder).

**Local only.** Empty-testnet full redeploy (same class as Nuclear #5). Manifests: `deployments/84532.json` · `deployments/11155111.json` (gitignored).

**Reason:** declare and enforce passport metadata URI ceiling **160** UTF-8 bytes on-chain (write + leave) so SVM over-ceiling inbound cannot become a permanently unexecutable destination tx (>1232). See SPEC §I.13 + D-20; headroom S4a-2 h=3 (production 18-meta computed **1208**/1232).

**Register:** no PENDING until S9 cutover planning.  
**Tooling:** `deploy:nuclear:dry-run`, `deploy:sepolia`, `deploy:sepolia:eth`, `verify:*`, `smoke:*`, `bridge:wire*`, `lz:snapshot`, `ponder:config`.  
**Keys:** hardhat/dotenv only — never log secrets.

---

## Role signers (carry from Nuclear #5)

| Role | Env var | Address |
|------|---------|---------|
| Fee sink (`platformRecipient`) | `PLATFORM_RECIPIENT` | `0x484f2e7bB362bCcE38d41DB7BCE2EAD955890B24` |
| Forfeit sink (`forfeitRecipient`) | `FORFEIT_RECIPIENT` | `0x8d97a127A3Cf9a94c460BcaA06a429FFE75eF1A1` |
| Commerce guardian | `COMMERCE_GUARDIAN` | `0xcfe194fea9727bD04dA8F78c2362680986e02dF1` |

Three **distinct** addresses. Fee/forfeit cold; guardian hot (pause). Deployer EOA separate.

---

## What Nuclear #6 source ships

| Contract | VERSION | Change class |
|----------|---------|--------------|
| KarPassport | `1.11.0-rc.1` | `_setTokenURIChecked` + `UriTooLong`; ceiling `PassportUriCeiling.BYTES` |
| KarPassportBridgeGateway | `1.4.0-rc.1` | `_buildMsgAndOptionsWithUri` + `UriExceedsBridgeCeiling` before debit |
| KarProPass | `1.1.0-rc.1` | Unchanged logic (fresh ctor pair) |
| KarProStaking | `2.2.0-rc.1` | Unchanged logic |
| FixedPriceConsignment | `2.4.0-rc.1` | Unchanged logic |
| AscendingConsignment | `2.5.0-rc.1` | Unchanged logic |
| Timelock48h | fresh | New per chain (not reuse N4/N5) |

SVM mirrors the same ceiling (write / send); receive never length-rejects.

---

## Founder deploy checklist (after this source lands)

1. `pnpm deploy:nuclear:dry-run` — confirm VERSIONS `1.11.0-rc.1` / `1.4.0-rc.1`.
2. Deploy both chains (`deploy:sepolia` + `deploy:sepolia:eth`) with the three roles above.
3. Record addresses + `indexFromBlock` in this file (on-chain read-back section — fill after RPC).
4. **Re-verify** Passport / Staking / Gateway; resolve explorer **HHE80009** (non-strict) before treating verify as green — same class as N5.
5. Optional: wire 40245↔40161 on **new** N6 gateways.
6. **S4 pathway** must target the **N6 hub gateway** after this deploy (not N5 `0x66aF522A…888b` once N6 lands).
7. **Do not** cut over (`COMMERCIAL_ACTIVE` / reindex / Vercel) until **S9**.

---

## Ops sequencing (do not collapse)

| Operation | When | Status |
|-----------|------|--------|
| N6 source (this initiative) | now | **Done** August 29 (code) |
| Deploy N6 both chains | founder | **Not started** |
| Wire 40245↔40168 (Solana) | **S4b+** against **N6** hub gateway | Pending N6 deploy |
| `COMMERCIAL_ACTIVE` + SPEC I.9 + VPS reindex + Vercel + merge | **S9 once** | Not started |

**Do not** run `bridge:wire:read-only` against N4 pathway as an N6 gate — that pathway stays for the live app until S9.
