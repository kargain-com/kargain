# Nuclear #6 — on-chain URI ceiling (84532 + 11155111)

**Status: DEPLOYED ON CHAIN — NOT CUT OVER** (August 29, 2026). Parallel stack live beside Nuclear #4 (and Nuclear #5). **Do not** edit `COMMERCIAL_ACTIVE`, reindex Ponder, or merge for app cutover until **S9**. App / indexer still serve Nuclear #4.

**Local only.** Empty-testnet full redeploy (same class as Nuclear #5). Manifests: `deployments/84532.json` · `deployments/11155111.json` (gitignored). N5 manifests preserved under `docs/ops/deploys/archive/nuclear-5-*.manifest.json` (local).

**Reason:** declare and enforce passport metadata URI ceiling **160** UTF-8 bytes on-chain (write + leave) so SVM over-ceiling inbound cannot become a permanently unexecutable destination tx (>1232). See SPEC §I.13 + D-20; headroom S4a-2 h=3 (production 18-meta computed **1208**/1232).

**Register:** no PENDING until S9 cutover planning.  
**Tooling:** `deploy:nuclear:dry-run`, `deploy:sepolia`, `deploy:sepolia:eth`, `verify:*`, `smoke:*`, `bridge:wire*`, `lz:snapshot`, `ponder:config`.  
**Keys:** hardhat/dotenv only — never log secrets.

---

## Role signers (filled at deploy)

| Role | Env var | Address |
|------|---------|---------|
| Fee sink (`platformRecipient`) | `PLATFORM_RECIPIENT` | `0x484f2e7bB362bCcE38d41DB7BCE2EAD955890B24` |
| Forfeit sink (`forfeitRecipient`) | `FORFEIT_RECIPIENT` | `0x8d97a127A3Cf9a94c460BcaA06a429FFE75eF1A1` |
| Commerce guardian | `COMMERCE_GUARDIAN` | `0xcfe194fea9727bD04dA8F78c2362680986e02dF1` |

Three **distinct** addresses. Fee/forfeit cold; guardian hot (pause). Deployer EOA separate.

---

## On-chain read-back (RPC August 29, 2026)

### Base Sepolia (84532) — `indexFromBlock` **46115424**

| Role | Address | On-chain |
|------|---------|----------|
| Timelock48h | `0xb2762a11C14991E5EdD5270c44ab10f5956E3aAA` | upgrade authority after handoff |
| KarProPass | `0x8E6D4e07f45913fcf94a92261AE51522141AAF9f` | |
| KarProStaking | `0xB081b8e3c6a5f72e07D5628F60A77Fb018BF0029` | `VERSION` **2.2.0-rc.1**; owner = Timelock |
| KarPassport | `0x8fc3325c2d018812Fcf782e3DE0f0F954B3f1915` | `VERSION` **1.11.0-rc.1**; Timelock; gateway bound |
| FixedPriceConsignment | `0x6aD4409089FcF8f2513b7E90CB7818d04D80Dedb` | `VERSION` **2.4.0-rc.1**; Timelock; guardian as above; USDC asset-only (feed 0) |
| AscendingConsignment | `0x6f309EdABCfcd3243E63eAc6EC2c476a9Ef3526e` | `VERSION` **2.5.0-rc.1**; Timelock |
| KarPassportBridgeGateway | `0xFA4FcEf7a1bF882438f70BaC63401410d4f6DB29` | `VERSION` **1.4.0-rc.1** — **S4 EVM peer for 40245↔40168** |
| AscendingHoldLib / OpenLib | `0x28ADFC…2a40` / `0x2dC244…0096` | linked at Ascending impl |

### Ethereum Sepolia (11155111) — `indexFromBlock` **11591272**

| Role | Address | On-chain |
|------|---------|----------|
| Timelock48h | `0xbAf046a0433644C5f8Eb16ceC1E42F4EF67A6802` | |
| KarProPass | `0x379BA6b8368Fc5C457fFaa4d7b5816a335754b3E` | |
| KarProStaking | `0x2F1036251227EdaFaC51934AB5157854d2632Dc4` | **2.2.0-rc.1**; Timelock |
| KarPassport | `0xFCC3FB7e926483778898f8Dd38bDb1Db51412a41` | **1.11.0-rc.1**; Timelock; gateway bound |
| FixedPriceConsignment | `0xf06BD41AA01BC31Dcb9e9B4eAA739E170A29147b` | **2.4.0-rc.1**; USDC feed measured + tolerance 172992 |
| AscendingConsignment | `0x77C881b9FB3cD425367c99378588b2790669F51F` | **2.5.0-rc.1** |
| KarPassportBridgeGateway | `0xb9B649e13cA11a87c8842dD593E2008FBd130ECb` | **1.4.0-rc.1** |

**Verify (best-effort):** Ascending + libs + FixedPrice proxy newly verified both explorers. KarPassport / KarProStaking / Gateway reported **bytecode_mismatch** (non-`--strict`; same class as N5 HHE80009) — on-chain deploy valid; confirm via VERSION reads above. Re-run verify with matching artifact / `--force` before treating explorer source as green for cutover.

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

## Ops sequencing (do not collapse)

| Operation | When | Status |
|-----------|------|--------|
| N6 source | August 29 | **Done** |
| Deploy N6 both chains | August 29 | **Done** |
| Wire 40245↔40161 on **new** N6 gateways | optional before S4 | Not run (N4 pathway stays for live app) |
| Wire 40245↔40168 (Solana) | **S4b+** against hub gateway `0xFA4FcEf7…DB29` | Pending |
| `COMMERCIAL_ACTIVE` + SPEC I.9 + VPS reindex + Vercel + merge | **S9 once** | Not started |

**Do not** run `bridge:wire:read-only` against N4 pathway as an N6 gate — that pathway stays for the live app until S9.
