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

## Toolchain: Agave 4.2 + `--bpf-program`

Upgradeable-loader deploy of platform-tools v1.54 fails locally (`sbpf_version … not enabled`). **Resolved path (lab and stand):**

1. `cargo-build-sbf --arch v0`
2. Load every program with `solana-test-validator --bpf-program <pubkey> <path.so>`

`start-validator.sh` preloads Metaplex Core, SPL noop, `mock_endpoint`, `kar_passport`, `kar_gateway`, `mock_staking`. This is a loader/toolchain fix, not an architectural deferral.

## LzReceive account list (normative)

Built by `kar_gateway::lz_receive_types` (indexes in `LZ_RECEIVE_ACCOUNTS`):

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

Instruction data: `LzReceive { src_eid, sender, nonce, guid, message }`. Entrypoint CPIs mock `Clear` **first**, then passport BridgeMint / BridgeResetOnUnlock (+ transfer on unlock).

## Live run

```bash
./svm/stand/run-stand.sh --live
# or manually:
#   Terminal A: ./svm/stand/start-validator.sh
#   Terminal B: KARGAIN_SVM_STAND_LIVE=1 pnpm test:svm-stand
```

Live scenario:

1. Init endpoint / passport / gateway; bind gateway config PDA as `bridge_gateway`.
2. **EVM→SVM:** encode ONFT via `encodeOnftMessage` (EVM wire), dumb-relay copy, `LzReceive` → Core asset + UNVERIFIED state.
3. **SVM home:** `MintPassport` → `Send` (lock+freeze) → return `LzReceive` unlock → UNVERIFIED, unlocked.

Receive-shaped CU is logged for RESULTS (measure only; **do not** pin in `lz-receive-gas.ts` until S4).

Optional `KARGAIN_SVM_STAND_EVM=1`: asserts Hardhat at `:8545` is up (dual-mock suite stays in Hardhat tests).

## Build BPF artifacts

```bash
export PATH="${HOME}/.local/share/solana/install/active_release/bin:${PATH}"
for p in mock-endpoint kar-passport kar-gateway mock-staking; do
  (cd svm/programs/$p && cargo-build-sbf --arch v0)
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
