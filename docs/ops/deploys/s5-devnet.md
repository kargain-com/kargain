# S5 — Solana Devnet verifiers (staking + pass + verify)

**Status:** local stand COMPLETE; Devnet programs DEPLOYED (deployer UA); **prove blocked** pending passport BPF upgrade under `SOLANA_UPGRADE_AUTHORITY`.

**Authority cycle (standing):** [svm-devnet.md](./svm-devnet.md) — S5 begin = return passport UA to deployer; end = hand passport + staking + pass after prove.

### Devnet program ids (2026-08-30)

| Program | Program id | Upgrade authority |
|---------|------------|-------------------|
| kar_pro_staking | `8tts6h74Uos5FuUJMEQ8uQd5oPXfKZ41Xfid9D6iZvXY` | deployer `65Qmw…` (retain until prove) |
| kar_pro_pass | `4TE2kf7N4F43ab1436KA71ZwKKokdGt7ANRDbreWbnHr` | deployer `65Qmw…` |
| kar_passport (live) | `FsDmjkrStitUPbh46y8JocGozNotF3EcT9rpDM1RDx1i` | `BSuJ…` — **must upgrade BPF** before SetStakingProgram/VerifyPassport |

Pair-init on Devnet succeeded. `SetStakingProgram` failed: live passport lacks S5 instruction discriminants (`invalid instruction data`).

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

## Devnet sequence (authority cycle)

Standing rule: [svm-devnet.md](./svm-devnet.md).

```bash
# load .env.local SOLANA_* ; session keypair for BSuJ… (not a permanent env secret)
./svm/scripts/s5-close-devnet.sh --upgrade-authority-keypair /path/to/ua.json
```

Steps (scripted):

1. Begin cycle — return passport `FsDmjkr…` UA from `SOLANA_UPGRADE_AUTHORITY` → deployer; `program show`.
2. Upgrade live `kar_passport` BPF (VerifyPassport + SetStakingProgram).
3. Prove: `SetStakingProgram` → mint → join (`active`) → verify (VERIFIED) → leave (`active=false`) → close_pass → claim; assert state at each step.
4. End cycle — hand UA for passport + staking + pass → `SOLANA_UPGRADE_AUTHORITY`; three read-backs.
5. Write `deployments/svm-40168.json` (`minStakePin` stated constant + timeline).

If the upgrade-authority keypair is unavailable: **stop** — do not `--skip-new-upgrade-authority-signer-check`.

Staking/pass were already deployed (deployer UA) via `./svm/scripts/deploy-s5-staking.sh`; close reuses those ids from evidence.

## Pass as projection

`leave` never CPI-burns the pass. Close is a separate instruction. Readers of verifier status use the stake PDA only.

## Pair init / A3

Staking and pass initialise together and bind each other. Replacing staking without a new pass pair leaves holders unable to re-join (same shape as Nuclear A3 retarget trap).
