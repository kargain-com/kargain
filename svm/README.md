# SVM workspace (S4a)

Local Solana programs and shared crates for the KarPassport / bridge gateway port.
**No Devnet writes in S4a.** Lab proofs: [`lab/RESULTS.md`](lab/RESULTS.md). Upgradeable deploy proof: [`scripts/prove-upgradeable-deploy.sh`](scripts/prove-upgradeable-deploy.sh).

## Toolchain (pinned)

| Layer | Pin | Notes |
|-------|-----|-------|
| Host Rust (`cargo test`) | **1.85.0** via [`rust-toolchain.toml`](rust-toolchain.toml) and repo `.tool-versions` | Workspace host builds only |
| Solana Devnet `getVersion` | **`4.3.0-beta.2`** (read **2026-08-29** against `https://api.devnet.solana.com`) | Authoritative for S4b |
| Local Agave / `solana-cli` | **`4.3.0-beta.2`** (`agave-install init 4.3.0-beta.2`) | Must match Devnet for upgradeable proof |
| `cargo-build-sbf` | **4.2.0** (ships with that Agave) | |
| platform-tools | **v1.56** | SBF rustc 1.89.0 under `~/.cache/solana/v1.56/` |
| Upgradeable-loader builds | **`cargo-build-sbf --arch v3`** | Required after SIMD-0500; `v0`/`v1`/`v2` → `sbpf_version … not enabled` |
| Stand preload path (legacy) | `--arch v0` + `solana-test-validator --bpf-program` | Still used by default stand; bypasses upgradeable loader |

Ensure Agave CLI is on `PATH` (e.g. `~/.local/share/solana/install/active_release/bin`).

**Upgradeable path (S4a T1 — proven locally):**

```bash
./svm/scripts/prove-upgradeable-deploy.sh
# deploy with --upgrade-authority A → set-upgrade-authority to B → program show Authority = B
```

Do **not** treat `--bpf-program` preload as proof of the Devnet deploy path.

## Workspace members

| Path | Role |
|------|------|
| `crates/kargain-errors` | Stable error names/codes (EVM parity) |
| `crates/kargain-onft-codec` | ONFT721 wire codec (byte-identical) |
| `crates/kargain-claimable-payouts` | Claimable payouts automaton |
| `crates/kargain-bonded-challenge` | BondedChallenge automaton |
| `programs/kar-passport` | Passport + state PDAs + gateway-only bridge ix |
| `programs/kar-gateway` | Send / receive / recover / `lz_receive_types` |
| `programs/mock-staking` | `MockKarProActive` spirit (tests) |
| `programs/mock-endpoint` | Local Endpoint `clear` account layout |

`lab/programs/lab_harness` is **excluded** from this workspace (standalone BPF package).

## Build & test (host)

From repo root:

```bash
pnpm test:svm          # cargo test — programs/crates; no validator
pnpm test:svm-stand    # host both-direction payload path; live probe optional
```

Or from `svm/`:

```bash
cargo test
```

Host unit tests cover `may` check-order, URI EmptyField, recover preconditions, compose fail-closed, `lz_receive_types` determinism, clear-before-state sequencing, and the gateway `host_roundtrip` stitch — **no validator required**.

Cross-VM stand docs: [`stand/README.md`](stand/README.md). S3.5 candidates (scenario-backed only): [`S3.5-CANDIDATES.md`](S3.5-CANDIDATES.md).

## BPF build

```bash
# Upgradeable / Devnet-shaped (S4a+):
cd programs/kar-passport && cargo-build-sbf --arch v3
# … same for kar-gateway, mock-staking, mock-endpoint

# Stand preload (legacy --bpf-program path):
cargo-build-sbf --arch v0
```

Artifacts land in `svm/target/deploy/*.so`.

Host `cargo test` does **not** require `cargo-build-sbf`.

## Normative notes

- Config PDAs hold П-12 fields (namespace, local EID, endpoint program, native bonds). No compile-time EID/lamports.
- Permanent freeze authority = **gateway freeze PDA**; custody_locked is a **state field** (`may` ignores it).
- Asset PDA = `[b"asset", token_id]` under the passport program (32-byte BE tokenId).
- Gateway has **no** `fund_receive_rent` instruction; the receive fee payer covers rent.
- Do not invent CU/rent budget pins here — measure locally in S4a / re-measure on Devnet in S4b before writing `lz-receive-gas.ts`.
