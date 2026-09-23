# S8-E — Devnet: mode configs, passport binding, encumbrance registration

Operation run by the founder on 2026-09-23, after the six-program in-place upgrade from `4fd0b92`.
Namespace 2 000 040 168 (Solana Devnet, EID 40168). No program was deployed or upgraded here; no
registry row, deploy slot or ingest floor changed.

## What it did

Both consignment modes had no state at all on this cluster: they had been deployed and upgraded,
but `InitConfig` had never run, so no `CommerceConfig` / `AscendingConfig` existed. Three things
happened, in order:

1. `InitConfig` on FixedPrice (`33Ckma…`) and on Ascending (`29BfVj…`).
2. `BindPassportProgram` on each mode (`4ZDDb3…`, `26YGwD…`) — the one-shot binding that names which
   passport program the mode trades.
3. `AddEncumbranceSource` twice on the passport (`546SMX…`, `3G1HfB…`) — registering each mode with
   the answer seed prefix it will use.

Until all three existed, every Core open refused: unbound (`PassportProgramUnbound`) or not
registered (`ModeNotEncumbranceSource`).

## Measured afterwards

Read back through the account decoders, not by parsing bytes in the ops script.

| Account | Address | Size |
|---|---|---:|
| passport config | `4rsVEChyam3qQV3586sGf2m7A6gm76QA66TGKW82Bz1G` | 318 |
| FixedPrice config | `9DSwneBv7qpUAkPgutc4wsrhSz7D3TJoNsm26DFBgyXV` | 109 |
| Ascending config | `CTgfCMRheBEghDtvBkdMWq9ehMYnTQE3aYU4BJc3VpiZ` | 190 |
| FixedPrice binding | `LoAewvJJ4vMc46rpfZyPAWtV59J3DtvZXxA5tFJooMb` | — |
| Ascending binding | `6csSiZZxhU4wc6s6evhTkCuNNRu3Upd4tJcRB7M7VEwv` | — |

Both bindings are owned by their own mode program and name the passport
`ArvcryxBL1mP44Vo4MoK1FE3YCnNG8JdVa3iTKxgWnTQ`.

The passport registry holds two sources, in order:

| # | Program | Seed prefix |
|---|---|---|
| 0 | `HmKV5QEVQLdpCiyQAvP4dpqPDBUedi35RSCcWL5XTxyu` (FixedPrice) | `fp-ans` |
| 1 | `HMGnyNMFNi9Rjakrch3iAfmoNWRFK7DEBzsEyLiQNt74` (Ascending) | `asc-ans` |

Mode config values, both modes identical where the field exists:

| Field | Value |
|---|---|
| authority | `65Qmw9zhpkjxJApmFngx3dxmGo2KiZ4kyJycLsWh4gU9` |
| platform recipient | `HPP7frMzYC87FsznTF48969TRsnzDMAe9RUuvzgSGprE` |
| platform fee | 10 bps |
| guardian | `65Qmw9zhpkjxJApmFngx3dxmGo2KiZ4kyJycLsWh4gU9` |
| paused | false |
| Ascending: staking program | `8tts6h74Uos5FuUJMEQ8uQd5oPXfKZ41Xfid9D6iZvXY` |
| Ascending: forfeit recipient | `HPP7frMzYC87FsznTF48969TRsnzDMAe9RUuvzgSGprE` |
| Ascending: challenge bond | 1 000 000 lamports |
| Ascending: challenge window | 1 209 600 s (14 days) |

For the sample passport `…764614` (a live `PassportState` on this cluster, `recordCount` 0), the
four answer addresses the product will derive are `3wCZpZmz…` / `Dqo17TCr…` (FixedPrice, LeaveChain
and OpenConsignment) and `7es1DyGT…` / `EXGcGrxV…` (Ascending). None of them exists yet: an answer
account is created when an obligation starts and closed when it ends.

## Two values that deserve naming

**The platform recipient is the forfeit recipient**, and **the guardian is the deployer authority**.
Both were chosen by the init script rather than by a decision, and both collapse roles the platform
otherwise keeps apart: fee income versus forfeited bonds, and the pause role versus the admin role.

**Neither can be changed on this cluster today.** The config PDA has no close path, so every
`InitConfig` value is sticky for the life of the account. Status by field:

| Value | Status |
|---|---|
| guardian | sticky on this cluster until a later upgrade ships `SetGuardian` (EVM has `setGuardian`; SVM crate already holds `set_guardian`) |
| platform recipient | sticky forever — InitConfig-only on **both** VMs (EVM has no setter either; not an owed parity gap) |
| platform fee bps, challenge window, forfeit recipient, staking program | sticky — InitConfig-only |
| challenge bond | settable (`SetChallengeBond`) |
| paused | settable (`Pause` / `Unpause`) |

On a testnet where one key already holds every authority this costs nothing. It is recorded because
the same shape on a commercial network would not be acceptable: the guardian must be a key the owner
does not hold, and the two recipients are different money roles. The platform≡forfeit collapse is a
chosen-value defect, not a missing-instruction defect; correcting it on this cluster would require
a fresh config PDA.

## What this record does not establish

- **No commercial flow has run.** No Core custody move, no answer account, no refusal — only the
  wiring that makes them possible. The first open, bid, settle or bridge refusal on this cluster is
  a later operation.
- **Nothing about product behaviour.** The addresses above are what the product will derive; no
  product code has read them on this cluster.
