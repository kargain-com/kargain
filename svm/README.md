# SVM workspace (S3)

Local Solana programs and shared crates for the KarPassport / bridge gateway port.
**No Devnet writes in S3.** Lab proofs: [`lab/RESULTS.md`](lab/RESULTS.md).

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

Same toolchain as the lab harness (`mpl-core` **0.11.2** + `solana-program` **2.3**, `--arch v0`).
Ensure Agave CLI tools are on `PATH` (e.g. `~/.local/share/solana/install/active_release/bin`):

```bash
# from each program directory, e.g.
cd programs/kar-passport && cargo-build-sbf --arch v0
cd ../kar-gateway && cargo-build-sbf --arch v0
cd ../mock-staking && cargo-build-sbf --arch v0
cd ../mock-endpoint && cargo-build-sbf --arch v0
```

Artifacts land in each package’s `target/deploy/*.so`. Load via `solana-test-validator --bpf-program` (upgradeable deploy of platform-tools v1.54 was rejected on Agave 4.2 in lab — see RESULTS).

Host `cargo test` does **not** require `cargo-build-sbf`.

## Normative notes

- Config PDAs hold П-12 fields (namespace, local EID, endpoint program, native bonds). No compile-time EID/lamports.
- Permanent freeze authority = **gateway freeze PDA**; custody_locked is a **state field** (`may` ignores it).
- Asset PDA = `[b"asset", token_id]` under the passport program (32-byte BE tokenId).
- Gateway has **no** `fund_receive_rent` instruction; the receive fee payer covers rent.
- Do not invent CU/rent budget pins here — measure in S3 stand / pin in S4.
