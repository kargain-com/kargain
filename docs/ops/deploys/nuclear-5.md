# Nuclear #5 — S3.5 (84532 + 11155111)

**Status: DEPLOYED ON CHAIN — NOT CUT OVER** (August 29, 2026). Parallel stack live beside Nuclear #4. **Do not** edit `COMMERCIAL_ACTIVE`, reindex Ponder, or merge for app cutover until **S9**. App / indexer still serve Nuclear #4.

**Local only.** Empty-testnet full redeploy (same class as Nuclear #4). Manifests: `deployments/84532.json` · `deployments/11155111.json` (gitignored).

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

### Base Sepolia (84532) — `indexFromBlock` **46109033**

| Role | Address | On-chain |
|------|---------|----------|
| Timelock48h | `0x4e75F7d0D5847e6730da328F92890f1FcE3628F4` | upgrade authority after handoff |
| KarProPass | `0x3C2E19AdE259453D43a20E94D4Bf979250BC32c3` | |
| KarProStaking | `0x408c0DB8cDf1bC31aa69aD73bf260e70803a2379` | `VERSION` **2.2.0-rc.1**; owner = Timelock |
| KarPassport | `0x8542Dd53345d851a320C7d1B2e78E1786743a70e` | `VERSION` **1.10.0-rc.1**; Timelock; gateway bound |
| FixedPriceConsignment | `0x74a659E081317bB63Bb552ab1C3d886e4728CceE` | `VERSION` **2.4.0-rc.1**; Timelock; guardian as above; USDC asset-only (feed 0) |
| AscendingConsignment | `0x88821bfb1A2C9dAB404C4a86a88685469b74101a` | `VERSION` **2.5.0-rc.1**; Timelock |
| KarPassportBridgeGateway | `0x66aF522A26C7650f63Bc82f611a623F3E863888b` | `VERSION` **1.3.0-rc.1** — **S4 EVM peer for 40245↔40168** |
| AscendingHoldLib / OpenLib | `0x5a7027…f3eB` / `0x48856d…2f5B` | linked at Ascending impl |

### Ethereum Sepolia (11155111) — `indexFromBlock` **11590196**

| Role | Address | On-chain |
|------|---------|----------|
| Timelock48h | `0x8A3529d2B4CC482476Bd40f81a1E2F9E335867F7` | |
| KarProPass | `0xcAa270392eEa2AD4471C12267Ed9Bf7567ECa498` | |
| KarProStaking | `0xfe9b6477C32dB849E7C5520BF1e055b2e5ABA6C9` | **2.2.0-rc.1**; Timelock |
| KarPassport | `0x2961A0fDa331E1ecaF4e9F8A3515fe4346f60b2d` | **1.10.0-rc.1**; Timelock; gateway bound |
| FixedPriceConsignment | `0x6d1169F4b639Ee27442786b160FB3F06fDe6c28E` | **2.4.0-rc.1**; USDC feed measured + tolerance 172992 |
| AscendingConsignment | `0xD9Ea579DD90b4c5386A55688036d73B9d6bA5d4f` | **2.5.0-rc.1** |
| KarPassportBridgeGateway | `0x2f74620F74A9addb441225356Abe79b2691F39B9` | **1.3.0-rc.1** |

**Verify (best-effort):** Ascending + libs + FixedPrice proxy newly verified both explorers. KarPassport / KarProStaking / Gateway reported HHE80009 (non-`--strict`; on-chain deploy valid — confirm via VERSION reads above).

---

## What S3.5 source shipped

| Contract | VERSION | Change class |
|----------|---------|--------------|
| KarProPass | `1.1.0-rc.1` | Pair with staking |
| KarProStaking | `2.2.0-rc.1` | Native-only join; ERC-20 stake path removed |
| KarPassport | `1.10.0-rc.1` | Fresh deploy with modes |
| FixedPriceConsignment | `2.4.0-rc.1` | Unchanged logic |
| AscendingConsignment | `2.5.0-rc.1` | Seven auction bounds → constants; `setChallengeBond`; `AuctionRulesSet` at init |
| KarPassportBridgeGateway | `1.3.0-rc.1` | Fresh ctor → new passport |
| Timelock48h | fresh | New per chain (not reuse N4) |

**Deploy wiring (A1):** `platformRecipient` = fee sink; `forfeitRecipient` → passport ctor + Ascending forfeit (distinct).

---

## Ops sequencing (do not collapse)

| Operation | When | Status |
|-----------|------|--------|
| Deploy N5 both chains | now | **Done** August 29 |
| Wire 40245↔40161 on **new** gateways (optional before S4) | after N5 | Not run (old pathway stays on N4 for live app) |
| Wire 40245↔40168 (Solana) | **S4** against hub gateway `0x66aF522A…888b` | Pending |
| `COMMERCIAL_ACTIVE` + SPEC I.9 + VPS reindex + Vercel + merge | **S9 once** | Not started |

**Do not** run `bridge:wire:read-only` against N4 pathway as a N5 gate — that pathway is intentionally left for the live app until S9.

### Post-deploy gates (N7 template — every nuclear)

> **Верификация потребляет улику, которую уничтожает любая пересборка. Она не шаг, который можно отложить, — она шаг, который истекает.**

**Lesson:** Never clean-recompile between deploy and explorer verify; persist `build-info` in the same deploy write as the manifest — N6 lost the CID trail by wiping artifacts before verify.

1. Working tree clean — live deploy refuses dirty trees.
2. Deploy writes `deployments/{chainId}.build-info.json` + `.artifacts/` and manifest `buildInfoSha256` / `artifactDigests`.
3. **Do not recompile.**
4. `pnpm verify:deploy-evidence` (+ `--eth`) — refuses if evidence missing or artifacts rebuilt since deploy.
5. `pnpm verify:bytecode-identity` (+ `--eth`) — on-chain body ≡ repo.
6. `pnpm verify:sepolia` / `verify:sepolia:eth` — **evidence-backed direct submit** (`verify-from-deploy-evidence` + Etherscan standard-json); explorer must show verified source to a visitor. Hardhat verify is not the nuclear path.
7. Sourcify publish — record Match/Exact + `repo.sourcify.dev` URLs (first-class, not a fallback).
8. **Only then** recompile or `bridge:wire` (S4b against this hub only).
