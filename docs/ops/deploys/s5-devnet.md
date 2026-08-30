# S5 — Solana Devnet verifiers (staking + pass + verify)

**Status:** code + local stand proven; Devnet deploy follows S4b order (deployer UA → prove → handoff).

## Min stake pin

Declared ETH weight `0.05 ETH` (`DECLARED_MIN_STAKE_NATIVE_WEI`) converted once at deploy:

| Field | Stand / Devnet fixture |
|-------|------------------------|
| Rate | 1 ETH = 10 SOL |
| Date | 2026-08-30 |
| Source | `stand-fixture` (`lib/web3/min-stake-sol.ts`) |
| Lamports | `500_000_000` (0.5 SOL) |
| Floor | `10_000_000` (from 0.001 ETH) |

Join never quotes FX. Mainnet must re-pin on every redeploy (SOL↔ETH drift).

## Local stand

```bash
./svm/stand/run-stand.sh --live-both
```

Flow after bridge RT: `SetStakingProgram` → join → mint/verify passport → leave → close_pass → claim (2s unbond).

## Devnet sequence (S4b order)

1. Build + deploy `kar_pro_staking` + `kar_pro_pass` with **deployer** upgrade authority:
   ```bash
   # load .env.local SOLANA_*
   ./svm/scripts/deploy-s5-staking.sh
   ```
2. Upgrade live `kar_passport` BPF to include `VerifyPassport` + `SetStakingProgram` using current UA (`SOLANA_UPGRADE_AUTHORITY`). If that key is not available, **stop** — do not `--skip-new-upgrade-authority-signer-check`.
3. `scripts/svm-s5-init-and-prove.ts` (invoked by deploy script): pair-init → `SetStakingProgram` → join → verify → leave → close → claim → hand staking/pass UA → write `deployments/svm-40168.json` (`kar_pro_staking`, `kar_pro_pass`, `minStakePin`).

## Pass as projection

`leave` never CPI-burns the pass. Close is a separate instruction. Readers of verifier status use the stake PDA only.

## Pair init / A3

Staking and pass initialise together and bind each other. Replacing staking without a new pass pair leaves holders unable to re-join (same shape as Nuclear A3 retarget trap).
