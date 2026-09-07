# S9-B-2 — Devnet in-place upgrade of the four pre-S7a programs

**Status: DONE on chain (2026-09-07).** Standing UA: [svm-devnet.md](./svm-devnet.md) — the deployer retains upgrade authority through S9.

Related records: [s4b-devnet.md](./s4b-devnet.md) · [s5-devnet.md](./s5-devnet.md) · [s9-0-devnet-modes.md](./s9-0-devnet-modes.md) · [s9-b-solana-cutover.md](./s9-b-solana-cutover.md)

## Why this operation existed

The four programs on Solana Devnet — passport, gateway, KarPro staking, KarPro pass — were deployed on 2026-08-30 from git head `2658f5de`. The structured event carrier (`Program data:` / `sol_log_data`) landed on 2026-09-01 in `0893ce0`, of which `2658f5de` is an ancestor. `git grep sol_log_data 2658f5de -- 'svm/**'` returns nothing; on `master` it lives in `svm/crates/kargain-events`.

Consequence, established before any change was made: the deployed bytecode could not emit structured payloads at all, so the production ingest measuring **zero** structured payloads was reporting the correct answer for what was on chain. It was not a parser defect, not a discovery defect, and not a watermark defect. The modes (`kar_fixed_price`, `kar_ascending`, deployed 2026-09-04) were already post-S7a and were **not** touched by this operation.

## What changed, and what deliberately did not

| Changed | Unchanged |
|---|---|
| The ELF behind four existing program ids | Program ids |
| `soSha256` / `soBytes` / `sourceGitHead` for those four in deploy evidence | `deploySlot` in evidence and `blocks.*` in `COMMERCIAL_ACTIVE` |
| Program-data account capacity (extend, below) | Upgrade authority (deployer), loader (upgradeable) |

**The registry was not edited, and that is the design, not an omission.** `COMMERCIAL_ACTIVE` carries network identity: program ids and the per-program start cursors the indexer follows. An in-place upgrade changes neither. `deploySlot` means *the slot at which this program id became followable*; raising it to the upgrade slot would move the indexer's floor and discard observable history for no gain. Because nothing in the registry changed, no Ponder rebuild was triggered by this operation itself.

Evidence (`deployments/svm-40168.json`) stays gitignored and remains a deploy-machine assert. It is not a runtime source; a reachability gate keeps its loader out of the runtime graph.

## Capacity extend (founder-approved, irreversible)

A Solana upgradeable program's program-data account is sized at its initial deploy. Every new artifact was larger than the deployed one, so the upgrade could not land without extending first. The upgrade path passes `--no-auto-extend` and refuses by name on a deficit, so extending is always a separate, explicitly approved step.

Target capacity was set to **125 % of the new artifact**, not to the exact deficit: the programs keep growing across S9, and each further ceiling would cost another irreversible step.

| Program | Capacity before → after | Additional bytes |
|---|---|---|
| kar_passport | 191 128 → 327 520 | 136 392 |
| kar_gateway | 218 192 → 279 880 | 61 688 |
| kar_pro_staking | 102 384 → 134 480 | 32 096 |
| kar_pro_pass | 143 728 → 185 680 | 41 952 |
| **Total** | | **272 128** |

Estimated cost 1 382 410 240 lamports; measured payer delta **333 245 480** lamports. The estimator is an upper bound, not a prediction — see the residual below.

## Upgrade

Ordering property of the tool, relied on here: source identity is resolved **before** the first transaction, and an unclean working tree refuses by name, so no artifact can reach the chain without a commit that describes it.

Recorded source for all four: `70b6098` (`70b60985dcc…`, clean tree).

| Program | New digest (sha256, head) | Artifact bytes | Outcome |
|---|---|---|---|
| kar_passport | `d5c624d9…956b` | 262 016 | upgraded |
| kar_gateway | `f29431da…17cb` | 223 904 | upgraded |
| kar_pro_staking | `a992594c…9e0e` | 107 584 | upgraded |
| kar_pro_pass | `dcb7af4a…35c9` | 148 544 | upgraded |

None skipped, none failed. Post-upgrade read-back: loader unchanged, authority still the deployer, `Last Deployed In Slot` advanced. `pnpm verify:svm-authority` reports `6 of 6; complete`.

Payer delta across the whole sequence was a **net credit** of 180 593 360 lamports (reclaimed upgrade buffers exceeded fees) against a tool estimate of 3 772 204 800.

**`Data Length` is not evidence of what landed.** After the extend it reports allocated capacity (327 520 / 279 880 / 134 480 / 185 680), not ELF length, and Solana does not shrink it on upgrade. Anyone reading this record later should not treat that field as confirmation.

## What this record does not establish

- **Binary identity.** That the bytecode now executing is the artifact these digests describe is *not* proven here. The evidence is CLI exit codes and a moved deploy slot. The gate that closes this — evidence digest against the bytecode read back from chain, refusing by name — is the open unit that follows.
- **`kar_fixed_price` / `kar_ascending`** carry neither `soSha256` nor `sourceGitHead` in evidence. Their digests have nothing to compare against, and that absence must refuse rather than pass silently.
- **Emits.** The upgrade made structured emits *possible*. It produced none: these programs see no Devnet traffic on their own. The first structured payload will come from a real invocation (stand / prove / CLI / product mint), not from waiting. Product Irys on Solana (П-8) is required for the **app** mint path; it is **not** required to create the first measurable `Program data:` row.

## Owed after this operation

1. VPS: `git pull`, then `docker compose build svm-ingest && docker compose up -d --force-recreate svm-ingest` — **svm-ingest only**. The Ponder service is not part of this path.
2. Re-measure structured payloads *after* traffic exists, not before.
3. Fill digest and source for the two modes at their next deploy.

## Residual: the cost estimator

Two measurements, both conservative: extend estimated 1 382 410 240 against 333 245 480 actual (≈4×); the upgrade estimated 3 772 204 800 against a net credit (≈21× in absolute terms). The estimator answers *peak capital required for temporary buffers*, which is the right question for a pre-flight refusal, while the reported figure reads as *cost*. The two are not the same quantity and should not share one name. Not a blocker — the direction is fail-closed — but it is an open naming defect, recorded so a future reader does not mistake the estimate for a spend.
