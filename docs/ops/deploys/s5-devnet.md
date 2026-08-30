# S5 — Solana Devnet verifiers (staking + pass + verify)

**Status: COMPLETE** (August 30, 2026 — S5-recover-R6). Local stand + Devnet prove PASS. Passport/gateway from R5 under deployer UA; staking/pass retained; no UA handoff.

**Standing UA policy:** [svm-devnet.md](./svm-devnet.md) — S4–S8 deployer retains upgrade authority; `SOLANA_UPGRADE_AUTHORITY` ≡ deployer pubkey; `pnpm verify:svm-authority`.

### Devnet program ids (live)

| Program | Program id | Upgrade authority |
|---------|------------|-------------------|
| kar_passport | `ArvcryxBL1mP44Vo4MoK1FE3YCnNG8JdVa3iTKxgWnTQ` | deployer `65Qmw…` |
| kar_gateway | `9ugwozoJteH4D5XQmwvprevsZ6uWLoHEcWZWeVbDn693` | deployer `65Qmw…` |
| kar_pro_staking | `8tts6h74Uos5FuUJMEQ8uQd5oPXfKZ41Xfid9D6iZvXY` | deployer `65Qmw…` |
| kar_pro_pass | `4TE2kf7N4F43ab1436KA71ZwKKokdGt7ANRDbreWbnHr` | deployer `65Qmw…` |

Pathway / RT: [s4b-devnet.md](./s4b-devnet.md). Y5-frozen ids abandoned there.

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

Flow after bridge RT: `SetStakingProgram` → join → mint/verify passport → leave → close_pass → early claim refused → wait unbond → claim.

Asserted at each step (shared owner `scripts/lib/svm-verifier-lifecycle-asserts.ts`):

| Step | Predicate |
|------|-----------|
| Join | stake PDA `active == true` |
| Verify | passport `status == Verified` + verifier pubkey |
| Leave | stake `active == false` |
| ClosePass | Core pass asset not live (D-17 tombstone/closed); stake still inactive (D-21) |
| Claim early | `UnbondNotReady` (`Custom(48)`) before unbond elapses |
| Claim | principal from stake record arrives at verifier (fee-adjusted); stake lamports fall by that amount; rent-exempt remainder stays on open stake PDA; `amount`/`unlock_at`/`staked_at` cleared |

## Devnet prove (R6; W4 predicates wired)

```bash
# .env.local: SOLANA_UPGRADE_AUTHORITY = deployer pubkey
pnpm exec tsx scripts/svm-s5-init-and-prove.ts \
  --staking 8tts6h74Uos5FuUJMEQ8uQd5oPXfKZ41Xfid9D6iZvXY \
  --pass 4TE2kf7N4F43ab1436KA71ZwKKokdGt7ANRDbreWbnHr \
  --deployer-keypair <deployer.json> --rpc "$SOLANA_RPC_URL" \
  --evidence deployments/svm-40168.json --work <tmpdir>
```

**Last live Devnet prove (R6, 2026-08-30):** `SetStakingProgram` → mint (distinct owner) → join (ephemeral verifier) → verify → leave → close_pass → claim. Asserted Join/Verify/Leave only; ClosePass/ClaimStake were tx-success only. **No** UA handoff.

**W4 (same day):** the predicate table above is wired into this script and the local stand. Local stand proved the full table against live validator programs. **Devnet was not re-run with W4 predicates** — re-run the command above as an ops step before treating Devnet evidence as predicate-green. Env UA ≡ deployer via sole owner `assertSolanaUpgradeAuthorityMatchesDeployer` (CLI for bash deploys).

## Pass as projection

`leave` never CPI-burns the pass. Close is a separate instruction. Readers of verifier status use the stake PDA only.

## Pair init / A3

Staking and pass initialise together and bind each other. Replacing staking without a new pass pair leaves holders unable to re-join (same shape as Nuclear A3 retarget trap).
