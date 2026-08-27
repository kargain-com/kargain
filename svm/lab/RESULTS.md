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
4. **SBF deploy (resolved path for lab and stand):** Agave 4.2 local validator rejected upgradeable-loader deploy of platform-tools v1.54 artifacts (`sbpf_version … not enabled`). **Fix:** build with `cargo-build-sbf --arch v0` and load via `--bpf-program` (same path for stand). This is a toolchain/loader mismatch, not an architectural deferral.
5. **mpl-core Rust:** use **0.11.2** with `solana-program` 2.3 (0.10.x / 0.12.x hit borsh conflicts in this toolchain).

## Stop rule

П-1 and П-2 **passed** → continue to shared crates and programs. Phase S3 readiness still requires the **live** cross-VM stand (not host byte simulation alone).
