# S3 laboratory results

**Date:** 2026-08-27  
**Host:** local `solana-test-validator` (Agave CLI 4.2.1)  
**No Devnet writes.** External programs were **cloned** (dumped) from public Devnet for local load only.

## Fixtures

| Program | Pubkey | Source | Notes |
|---------|--------|--------|-------|
| Metaplex Core | `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d` | Devnet dump → `fixtures/mpl_core.so` (855 888 B); lab runtime preferred `fixtures/mpl_core_release_0.15.1.so` (810 488 B) | ProgramData `9ZC25KLUrfgSoFVgjE1rrydZBbZns58UXi8A8ZhTdGfr`; last deploy slot **476486035** (Devnet read-back) |
| SPL Noop | `noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV` | Devnet dump → `fixtures/spl_noop.so` | Log wrapper optional |
| lab_harness | `CBEhiBN8A21wzdf7ekPA7Bo6WvM15dS2C9D44nqatUiX` | Built locally (`mpl-core` 0.11.2 + `solana-program` 2.3, `--arch v0`) | Loaded via `--bpf-program` (not upgradeable deploy) |

**How to re-run**

```bash
# from svm/lab/programs/lab_harness
cargo-build-sbf --arch v0
# from svm/lab
bash scripts/start-validator.sh   # Core + noop + harness
pnpm exec tsx scripts/run-lab-client.ts
pnpm exec tsx scripts/run-lab-harness.ts
```

## Compute-unit measurements (do not conflate)

These are **different operations**. A longer URI cannot be “cheaper” than a shorter one when the account graph differs — the numbers below are not comparable as “create cost vs URI length.”

| ID | Script / path | What was measured | CU (example) | Static accounts | Applicable to full `lz_receive`? |
|----|---------------|-------------------|--------------|-----------------|----------------------------------|
| **П-1** | `run-lab-harness.ts` → `CreatePdaAsset` | Core `CreateV1` CPI (`invoke_signed` on asset PDA) **plus** System `create_account` for companion **256 B** state PDA | ≈ **30–42k** | Harness ix keys (asset, payer, owner, freeze PDA, Core, system, state) — **not** a receive account list | **Partial only** — create+state fragment; missing clear, compose decode, gateway/passport config, endpoint accounts |
| **П-7** | `run-lab-client.ts` → Umi `create()` | **Isolated** Core asset create, URI = **731** UTF-8 bytes, PermanentFreeze attached; **no** Kargain state PDA | ≈ **15788** | **4** (that Core create’s static keys only) | **No** — not receive-shaped; “4 accounts” must not be read as the receive instruction’s account count |

**S4 must not pin either number** into [`lib/web3/bridge/lz-receive-gas.ts`](../../lib/web3/bridge/lz-receive-gas.ts) as destination receive budget.

| ID | Script / path | What was measured | CU (example) | Applicable to full `lz_receive`? |
|----|---------------|-------------------|--------------|----------------------------------|
| **Stand receive (mint)** | `live-roundtrip.ts` → foreign `LzReceive` | mock Endpoint `clear` + ONFT decode + Core CreateV1 + state PDA | ≈ **64608** | **Yes — mint-shaped**; still **measure-only** until S4 pins |
| **Stand receive (unlock)** | `live-roundtrip.ts` → home unlock `LzReceive` | clear + decode + BridgeResetOnUnlock + Core thaw/transfer | ≈ **59318** | **Yes — unlock-shaped**; measure-only until S4 |

Neither lab row nor these stand rows may be copied into `lz-receive-gas.ts` until S4. All stay well under **1.4M** CU; lab/stand do **not** invent a pin.

## S4b Y5 Devnet live RT (2026-08-30) — **PINNED**

**Live:** N7 hub `0x73240468…1827` ↔ Solana Devnet gateway `EZNVaX7…Gbgr` (OApp = gateway_config `J8h6Erc…`). URI `ar://s4b-y5-rt-2026-08-30-n7-devnet` (35 B). Both directions delivered; final hub owner = deployer; status UNVERIFIED (never verified).

| Leg | What | Measure → headroom → pin |
|-----|------|--------------------------|
| Hub→Solana **receive** (destination budget) | Stand `--live-both` foreign mint (mock clear + Core create + state) after Y5 bind | CU **69_819** → ×**2.0** → **139_638**; rent-exempt mins **7_189_680** → ×**1.5** → **10_784_520** lamports. Owner: `SOLANA_DEVNET_ENFORCED_*` in [`lz-receive-gas.ts`](../../lib/web3/bridge/lz-receive-gas.ts) |
| Solana→hub **send** (not receive pin) | Production EndpointV2 send CPI (ALT + v0 tx) on Devnet Y5 RT | ≈ **280_078** CU — **outbound send measure only**; do not copy into destination enforcedOptions |

**Reconciliation:** receive pin governs hub→Solana Executor lzReceive options. Send CU is local Solana compute before debit completes; oversize send fails locally (user retries). Do not conflate the two.

**Ops notes:** OApp EXECUTOR config must store **ExecutorConfig PDA** (not program id) or `SendHelper` cannot deserialize. Hub testnet committer may stall after DVN quorum — product UI ownership is **S8** (SPEC §13.4 / §13.16); `pnpm svm:y5-rt` nudges only as test tooling. Passport `bridge_gateway` bind accepts gateway_config PDA (and legacy program-id→PDA). Y5 tooling creates **ephemeral** ALTs (authority = deployer hot); product must not pin a durable deployer-owned ALT (SPEC §13.4).

## S4a local figures (2026-08-29) — do not pin

**Host:** local Agave **4.3.0-beta.2** (matches Devnet `getVersion` same day). **Load:** upgradeable (`cargo-build-sbf --arch v3` + `solana program deploy`). **URI in default live path:** `STAND_TYPICAL_URI` (26 B), not the 731 ceiling.

| ID | Script / path | What was measured | CU / rent (example) | Applicable to full `lz_receive`? |
|----|---------------|-------------------|---------------------|----------------------------------|
| **S4a upgradeable mint** | `run-stand.sh --live-upgradeable` → foreign `LzReceive` | Same receive-shaped mint as stand row above, under upgradeable loader | ≈ **64553** CU | **Yes — mint-shaped**; local only; S4b re-measures on Devnet |
| **S4a upgradeable unlock** | same → home unlock `LzReceive` | Same unlock-shaped path under upgradeable loader | ≈ **59249** CU | **Yes — unlock-shaped**; local only |
| **S4a state PDA rent** | `solana rent 256` on local Agave 4.3 | Passport companion state PDA size from S3 (256 B) | **0.00267264 SOL** rent-exempt min | Rent component only — not CU |
| **S4a program account rent** | `pnpm deploy:svm:dry-run` / `solana rent 36` | Upgradeable Program account (36 B data) | **0.00114144 SOL** | Deploy cost, not per-receive |
| **S4a 731 URI single-tx** | `KARGAIN_SVM_STAND_URI_CEILING=1` live | Full foreign `LzReceive` ix with URI = **731** UTF-8 bytes | **FAIL** — `Transaction too large: 1552 > 1232` | **Finding:** ceiling URI does not fit one Solana tx on this account list; S4b must use ALT / split / smaller static list before pinning receive budget |

**Do not** write any of these into [`lib/web3/bridge/lz-receive-gas.ts`](../../lib/web3/bridge/lz-receive-gas.ts). S4b re-measures on Devnet after the 731-URI transport path is fixed.

## S4a-1 — LayerZero Solana receive delivery (2026-08-29) — measure only

> **Superseded for production URI ceiling:** Nuclear #6 product ceiling is **160** UTF-8 bytes, no ALT required (S4a-2 h=3 → computed production 1208/1232). Four-cell / 731 rows below remain **historical measure** only — do not read “731 ceiling” or “ALT required for product” as current law. See N6-4 measure + SPEC §I.13.

**No Devnet writes. No gateway / `lz_receive_types` / SPEC edits (at measure time).** Numbers only — do not conflate with mock CU rows above; do not pin into `lz-receive-gas.ts`.

**Source pin:** [LayerZero-Labs/LayerZero-v2](https://github.com/LayerZero-Labs/LayerZero-v2) commit **`9c741e7f9790639537b1710a203bcdfd73b0b9ac`** (`main` tip that day). Paths:

| Role | Path |
|------|------|
| Endpoint `clear` + `ClearParams` | `packages/layerzero-v2/solana/programs/programs/endpoint/src/instructions/oapp/clear.rs` |
| `PayloadHash` account | `…/endpoint/src/state/messaging_channel.rs` |
| `init_verify` (creates payload PDA) | `…/endpoint/src/instructions/init_verify.rs` |
| `verify` (writes 32-byte hash) | `…/endpoint/src/instructions/verify.rs` |
| OApp `LzReceiveParams` | `packages/layerzero-v2/solana/programs/libs/oapp/src/lib.rs` |
| `get_accounts_for_clear` (8 metas) | `…/libs/oapp/src/endpoint_cpi.rs` |
| OFT consumer (clone → `ClearParams.message`) | `…/programs/oft/src/instructions/lz_receive.rs` |
| Snapshot Endpoint id (EID 40168) | `76y77prsiCMvXMjuoZ5VRrhG5qYBrUMYTE5WgHqgjEn6` in `scripts/lib/layerzero-metadata.snapshot.json` |

### M1 — Message delivery (settled)

| Covered | Result | Computed vs measured | Source |
|---------|--------|----------------------|--------|
| Do message bytes reach OApp `lz_receive` as **ix data** or **account contents**? | **Instruction data.** `LzReceiveParams { …, message: Vec<u8>, extra_data: Vec<u8> }`. OFT `lz_receive` passes `params.message.clone()` into `ClearParams.message`. | Settled from published source (not inferred from mock) | `oapp/src/lib.rs` `LzReceiveParams`; OFT `lz_receive.rs` `ClearParams { message: params.message.clone(), … }` |
| What does Endpoint `clear` consume? | Full message again in **CPI instruction data** (`ClearParams.message`), hashed with GUID and checked against the PDA | Same | `endpoint/…/oapp/clear.rs` `hash_payload(&params.guid, &params.message)` |
| What does `payload_hash` PDA store? | **`hash: [u8; 32]` + `bump: u8` only** — not message bytes. Account data ≈ 8 (disc) + 33 = **41 B** | Computed from struct | `PayloadHash` in `messaging_channel.rs` |
| Who pays rent / when closed? | `init_verify` **`init`, `payer = payer`**; `clear` **`close = endpoint`** (lamports → Endpoint settings PDA) | Settled | `init_verify.rs`; `clear.rs` |
| Does payload PDA size bound message length independently of the 1232 tx limit? | **No.** PDA is fixed-size hash. Message length is bounded by **outer tx / CPI ix-data size**, not by the PDA | Settled | same |

**Stop rule:** M1 is **settled** (not unsettled). Mock Endpoint remains non-authority for delivery shape.

### M2 — Real `clear` accounts vs mock 13

`get_accounts_for_clear` / `Clear::MIN_ACCOUNTS_LEN` → **8** metas (program id + 7 Clear/`event_cpi` fields):

| # | Role |
|---|------|
| 0 | Endpoint program (CPI program id) |
| 1 | receiver (OApp identity; Clear signer PDA) |
| 2 | `oapp_registry` |
| 3 | `nonce` |
| 4 | `payload_hash` (writable; closed on clear) |
| 5 | `endpoint` settings (writable; rent sink) |
| 6 | Endpoint `__event_authority` |
| 7 | Endpoint program (event CPI) |

**Corrected production list — KarGateway-shaped foreign-mint receive (no compose), report only:**

| # | Role | Notes |
|---|------|-------|
| 0 | payer | executor fee payer |
| 1 | gateway_config | OApp / Clear signer |
| 2 | system_program | state PDA create |
| 3 | passport_program | |
| 4 | passport_config | |
| 5 | asset | Core asset PDA |
| 6 | state | companion state PDA |
| 7 | freeze_authority | gateway freeze PDA |
| 8 | core_program | Metaplex Core |
| 9 | to | `send_to` owner |
| 10–17 | real clear (8) | as table above; receiver = gateway_config |

**Count: 18 account metas** on the OApp `LzReceive` ix (10 named + 8 clear remaining).

| Contrast | Count | Endpoint-related slots |
|----------|-------|------------------------|
| Mock stand / `lz_receive_types.rs` today | **13** | `endpoint_program` + `endpoint_config` + `clear_receipt` (3) |
| Production corrected (this section) | **18** | real clear **8** (replaces those 3; +5 net) |

Do **not** edit `svm/programs/kar-gateway/src/lz_receive_types.rs` in this task.

### M3 — Assembled size at URI = 731

**Wire facts (computed):** ONFT message with URI=731 = **896 B** (fixture `ceiling_731_solana_ns.hex`); Borsh gateway `LzReceive` ix data = **977 B** (tag + origin + `Vec` message). Solana packet limit **1232**.

**Assembly model (legacy / v0):** 1 signature; `ComputeBudget::setComputeUnitLimit` (5 B data, 0 accounts) + `LzReceive`; formula matched **measured** mock **1552** exactly (14 static keys = 12 unique LzReceive metas with `to==payer` + gateway program + CU program).

| | **no ALT** (legacy) | **with ALT** (v0, 1 lookup) |
|---|---|---|
| **message inline** (published path) | **Mock list:** **1552** (**measured** S4a T5; **computed** same). Margin **−320**. Breakdown: sigs 65 + hdr 3 + keys 449 (14×32+1) + blockhash 32 + ixs 1003. **Production 18-meta list (`to≠payer`):** **1685** (**computed** only). Margin **−453**. Breakdown: sigs 65 + hdr 3 + keys 577 (18×32+1) + bh 32 + ixs 1008. | **Production 18-meta:** **1194** (**computed**). Model: static keys = `[payer]` only; 17 others via one ALT (7 writable + 10 readonly indexes). Margin **+38**. Breakdown: sigs 65 + ver 1 + hdr 3 + keys 33 + bh 32 + ixs 1008 + lut 52. **Conservative ALT** (static = payer + gateway program + CU program): **1256** (**computed**), margin **−24** — still over at 731. |
| **message from account** | **N/A** | **N/A** |

**Why N/A:** published Endpoint/OApp interfaces put the full message in `LzReceiveParams.message` / `ClearParams.message` (ix data). `PayloadHash` stores a **32-byte hash** only. There is no published “read message bytes from an account” receive path to size.

**Labels:** mock no-ALT inline = **measured + computed**; all production cells = **computed** (no local dump of live Endpoint `.so` dry-assembly; no Devnet txs).

### M4 — Max fitting URI (feasible cells only)

Binary search on assembled size ≤ 1232; URI length in UTF-8 bytes; same ONFT/abi padding as codec.

| Case | Feasible? | Max URI (B) | Size at max | Method |
|------|-----------|-------------|-------------|--------|
| Mock 13-meta, inline, no ALT | yes (under ceiling only) | **416** | 1232 | binary search on computed legacy size |
| Production 18-meta, inline, no ALT | yes (under ceiling only) | **256** | 1205 | same |
| Production 18-meta, inline, ALT (static=`[payer]`) | yes | **768** | 1226 | binary search on computed v0+ALT |
| Production 18-meta, inline, ALT conservative (3 static) | yes (under ceiling only) | **704** | 1224 | same |
| Message from account (any) | **impossible** | — | — | N/A by M1 |

At URI=731: only the **aggressive** ALT model (payer-only static) fits among production inline cells; no-ALT production and conservative ALT do not.

**Do not** treat these maxima as a product ceiling change — measurement for a later design decision only.

## S4a-2 — URI ceiling facts (2026-08-29) — no implementation

**No** contract / SPEC / config / ceiling ship. Numbers + census only.

### Q1 — Live URI census (Nuclear #4 indexer)

| Covered | Result | Source |
|---------|--------|--------|
| Endpoint | `https://ponder.kargain.com` — `/ready` 200; `/status` tip blocks 84532≈46112670 / 11155111≈11590782 | live HTTP |
| Query | `GET /passports?limit=100&page=1` (API max 100; one page) | `tokenUri` UTF-8 byte length |
| Count / max / p99 | **6** passports (all `chainId=84532`); max **49**; p99 **49**; buckets 0–48: **4**, 49–96: **2**, 97–192: **0**, 193+: **0** | computed |
| URI > 192 | **none** | — |
| Prefixes | all **6** `ar://` (2 Irys-shaped 44-char ids → 49 B total; 4 smoke/proof short ids) | — |
| Eth Sepolia rows | **0** in indexer | — |
| N4 vs N5 | `COMMERCIAL_ACTIVE` `indexFromBlock` still N4 (**44957457** / **11404204**) — **N5 not indexed**. Read-only RPC: N5 passports `0x8542…a70e` / `0x2961…0b2d` `nextTokenId ==` namespace offset → **0 mints** on both N5 stacks | viem `nextTokenId` |

### Q2 — EVM→EVM failure class (same LZ pin as S4a-1)

| Covered | Result | Source |
|---------|--------|--------|
| Pin | LayerZero-v2 **`9c741e7f…b9ac`** `EndpointV2.sol` | same as S4a-1 |
| Verdict | URI-driven destination **OOG is retryable** on EVM: `lzReceive` clears then calls the OApp **in one tx** — revert/OOG rolls back the clear. Failed attempts emit `lzReceiveAlert` **without** clearing. URI length alone does **not** make an EVM→EVM message permanently unexecutable. Explicit OApp/Endpoint `clear` / burn / nilify are **admin discard**, not length-OOG. | quote in session report |

### Q3 — Max URI U (production 18-meta, **no ALT**) + headroom

Model = S4a-1 production foreign-mint legacy assembly (`to≠payer`, CU + Borsh `LzReceive`). Headroom **h** = extra future Endpoint account metas (+1 ix index + +1 static 32-byte key each). Binary search size ≤ **1232**. **Computed only.**

| h (extra accounts) | Max U (UTF-8 B) | Size @ U | Breakdown (sigs / hdr / keys / bh / ixs) | Margin | EVM `requiredLzReceiveGasForByteLength(U)` | Under 1e6 cap? |
|--------------------|-----------------|----------|------------------------------------------|--------|---------------------------------------------|----------------|
| 0 | **256** | 1205 | 65 / 3 / 577 / 32 / 528 | +27 | 453 069 | yes |
| 1 | **224** | 1206 | 65 / 3 / 609 / 32 / 497 | +26 | 416 269 | yes |
| 2 | **192** | 1207 | 65 / 3 / 641 / 32 / 466 | +25 | 379 469 | yes |
| 3 | **160** | 1208 | 65 / 3 / 673 / 32 / 435 | +24 | 342 669 | yes |

**Minimum product pointer:** `lib/storage/irys-client.ts` returns `` `ar://${receipt.id}` ``. Observed live Irys id = **44** chars → **49** UTF-8 bytes; common 43-char Arweave id → **48** B. App mint/edit upload path writes **only** that form (not `ipfs://` / raw `https://` as `tokenURI`). Short `ar://nuclear-4-proof*` strings exist on testnet smoke mints only.

**Do not** write U into `lz-receive-gas.ts` from this task.

### Q4 — Enforcement points

Full table with proposed refusal names: **session report** (not duplicated here). Summary: on-chain length gate needed at **passport write** (`mintPassport` / `setPassportURI`) **and** **gateway send** (last gate before leave); receive-side `bridgeMint` / unlock adopt as defense-in-depth; client `exceeds_cap` stays UX-only; SVM mirrors when commercial; `recoverLockedHome` uses empty URI (no length issue).

## N6-4 — SVM mirror measure (2026-08-29)

**Enforcement (source):** passport mint / `set_passport_uri` → `UriTooLong`; gateway `plan_send` → `UriExceedsBridgeCeiling`; receive / `bridge_mint` / unlock **no** length reject.

**Live stand** (`./svm/stand/run-stand.sh --live-both`, URI = declared **160**):

| | Value | Notes |
|--|-------|-------|
| Mock 13-meta foreign-mint tx size @ URI=160 | **976** | **Measured** (preload + upgradeable identical); CU ix + Borsh `LzReceive`; `to==payer` |
| Production 18-meta @ URI=160 (h=3), no ALT | **1208** | **Computed** only (S4a-2 Q3); margin **+24** vs 1232 |
| Equate mock↔1208? | **No** | Account lists differ (13 vs 18) |

CU (measure only): foreign mint ≈65001 / ≈64940; home unlock ≈59820 / ≈59749. Production ceiling law: SPEC §I.13 (160) + D-20.

## Proofs

| ID | Result | Detail |
|----|--------|--------|
| **П-1** | **PASS** | Core `CreateV1` CPI with asset account = PDA; harness `invoke_signed`. Asset owner = Core; companion state PDA 256 B allocated. CU: see table above (create+state). |
| **П-2** | **PASS** | TransferDelegate attachable; owner can `removePlugin` before “open”; after owner transfer prior Address authority is **revoked** (plugin slot may remain with authority=`Owner`). |
| **П-3** | **PASS** | PermanentFreeze `PluginAuthority::Address` accepted for a keypair (client) and for **this program id** (harness). Production freeze toggles should use a **program PDA** as signer (program id cannot ed25519-sign). |
| **П-7** | **PASS (measure only)** | Isolated Core create at URI=731: CU/accounts in table above; ALT **not** required for that create. |
| **Freeze (retired П-4)** | **PASS** | Frozen asset rejects transfer with TransferDelegate present; freeze authority thaws then owner burns **in one harness instruction**. Core `Burn` leaves a **1-byte tombstone** still owned by Core (`data=[0]`) — not a full account close. |
| obs: permanent thawed | **PASS** | Permanent freeze plugin may sit attached with `frozen=false`. |
| obs: URI while frozen | **PASS** | Freeze does **not** block URI update. |

## Architecture notes (not phase stops)

1. **Freeze authority shape:** Address(program_id) can be *recorded*; acting requires a **PDA** the program `invoke_signed`s (lab freeze PDA seed `lab_freeze`). Matches plan objection #6 / gateway design.
2. **TransferDelegate after transfer:** plugin entry may remain with authority reset to Owner — treat as prior delegate revoked (П-2).
3. **JS Core helpers:** pass explicit `systemProgram: SystemProgram.programId` on transfer/burn/update (umi placeholder fails).
4. **SBF deploy:** Agave 4.2 / early 4.3 rejected upgradeable-loader deploy of **`--arch v0`** artifacts (`sbpf_version … not enabled`, SIMD-0500). **S4a proven path (2026-08-29):** Agave **4.3.0-beta.2** (= Devnet) + platform-tools **v1.56** + **`cargo-build-sbf --arch v3`** + `solana program deploy` / `set-upgrade-authority` ([`svm/scripts/prove-upgradeable-deploy.sh`](../scripts/prove-upgradeable-deploy.sh)). Stand default preload still uses `--arch v0` + `--bpf-program`.
5. **mpl-core Rust:** use **0.11.2** with `solana-program` 2.3 (0.10.x / 0.12.x hit borsh conflicts in this toolchain).

## Stop rule

П-1 and П-2 **passed** → continue to shared crates and programs. Phase S3 readiness still requires the **live** cross-VM stand (not host byte simulation alone).
