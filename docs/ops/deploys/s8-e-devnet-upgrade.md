# S8-E — Devnet in-place upgrade of the six commercial programs

Operation run by the founder on 2026-09-23 from source `4fd0b92` (clean tree, on `master`).
Same program ids, same upgrade authority, same registry rows, same ingest floors.

## Why this operation existed

The S8-E phase moved both consignment modes off their program-owned harness asset and onto the
Metaplex Core passport: custody moves are Core `TransferV1`, trust comes from the passport's own
`may` law and its status account, and each mode's obligation is written as encumbrance answer
accounts that exist only while the obligation does. The passport gained the source registry and an
executable `may`; the gateway, pro-pass and staking programs changed only in how they name a
refusal and where they derive a config address.

None of that was on chain. This operation lands the bytecode.

## Capacity extend (founder-approved, irreversible)

A program-data account is sized at its initial deploy, and the upgrade path passes
`--no-auto-extend`, so a deficit refuses rather than spending. Both modes had outgrown their
capacity; the other four had not.

The artifacts deployed here are built `--arch v3`, the path Agave 4.3 requires, and they are
**smaller** than the `--arch v0` artifacts the local stand preloads — by 8 to 18 KiB per program.
Planning on the stand's sizes would have overpaid.

| Program | Capacity before → after | Additional bytes | Rent (lamports) |
|---|---|---:|---:|
| kar_fixed_price | 232 544 → 465 990 | 233 446 | 1 185 905 680 |
| kar_ascending | 254 752 → 503 830 | 249 078 | 1 265 316 240 |
| **Total** | | **482 524** | **2 451 221 920** |

Target capacity is 125 % of the new artifact, the same rule as the earlier four-program extend: the
programs keep growing, and each further ceiling costs another irreversible step. The four programs
that already fit were not extended; `kar_pro_pass` no longer needs one at all, since its 125 %
target now sits below its deployed capacity.

## Upgrade

All six upgraded in one run with `--so-dir` pointing at the `--arch v3` build, evidence written to
the deploy machine's evidence file. Recorded source for all six: `4fd0b92`.

| Program | Artifact bytes | Digest (sha256, head) |
|---|---:|---|
| kar_passport | 274 744 | `fc2db580…` |
| kar_gateway | 245 696 | `9fe81953…` |
| kar_pro_staking | 108 584 | `1bfedaf3…` |
| kar_pro_pass | 148 184 | `005054d9…` |
| kar_fixed_price | 372 792 | `4155b9ba…` |
| kar_ascending | 403 064 | `a0442859…` |

None skipped, none failed.

## What this record establishes

- **Authority.** `verify:svm-authority` — evidence authority equals the on-chain authority for
  six of six; census complete.
- **Binary identity.** `verify:svm-binary-identity --eid=40168` — for each program the evidence
  digest equals the leading ELF of its program data, with the trailing padding proven empty
  (52 776 / 34 184 / 25 896 / 37 496 / 93 198 / 100 766 bytes of padding). This is the first run in
  which the two modes pass: until now they carried neither digest nor source and the gate exited
  non-zero by design. That absence is closed.

## What this record does not establish

- **That the stand exercised these exact bytes.** The local stand runs the `--arch v0` build of the
  same commit; the chain runs the `--arch v3` build. The stand's green is evidence about the source
  and the runtime version, not about the deployed bytes. Byte identity comes from the verification
  above, and only from there.
- **That any commercial Core flow has run on Devnet.** The modes are not yet bound to the passport
  and are not yet registered as encumbrance sources, so no Core custody move, answer account or
  refusal has occurred on this cluster. The first such transaction is a separate operation.
- **Behaviour under traffic.** These programs see no Devnet traffic of their own. Emission, compute
  and account-count measurements taken on the local validator are not observations of this cluster.

## Residual carried by the deployed bytecode

The two mode programs still contain three authority-gated clock instructions
(`ForceRecallRequestedAt`, `ForceAuctionEndsAt`, `ForceHoldClock`). They exist because the protocol
windows are days long and no available runtime can both move a clock and execute the Core custody
CPI, so the local proof of a post-window path still needs them. They are a power the EVM contracts
do not grant, they are named here rather than left to be discovered, and they are removed when a
runtime can prove those paths without them. The price-seeding instruction of the same family was
retired before this deployment and refuses by name.

## Owed after this operation

1. Bind both modes to the passport program and register them as encumbrance sources — the first
   live Core flow.
2. Product mode readers, then the commerce refusal copy, then the screens.
