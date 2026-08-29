# Local cross-VM stand (S3)

**No Devnet.** Dumb payload relay between EVM-shaped ONFT bytes (byte-identical to Hardhat `EndpointV2Mock` / ONFT721MsgCodec) and the SVM `mock-endpoint` + `kar-gateway` programs. Rent on SVM receive is paid only by the fee payer — there is **no** `fund_receive_rent` instruction.

## Gates

| Layer | Command | Needs |
|-------|---------|-------|
| Program / crate unit tests | `pnpm test:svm` (`cargo test` in `svm/`) | Rust toolchain |
| Host both-direction + relay identity | `pnpm test:svm-stand` | Node / tsx |
| **Live Core CPI round trip** | `./svm/stand/run-stand.sh --live` | Agave CLI + BPF builds |
| ONFT wire vectors (TS ↔ Rust) | `pnpm test:bridge` (`onft-conformance`) | Node |
| Dual Hardhat EndpointV2Mock | `pnpm test` (Hardhat suite) | `test/KarPassportBridgeGateway.test.ts` |

Host simulation (`host-sim.ts`) always runs under `test:svm-stand` and proves relay identity, compose fail-closed, clear-before-state, VerificationReset-from-VERIFIED, URI travel, records-on-writing-chain.

Live path (`live-roundtrip.ts`, `KARGAIN_SVM_STAND_LIVE=1`) **requires** a healthy validator and **fails** (does not soft-skip) if Core CPI mint/unlock fails.

## Toolchain: Agave 4.3 + dual load paths

**Devnet / local Agave (2026-08-29):** `4.3.0-beta.2`. Full pins: [`svm/README.md`](../README.md).

| Path | Build | Load | Authority |
|------|-------|------|-----------|
| **Upgradeable (S4a — Devnet-shaped)** | `cargo-build-sbf --arch v3` | `solana program deploy` + `set-upgrade-authority` | Exists (Squads stand-in) |
| **Preload (stand default)** | `cargo-build-sbf --arch v0` | `solana-test-validator --bpf-program` | None (bypasses upgradeable loader) |

Prove upgradeable locally (no Devnet):

```bash
./svm/scripts/prove-upgradeable-deploy.sh
```

`v0` artifacts fail upgradeable deploy with `sbpf_version … not enabled` (SIMD-0500). Preload path remains for the default stand until dual-load coverage lands.

`start-validator.sh` preloads Metaplex Core, SPL noop, `mock_endpoint`, `kar_passport`, `kar_gateway`, `mock_staking` via `--bpf-program` by default.

## LzReceive account list

Selected by `GatewayConfig.endpoint_program` in `kar_gateway::lz_receive_types`:

### Mock stand (13) — `--live` / `--live-both`

| # | Account | Notes |
|---|---------|-------|
| 0 | gateway config PDA | also OApp signer + home custody holder |
| 1 | payer | signer; pays rent |
| 2 | endpoint program | mock-endpoint |
| 3 | endpoint config PDA | |
| 4 | clear receipt PDA | `[ep_clear, src_eid_le, sender, nonce]` |
| 5 | system program | |
| 6 | passport program | |
| 7 | passport config PDA | Core update authority |
| 8 | asset PDA | `[asset, token_id]` under passport |
| 9 | state PDA | `[state, token_id]` under passport |
| 10 | freeze PDA | `[freeze]` under gateway |
| 11 | Metaplex Core | `CoREENxT6…` |
| 12 | `to` | recipient / new owner |

### Production EndpointV2 (18) — Devnet / M2

Payer first; trailing 8 metas = real `get_accounts_for_clear` (RESULTS.md S4a-1 M2). Receiver = gateway config PDA.

Instruction data: `LzReceive { src_eid, sender, nonce, guid, message }`. Entrypoint CPIs Endpoint `clear` **first** (mock or production), then passport BridgeMint / BridgeResetOnUnlock (+ transfer on unlock).

## Live run

```bash
# Preload path (--bpf-program; default live)
./svm/stand/run-stand.sh --live

# Upgradeable-loader path (S4a Devnet-shaped; --arch v3 + solana program deploy)
./svm/stand/run-stand.sh --live-upgradeable

# Both sequentially (gate)
./svm/stand/run-stand.sh --live-both
```

Or manually:

```bash
# Preload:
./svm/stand/start-validator.sh
KARGAIN_SVM_STAND_LIVE=1 pnpm test:svm-stand

# Upgradeable:
KARGAIN_SVM_STAND_LOAD=upgradeable ./svm/stand/start-validator.sh
./svm/stand/deploy-stand-programs.sh
KARGAIN_SVM_STAND_LIVE=1 pnpm test:svm-stand
```

Live scenario (same assertions both load paths):

1. Init endpoint / passport / gateway; bind gateway config PDA as `bridge_gateway`.
2. **EVM→SVM:** encode ONFT via `encodeOnftMessage` (EVM wire), dumb-relay copy, `LzReceive` → Core asset + UNVERIFIED state.
3. **SVM home:** `MintPassport` → `Send` (lock+freeze) → return `LzReceive` unlock → UNVERIFIED, unlocked.

Receive-shaped CU and **foreign-mint tx size** are logged for RESULTS (measure only; **do not** pin in `lz-receive-gas.ts` until S4b Devnet re-measure). Live URI defaults to the declared ceiling (**160** UTF-8 bytes); set `KARGAIN_SVM_STAND_URI_TYPICAL=1` for the short pointer.

Optional `KARGAIN_SVM_STAND_EVM=1`: asserts Hardhat at `:8545` is up (dual-mock suite stays in Hardhat tests).

## Build BPF artifacts

```bash
export PATH="${HOME}/.local/share/solana/install/active_release/bin:${PATH}"
# Preload:
for p in mock-endpoint kar-passport kar-gateway mock-staking; do
  (cd svm/programs/$p && cargo-build-sbf --arch v0)
done
# Upgradeable:
for p in mock-endpoint kar-passport kar-gateway mock-staking; do
  (cd svm/programs/$p && cargo-build-sbf --arch v3)
done
# artifacts → svm/target/deploy/*.so
```

## Forbidden on this stand

- Re-encoding the message inside the relay
- Cloning the real LayerZero messaging router / waiting for DVN delivery
- `fund_receive_rent`
- Inventing CU / rent budget pins (measure; pin in S4)
- Adding an SVM row to `COMMERCIAL_ACTIVE`
- Soft-skipping live Core CPI when `KARGAIN_SVM_STAND_LIVE=1`
