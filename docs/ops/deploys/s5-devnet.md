# S5 — Solana Devnet verifiers (staking + pass + verify)

**Status:** local stand COMPLETE; S5-recover-R5 pathway re-closed (new passport/gateway, deployer UA, live RT). Staking/pass `8tts6h…` / `4TE2kf…` retained. **Next:** R6 prove on new passport.

**Standing UA policy:** [svm-devnet.md](./svm-devnet.md) — S4–S8 deployer retains upgrade authority; `SOLANA_UPGRADE_AUTHORITY` ≡ deployer pubkey; no handoff; `pnpm verify:svm-authority`.

### Devnet program ids (live after R5)

| Program | Program id | Upgrade authority |
|---------|------------|-------------------|
| kar_passport | `ArvcryxBL1mP44Vo4MoK1FE3YCnNG8JdVa3iTKxgWnTQ` | deployer `65Qmw…` |
| kar_gateway | `9ugwozoJteH4D5XQmwvprevsZ6uWLoHEcWZWeVbDn693` | deployer `65Qmw…` |
| kar_pro_staking | `8tts6h74Uos5FuUJMEQ8uQd5oPXfKZ41Xfid9D6iZvXY` | deployer `65Qmw…` |
| kar_pro_pass | `4TE2kf7N4F43ab1436KA71ZwKKokdGt7ANRDbreWbnHr` | deployer `65Qmw…` |

Y5-frozen passport/gateway: see [s4b-devnet.md](./s4b-devnet.md) abandon section.

## Min stake pin

Stated testnet constant of the same order as declared `0.05 ETH` (`DECLARED_MIN_STAKE_NATIVE_WEI`) — **not** an FX observation:

| Field | Value |
|-------|--------|
| Kind | `stated_testnet_constant` |
| Declared at | 2026-08-30 |
| Source | `lib/web3/min-stake-sol.ts` (stated constant; not a rate) |
| Lamports | `500_000_000` (0.5 SOL) |
| Floor | `10_000_000` (same order as 0.001 ETH) |

Join never quotes FX. Mainnet must derive from an observed on-chain rate and re-pin on every redeploy (SPEC §13.10).

## Local stand

```bash
./svm/stand/run-stand.sh --live-both
```

Flow after bridge RT: `SetStakingProgram` → join → mint/verify passport → leave → close_pass → claim (2s unbond).

## Devnet sequence (after R5 new passport)

Standing rule: [svm-devnet.md](./svm-devnet.md).

1. Ensure `.env.local`: `SOLANA_UPGRADE_AUTHORITY` = deployer pubkey.
2. Redeploy passport + gateway (R5); rewire; live RT.
3. Prove (R6): `SetStakingProgram` → mint → join (`active`) → verify (VERIFIED) → leave (`active=false`) → close_pass → claim; assert state at each step. **No** UA handoff.
4. Write `deployments/svm-40168.json` (`minStakePin` stated constant + prove timeline).

Staking/pass ids above stay; new passport binds them via `SetStakingProgram`.

## Pass as projection

`leave` never CPI-burns the pass. Close is a separate instruction. Readers of verifier status use the stake PDA only.

## Pair init / A3

Staking and pass initialise together and bind each other. Replacing staking without a new pass pair leaves holders unable to re-join (same shape as Nuclear A3 retarget trap).
