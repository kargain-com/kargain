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
| KarPassportBridgeGateway | `0xFA4FcEf7a1bF882438f70BaC63401410d4f6DB29` | `VERSION` **1.4.0-rc.1** — **not** an S4b peer (explorers unverified; S4b waits for N7) |
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

**Verify (best-effort):** Ascending + libs + FixedPrice proxy newly verified both explorers. KarPassport / KarProStaking / Gateway reported **bytecode_mismatch** (non-`--strict`; same class as N5 HHE80009). **N6-8 (below):** on-chain runtime ≡ this repo’s executable body after immutable fill; mismatch is CBOR metadata only — not a foreign binary.

---

## Bytecode identity (N6-8) — August 29, 2026

**Question:** is deployed Nuclear #6 Passport / Staking / Gateway the code in this repository at `19f964f`?

**Answer:** **Yes** (executable body). Explorer `bytecode_mismatch` is trailing solc CBOR metadata (IPFS content hash), not a different program.

### Method

- Local: two clean `rm -rf artifacts cache && pnpm compile` on `19f964f`; compare `deployedBytecode` (not creation `bytecode`).
- Chain: `eth_getCode` via configured Hardhat RPCs (no txs).
- Raw compare, then fill Solidity `immutable` slots from Hardhat `immutableReferences` + N6 manifest ctor values, then strip solc CBOR trailer (last two bytes = metadata length).

**Compile reproducibility:** identical across both clean runs.

| Artifact | Runtime bytes | SHA-256 of `deployedBytecode` |
|----------|---------------|-------------------------------|
| KarPassport | 15077 | `066e212a6394f1630e04a8e506cb7e3b877928161b68df4978d48cc2fc771c8b` |
| KarProStaking | 3670 | `ed2f463be38840c6372ccc01864938c364d546c2c2ac659c0e9830d648ccaac8` |
| KarPassportBridgeGateway | 9413 | `2acf52215411cb94a18c791c1bf27107c12022d3ec116cd841899219eedd7d27` |

**RPC:** 84532 → `sepolia.base.org` (`BASE_SEPOLIA_RPC_URL`). 11155111 → `ethereum-sepolia-rpc.publicnode.com` (`ETH_SEPOLIA_RPC_URL`).

**Immutables filled (manifest):** Passport ← staking + forfeit + `tokenIdOffset`; Staking ← `karProPass`; Gateway ← LZ `endpoint` + ONFT `innerToken` (passport).

### B1 — six comparisons

| Chain | Contract | Len local=chain | Raw firstDiff | After immutable fill | CBOR-stripped body |
|-------|----------|-----------------|---------------|----------------------|--------------------|
| 84532 | KarPassport | 15077 | 1637 (immutable slot) | firstDiff 15034 (metadata) | **equal** |
| 84532 | KarProStaking | 3670 | 973 (immutable slot) | firstDiff 3627 (metadata) | **equal** |
| 84532 | Gateway | 9413 | 804 (immutable slot) | firstDiff 9370 (metadata) | **equal** |
| 11155111 | KarPassport | 15077 | 1637 | firstDiff 15034 | **equal** |
| 11155111 | KarProStaking | 3670 | 973 | firstDiff 3627 | **equal** |
| 11155111 | Gateway | 9413 | 804 | firstDiff 9370 | **equal** |

Raw body inequality is **only** at immutable slots (expected). After fill: lengths match; sole remaining difference is the **51-byte** trailing metadata (both sides `metaLen=51`).

### B2 — metadata-only (applies)

CBOR shape on chain and local (all six): `a2` map → `ipfs` bytes34 + `solc` bytes3. **solc stamp identical:** `0.8.28` (`300081c`). What varies is the **IPFS content hash** of the compiler standard-JSON input, e.g. Passport:

| | IPFS CID payload (hex, 34 bytes incl. multibase prefix) |
|--|--|
| On-chain (both networks; same deploy artifact) | `12203faa0dc60a6f85b0273251bca22a31d313e97ea7b314116354bb3f6b23367b8f` |
| Local recompile at diagnosis | `1220111d21c95beeffb728b100932c4d957581f97ddf6149db17da19f1a3bf6f24a4` |

Explorers / Hardhat verify rebuild **creation** bytecode (`bytecode` + ABI-encoded ctor args) with the **current** compile’s metadata auxdata. That CID ≠ deploy-time CID → HHE80009 `bytecode_mismatch` even when the executable runtime matches.

**Why Ascending / FixedPrice proxy can still show verified:**

- **ERC1967Proxy** (FixedPrice proxy address): local vs chain runtime body **and** metadata are **byte-identical** (OZ npm sources stable under `npmFilesToBuild`). Exact match including auxdata.
- Ascending + libs / FixedPrice were marked verified in the deploy-session verify pass (artifact metadata then matched what was submitted). Skip-if-verified hides later recompile drift. The three ctor+non-proxy contracts hit mismatch whenever verify rebuilds from a fresh compile whose IPFS CID drifted.

Control note (not a B3 for the three targets): FixedPrice **impl** local vs chain differs at two **20-byte** runs that equal the impl address on chain (zeros locally) — separate from the Passport/Staking/Gateway immutable-32 pattern; proxy verification does not require impl metadata equality.

### B3

Does **not** apply — no unexplained executable-body divergence after immutable fill.

### B4 — missing gate (describe only; not implemented)

[`test/verify-constructor-args.test.ts`](../../../test/verify-constructor-args.test.ts) asserts Passport/Staking/Gateway **arg tuples** from builders, but imports **only** `FixedPriceConsignmentAbi` / `AscendingConsignmentAbi` to decode proxy `initialize`. It never:

1. Checks Passport/Staking/Gateway builder arity/types against the **compiled artifact** `constructor.inputs`.
2. Asserts the deploy script’s Hardhat artifact `deployedBytecode` is the one just compiled (digest / no-recompile-between-compile-and-deploy).
3. Post-deploy: immutable-filled local runtime ≡ `eth_getCode` (would catch foreign bytecode; would **not** by itself clear explorer HHE80009).

**Home when implemented:** extend `test:verify` beside constructor-args; optional deploy dry-run / post-deploy identity check in `scripts/deploy.ts` adjacency — not a substitute for explorer green.

### Opinion (labelled)

**Trust for repository identity:** the Nuclear #6 hub gateway `0xFA4FcEf7…DB29` (and sibling Passport/Staking on both chains) **is** this repository’s executable at the diagnosed commit. Explorer source verification remains red; **do not** wire S4b against this gateway — wait for Nuclear #7.

---

## CID drift cause (N6-9 V1) — August 29, 2026

N6-8 left open whether the IPFS CID drift was (a) unstable non-source fields in standard-JSON, (b) deploy from a different tree than the commit we treat as source, or (c) deploy-time `artifacts/build-info` overwritten by a later clean recompile.

### Distinguishing evidence

| Hypothesis | Verdict | Evidence |
|------------|---------|----------|
| **(a)** unstable across runs | **False** | Two consecutive clean compiles (`rm -rf artifacts cache && pnpm compile`) produced **identical** full `deployedBytecode` digests (metadata CID included). An incremental recompile without cleaning kept the same CID (`1220111d21c9…`). Same tree → same CID. |
| **(c)** deploy-time build-info wiped | **True** | Deploy manifests written **10:28Z / 10:41Z**. N6-8 diagnosis ran `rm -rf artifacts cache` at **~11:07Z** (13:07 +0200). Current `artifacts/build-info/*.json` mtimes are that recompile. **No** copy under `deployments/`, `docs/ops/`, or elsewhere on disk. On-chain CID `12203faa0dc6…` appears only in this runbook / session log — not in any preserved build-info. Public IPFS gateways did not return the metadata JSON for CIDv0 `QmSdAnpyzCGgkXjwtfrjJ6sR35eVDRcH5k9nRQwP7sV3oU` (403 / unavailable). **The deploy-time compiler input is gone.** |
| **(b)** different compilation input than “this commit” | **Partially open; process finding** | No tracked `.sol` / `hardhat.config.ts` change since N6-6 (`32fb772`); deploy ran after N6-7 (TypeScript-only). Executable bodies still match after immutable fill. Yet on-chain metadata CID ≠ today’s deterministic CID for a clean compile of HEAD — so **deploy-time solc metadata JSON ≠ today’s**. Without the wiped build-info we **cannot** name which metadata field differed (extra source unit, npm package bytes, uncommitted file present only at deploy, Hardhat source set, etc.). That is a process finding: we destroyed the only artifact that would settle (b) precisely. |

**Summary:** (a) out. (c) confirmed — evidence destroyed by clean recompile after deploy (including N6-8). Residual CID inequality implies deploy-time hashed metadata input was not identical to a clean HEAD recompile, but the file that would identify the delta no longer exists.

---

## Explorer verify from deploy-time input (N6-9 V2)

**No usable deploy-time `build-info` exists** (V1). Per task rules: do **not** re-verify Passport / Staking / Gateway against today’s artifacts, do **not** modify `hardhat.config.ts`, do **not** redeploy, do **not** invent a reconstruction.

| Chain | Passport / Staking / Gateway | Action |
|-------|------------------------------|--------|
| 84532 | — | **Stopped** — no deploy-time input |
| 11155111 | — | **Stopped** — no deploy-time input |

Explorer source for those three remains red until a future nuclear deploy preserves build-info (V3) and verify reads it.

---

## Preserve compile evidence (N6-9 V3)

**Owner:** [`scripts/lib/deployment-build-info.ts`](../../../scripts/lib/deployment-build-info.ts) under `deploymentsDirectory()` / `KARGAIN_DEPLOYMENTS_DIR`.

| File | Role |
|------|------|
| `deployments/{chainId}.json` | Manifest (existing) |
| `deployments/{chainId}.build-info.json` | Hardhat build-info **input** that produced the deploy (~0.6 MB) |
| `deployments/{chainId}.artifacts/**` | Copies of nuclear contract artifact JSONs from that compile (~0.6 MB more) |

Manifest fields: `buildInfoId`, `buildInfoSha256` (SHA-256 of the stored build-info file). **Gitignored** like manifests (not for cutover; machine-local evidence). `pnpm verify:sepolia` / `verify:sepolia:eth` restores this into `artifacts/` before Hardhat submit when those fields are present.

**N6 note:** Nuclear #6 manifests predate V3 — no stored build-info; V2 stands.

---

## B4 gates (N6-9 V4)

| Gate | Command / test | Refuses |
|------|----------------|---------|
| **V4.1** Argument shape | `test/verify-constructor-abi-shape.test.ts` (`test:verify`) | Builder arity/types ≠ artifact `constructor.inputs` (every `VERIFY_TARGETS` entry) |
| **V4.2** Build identity | `scripts/deploy.ts` live path | Dirty git tree; `deployedBytecode` digest drift mid-deploy; records `artifactDigests` + `deployGitHead` on manifest |
| **V4.3** On-chain identity | `pnpm verify:bytecode-identity` ([`scripts/assert-on-chain-bytecode.ts`](../../../scripts/assert-on-chain-bytecode.ts)) | Any CBOR-stripped body ≠ immutable-filled (+ library-linked) local artifact. Read-only; safe any time. |

**Runbook order after every future nuclear deploy:** clean tree → deploy → `pnpm verify:bytecode-identity` (+ `--eth`) → `pnpm verify:sepolia` (uses stored build-info).

**N6:** V4.3 run against N6 manifests (August 29): **11/11 OK** both chains (Passport/Staking/Gateway included) — repository executable confirmed without explorer.

---

## Partial match / public verifiability (N6-10) — August 29, 2026

**Question:** can body-equal / metadata-CID-different N6 Passport / Staking / Gateway be made **publicly** verifiable (explorer visitor), or must cutover use a fresh V3-retained deploy?

### P1 — What each route accepts (docs retrieved 2026-08-29)

**Sourcify** — [Exact Match vs Match](https://docs.sourcify.dev/docs/exact-match-vs-match/):

> Matches (prev. called "partial match") refer to cases when the deployed bytecode of the onchain contract match the bytecode resulting from the recompilation with the metadata and the source files **except the metadata hash**. … renamed … as "partial" often causes confusion leading users to think their contract is not verified.

**Classification:** **accepted and shown as verified** with caveat **Match** (not Exact Match). Exact Match additionally requires the metadata fingerprint to match.

**Etherscan / Basescan** (same Etherscan API v2) — [Common verification errors](https://docs.etherscan.io/contract-verification/common-verification-errors):

> "Compiled contract deployment bytecode does NOT match the transaction deployment bytecode" — submitted source does not match on-chain.  
> "Source code already verified" — "An **Exact Match** has been obtained".  
> "Similar Match Found" — contract already **Similar Matches** another address’s bytecode.

Cross-check [ethereum.org Verifying](https://ethereum.org/developers/docs/smart-contracts/verifying/) (retrieved same day) claims Etherscan “fails to compare the metadata hash” (partial). Hardhat issue [#7730](https://github.com/NomicFoundation/hardhat/issues/7730) (Dec 2025) claims the opposite — Etherscan compares **full** bytecode including metadata. **Resolved by P2 experiment**, not by picking a narrative.

**Classification (after P2):** explorer path **rejects** today’s recompile for these three (Hardhat HHE80009 local gate; `getsourcecode` empty; visitor still “Verify and Publish”). They do **not** display verified source for N6 Passport/Staking/Gateway.

### P2 — Attempts (source publish only; no txs; no `hardhat.config.ts` change)

| Route | Method | Outcome (3 contracts × 2 chains) |
|-------|--------|----------------------------------|
| Sourcify | POST `https://sourcify.dev/server/v2/verify/{chainId}/{address}` with current Hardhat `stdJsonInput` + `0.8.28+commit.7893614a` | All **six** → API `match` / `runtimeMatch`=`match` / `creationMatch`=`match` (not `exact_match`) |
| Hardhat `verify sourcify` / `verify etherscan` | Existing CLI | All attempted → **HHE80009** locally (“bytecode does not match”) — never reaches a successful explorer submit |
| Etherscan API `getsourcecode` after Sourcify | Read | All six: **no** `SourceCode` (explorer still unverified) |

**Visitor sees:**

| Surface | Passport / Staking / Gateway |
|---------|------------------------------|
| Sourcify repo (table below) | **Match** — source, ABI, metadata readable |
| sepolia.basescan.org / sepolia.etherscan.io | **Not verified** — “Verify and Publish your contract source code today!”; no Contract Source Code Verified badge |

**Sourcify repo URLs (Match — first-class audit route):**

| Chain | Contract | URL |
|-------|----------|-----|
| 84532 | KarPassport | https://repo.sourcify.dev/84532/0x8fc3325c2d018812Fcf782e3DE0f0F954B3f1915 |
| 84532 | KarProStaking | https://repo.sourcify.dev/84532/0xB081b8e3c6a5f72e07D5628F60A77Fb018BF0029 |
| 84532 | KarPassportBridgeGateway | https://repo.sourcify.dev/84532/0xFA4FcEf7a1bF882438f70BaC63401410d4f6DB29 |
| 11155111 | KarPassport | https://repo.sourcify.dev/11155111/0xFCC3FB7e926483778898f8Dd38bDb1Db51412a41 |
| 11155111 | KarProStaking | https://repo.sourcify.dev/11155111/0x2F1036251227EdaFaC51934AB5157854d2632Dc4 |
| 11155111 | KarPassportBridgeGateway | https://repo.sourcify.dev/11155111/0xb9B649e13cA11a87c8842dD593E2008FBd130ECb |

### P3

Does **not** apply to Sourcify (accepted). Applies to **Basescan/Etherscan** as the cutover bar: they do not accept/display this metadata-divergent verification.

### P4 — Cutover consequence (amended N7-0)

**Basescan and Etherscan remain red** for the three ctor+non-proxy contracts, so Nuclear #6 **cannot** be the stack that goes live under the public-explorer bar — even though Sourcify Match and `verify:bytecode-identity` both succeed.

**Do not wire S4b against N6.** No LayerZero pathway (including **40245↔40168**) is wired to hub gateway `0xFA4FcEf7…DB29`. Same rule as not wiring N5. S4b waits for **Nuclear #7** explorer-green hub gateway — see [nuclear-7.md](./nuclear-7.md).

Sourcify Match remains a **first-class** public audit route for this parallel stack (table below) even while explorers stay red.

**Repeat list:** founder runs nuclear-7.md (identical-source redeploy + evidence guard + explorer + Sourcify) → **then** S4b against **N7** hub → S9 cutover later.

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
| N6-8 bytecode identity (diagnosis) | August 29 | **Done** — executable match |
| N6-9 V1–V4 (verifiable deploys) | August 29 | **Done** — gates in tree; N6 has no stored build-info (V2) |
| N6-10 partial match / public verify | August 29 | **Done** — Sourcify Match ×6; Basescan/Etherscan still red |
| N7-0 runbook + evidence guard | August 29 | **Done** — [nuclear-7.md](./nuclear-7.md); **do not** wire S4b against N6 |
| Wire 40245↔40161 on N6 gateways | — | **Skipped** — N6 is not an S4 peer; N4 pathway stays for live app |
| Wire 40245↔40168 (Solana) | **S4b** against **Nuclear #7** hub only | Blocked until N7 explorer-green |
| `COMMERCIAL_ACTIVE` + SPEC I.9 + VPS reindex + Vercel + merge | **S9 once** | Not started |

**Do not** wire any pathway against N6 hub `0xFA4FcEf7…DB29`. **Do not** run `bridge:wire:read-only` against N4 pathway as an N6 gate — that pathway stays for the live app until S9.
