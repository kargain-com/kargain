# Nuclear #7 — explorer-verifiable redeploy (identical source)

> **Верификация потребляет улику, которую уничтожает любая пересборка. Она не шаг, который можно отложить, — она шаг, который истекает.**

**Status: DEPLOYED ON CHAIN — S9-A CUTOVER ON BRANCH** (code September 4, 2026; chain August 29, 2026). `COMMERCIAL_ACTIVE` + SPEC I.9 on `feat/solana-svm-port` point at Nuclear #7. Explorers **green**. **Production `master` / VPS** still Nuclear #4 until Merge + one Ponder reindex (`svm-ingest` **off** for S9-A). Solana commercial row = **S9-B** after S9-0 Devnet modes.

**Local only.** Empty-testnet full redeploy. Manifests: `deployments/84532.json` · `deployments/11155111.json` (gitignored). N6 manifests archived: `docs/ops/deploys/archive/nuclear-6-*.manifest.json`.

**Reason:** Nuclear #6 executable bodies matched this repository, and Sourcify accepted Match, but Basescan/Etherscan stayed unverified after deploy-time `build-info` was wiped. Nuclear #7 redeployed **the same source** with V3 evidence retained and verify run **before** any recompile.

**Register:** no PENDING until S9 cutover planning.  
**Tooling:** `deploy:nuclear:dry-run`, `deploy:sepolia`, `deploy:sepolia:eth`, `verify:deploy-evidence`, `verify:bytecode-identity`, `verify:sepolia`, `verify:sepolia:eth`, Sourcify v2, `smoke:*`, `bridge:wire*` (**not run**), `lz:snapshot`, `ponder:config`.  
**Keys:** hardhat/dotenv only — never log secrets.

**Operational corollary:** Never clean-recompile between deploy and explorer verify; persist `build-info` in the same deploy write as the manifest.

**Evidence retained:** `buildInfoId` `solc-0_8_28-d1dd7ab974322c2542077f435e3cfc8b2dd9993a` · `buildInfoSha256` `84c0a0ea1281ae0971e3a6189dfb496e90288c1e71fae33503cc7ea2ac5e46da` · `deployGitHead` `724e529…` · both `{chainId}.build-info.json` on disk (intact after verify).

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

---

## Role signers (carried forward from N6)

| Role | Env var | Address |
|------|---------|---------|
| Fee sink (`platformRecipient`) | `PLATFORM_RECIPIENT` | `0x484f2e7bB362bCcE38d41DB7BCE2EAD955890B24` |
| Forfeit sink (`forfeitRecipient`) | `FORFEIT_RECIPIENT` | `0x8d97a127A3Cf9a94c460BcaA06a429FFE75eF1A1` |
| Commerce guardian | `COMMERCE_GUARDIAN` | `0xcfe194fea9727bD04dA8F78c2362680986e02dF1` |

Three **distinct** addresses. Fee/forfeit cold; guardian hot (pause). Deployer EOA separate.

---

## Binding step order (executed)

| # | Step | Result |
|---|------|--------|
| 1 | Clean tree + one compile | Done (`724e529`) |
| 2 | `pnpm deploy:nuclear:dry-run` | Zero drift |
| 3 | `pnpm deploy:sepolia` then `pnpm deploy:sepolia:eth` | Done — build-info persisted both chains |
| 4 | **Did not recompile** | Held |
| 5 | `pnpm verify:deploy-evidence` (+ `--eth`) | **OK** both |
| 6 | `pnpm verify:bytecode-identity` (+ `--eth`) | **11/11** both |
| 7 | `pnpm verify:sepolia` / `:eth` | Modes/libs OK; Passport/Staking/Gateway **HHE80009** (Hardhat-local) |
| 7b | Visitor `getsourcecode` (at deploy) | Passport / Staking / Gateway **NOT verified** |
| 8 | Sourcify | **exact_match** ×6 |
| 9 | `bridge:wire` | **Not run** at deploy (stop rule) |
| N7-1 | Direct standard-json submit | Explorer **Pass - Verified** ×6 visitors green; Hardhat verify retired from nuclear path |

**Stop rule at deploy was correct** (visitors red). **N7-1** proved the explorer accepts the retained evidence when submitted directly; nuclear verify no longer uses Hardhat.
---

## On-chain read-back (RPC August 29, 2026)

### Base Sepolia (84532) — `indexFromBlock` **46119704**

| Role | Address | On-chain |
|------|---------|----------|
| Timelock48h | `0xfDe4c336b23e3a21A3460bA005B4710584E43f27` | upgrade authority after handoff |
| KarProPass | `0x003f379c8592Aab993b43770414C9033fCD7004C` | |
| KarProStaking | `0x86a3911bd2e06990D2fedE37C9C552f5fFfC4e99` | `VERSION` **2.2.0-rc.1** |
| KarPassport | `0x3A7742eac882769351dF11112bf2f8bf2D11a7A5` | `VERSION` **1.11.0-rc.1** |
| FixedPriceConsignment | `0xEc97fC815055CBD51746F7D6966340a1318Ac6F8` | `VERSION` **2.4.0-rc.1** |
| AscendingConsignment | `0x496351CD0788c7312DEeA4b15dA71B521d534dc5` | `VERSION` **2.5.0-rc.1** |
| KarPassportBridgeGateway | `0x7324046854342587999984683c4833852FA81827` | `VERSION` **1.4.0-rc.1** — **S4b EVM peer for 40245↔40168** (explorers green after N7-1) |
| AscendingHoldLib / OpenLib | `0xb9223736…556d` / `0x3A86425F…179e` | linked at Ascending impl |

### Ethereum Sepolia (11155111) — `indexFromBlock` **11591966**

| Role | Address | On-chain |
|------|---------|----------|
| Timelock48h | `0xbD13C4B92d7Ec454401AE242A0aa8E841EEba977` | |
| KarProPass | `0x886328c407998EA493b757bE9d49034624F8f4BE` | |
| KarProStaking | `0xF4bCec8dC6f699c311d75c7aaEb7790c76f0FF43` | **2.2.0-rc.1** |
| KarPassport | `0x1FFdEC27d14567B34548BA63269c0745227f1949` | **1.11.0-rc.1** |
| FixedPriceConsignment | `0xDf8412E8d61675523AB0843d0A24Fd6E22dD10Ab` | **2.4.0-rc.1** |
| AscendingConsignment | `0x233B0e6780d52275caE1f1d08035F6a3C932B99E` | **2.5.0-rc.1** |
| KarPassportBridgeGateway | `0x910631Df5aA4d47Ce20a6D485cd9DdC2E68D8eBc` | **1.4.0-rc.1** |

---

## Public verification outcomes (N7-1)

### Explorer (visitor) — goal of N7 — **GREEN after N7-1**

| Chain | Contract | Visitor sees |
|-------|----------|--------------|
| 84532 | KarPassport | **Verified** (Basescan) |
| 84532 | KarProStaking | **Verified** |
| 84532 | KarPassportBridgeGateway | **Verified** |
| 11155111 | KarPassport | **Verified** (Etherscan) |
| 11155111 | KarProStaking | **Verified** |
| 11155111 | KarPassportBridgeGateway | **Verified** |

Modes / Ascending libs / proxies: verified earlier via Hardhat path (still green).

### N7-1 diagnosis — Hardhat vs direct submit (August 29, 2026)

**S1:** With restored `{chainId}.build-info.json`, Hardhat `verify etherscan` for hub KarPassport **did** contact Basescan (stdout: two “Submitted source code…” attempts — minimal input failed, full solc input passed). No `HHE80009` in that run. Earlier N7 deploy-time `HHE80009` was therefore a **local Hardhat abort / wrong compare path**, not an explorer refusal of good artifacts. HTTP spy on `http.request` alone is insufficient (Hardhat uses fetch/undici).

**S2:** Direct `verifysourcecode` with `codeformat=solidity-standard-json-input` from stored build-info + ABI-encoded ctor args — explorer verbatim:

| Chain | Contract | Verdict |
|-------|----------|---------|
| 84532 | KarProStaking | `Pass - Verified` |
| 84532 | KarPassport | already verified (from S1) |
| 84532 | Gateway | `Pass - Verified` |
| 11155111 | KarProStaking | `Pass - Verified` |
| 11155111 | KarPassport | `Pass - Verified` |
| 11155111 | Gateway | `Pass - Verified` |

**S3:** Nuclear `pnpm verify:sepolia` / `:eth` now submits from stored evidence via `scripts/lib/verify-from-deploy-evidence.ts` + `etherscan-api.ts`. Hardhat verify is **retired** from the nuclear runbook path.

### Sourcify (first-class; Exact Match)

| Chain | Contract | Match | URL |
|-------|----------|-------|-----|
| 84532 | KarPassport | exact_match | https://repo.sourcify.dev/84532/0x3A7742eac882769351dF11112bf2f8bf2D11a7A5 |
| 84532 | KarProStaking | exact_match | https://repo.sourcify.dev/84532/0x86a3911bd2e06990D2fedE37C9C552f5fFfC4e99 |
| 84532 | KarPassportBridgeGateway | exact_match | https://repo.sourcify.dev/84532/0x7324046854342587999984683c4833852FA81827 |
| 11155111 | KarPassport | exact_match | https://repo.sourcify.dev/11155111/0x1FFdEC27d14567B34548BA63269c0745227f1949 |
| 11155111 | KarProStaking | exact_match | https://repo.sourcify.dev/11155111/0xF4bCec8dC6f699c311d75c7aaEb7790c76f0FF43 |
| 11155111 | KarPassportBridgeGateway | exact_match | https://repo.sourcify.dev/11155111/0x910631Df5aA4d47Ce20a6D485cd9DdC2E68D8eBc |


---

## Ops sequencing (do not collapse)

**S9-A founder cutover order — wire before Merge** (do not invert):

| Step | What changes | Reversible? | Verify |
|------|----------------|-------------|--------|
| 1. Hub↔eth `pnpm bridge:wire` (N7 peers) | On-chain peers / ULN / options / `pathwayConfigHash` | Partial (re-wire / new nuclear) | `bridge:wire:read-only` PASS; hash ≡ SPEC `0x2914d89d…f834` |
| 2. Merge branch → `master` | Vercel serves N7 `COMMERCIAL_ACTIVE` | Deploy previous commit | App addresses ≡ I.9 |
| 3. VPS `ponder-reindex.sql` | Wipe+reindex `kargain` from **46119704** / **11591966** | Costly; not silent | `/ready` + `/status`; smoke consignments |
| 4. Empty `projection-schema.sql` | Empty SVM UNION arm | Re-apply | UNION HTTP 200 |
| 5. Confirm `svm-ingest` **off** | — | — | compose / process absent |

**Do not Merge before wire** — otherwise the bridge UI offers send on a pathway with no peers.

| Operation | When | Status |
|-----------|------|--------|
| N7-0 runbook + evidence guard | August 29 | **Done** |
| Deploy N7 both chains | August 29 | **Done** |
| Evidence + bytecode-identity | August 29 | **Done** — green |
| Explorer visitor green (Passport/Staking/Gateway) | August 29 | **Done (N7-1)** — direct standard-json submit |
| Sourcify Exact Match ×6 | August 29 | **Done** |
| Wire 40245↔40168 (Solana) | **S4b** against N7 hub `0x73240468…1827` | Ready for S4b (needs Squads + DVN) |
| `COMMERCIAL_ACTIVE` + SPEC I.9 (branch) | **S9-A** | **Done on branch** — forfeit sink distinct; N4/N5/N6 denylisted; manifest ≡ registry fail-closed |
| Hub↔eth `bridge:wire` → Merge → VPS reindex → empty projection → `svm-ingest` off | **S9-A ops** | Founder — **wire first**; start blocks **46119704** / **11591966** |
| Solana row + `svm-ingest` + three-network walk | **S9-B** | After S9-0 Devnet modes ([s9-0-devnet-modes.md](./s9-0-devnet-modes.md)) |

**Do not** wire against Nuclear #6. S4b targets **this** hub gateway only. Nuclear verify = evidence-backed direct submit (`verify:sepolia`), not Hardhat. Do **not** enable `svm-ingest` in the S9-A reindex window.
