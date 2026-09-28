# S8 — `kar_passport` mint-admission in-place upgrade (Devnet)

**Status: DONE on chain (2026-09-27).** Ops record completed 2026-09-28 from on-chain recovery + public indexer proof (CLI paste of the live upgrade command was never filed; the chain holds the same facts).

Related: [svm-devnet.md](./svm-devnet.md) · [s8-e-devnet-upgrade.md](./s8-e-devnet-upgrade.md) · [s9-b2-devnet-upgrade.md](./s9-b2-devnet-upgrade.md)

## Why

Permissionless `MintPassport` (freeze = bound gateway freeze PDA) had to replace the authority-only ELF on Devnet program id `ArvcryxBL1mP44Vo4MoK1FE3YCnNG8JdVa3iTKxgWnTQ` without moving the id, the deploy slot, or ingest floors.

## What changed / what did not

| Changed | Unchanged |
|---|---|
| ELF behind `kar_passport` only | Program id |
| Evidence digest / bytes / `sourceGitHead` for that row | `deploySlot` **490 505 668**, registry `blocks.*`, other five programs |
| | Upgrade authority `65Qmw9zhpkjxJApmFngx3dxmGo2KiZ4kyJycLsWh4gU9` |

No reindex: ingest already follows `PassportMinted` at the existing floor.

## Build that shipped

| Field | Value |
|---|---|
| Source | clean `8bd4823` |
| sha256 | `71ca70d76c9c…d840e` (full digest as verified by `verify:svm-binary-identity`) |
| Bytes | 277 304 |
| `e_flags` | `0x3` (`--arch v3`) |
| ProgramData capacity | 327 520 (fits; deficit 0; no extend) |

Prior on-chain digest (pre-upgrade): `fc2db580…`. Post-upgrade: `71ca70d7…`. Other five programs remain `4fd0b92` (gateway digest `9fe81953…` as previously attested).

## Live upgrade (recovered from Devnet)

Measured on public Devnet RPC from the program address signature list and the upgrade transaction accounts/logs (not from a retained CLI log file).

| Field | Value |
|---|---|
| Upgrade signature | `45hCaQbHvoWbRFrxHPEagdHZ6CqysVPe7FK4oC7hVfnEBwDrespbe1p7UcuebvaqNnYeHH4pR1DtVRfrosh8qdM3` |
| Slot | **504726200** |
| Block time (UTC) | 2026-09-27T08:54:53Z |
| Buffer account | `59mQWsgV6qk4vGTsPuZu4qwL5oXXtiVGXffSZzaeV4ri` |
| ProgramData | `Dj5ZPA7yqTCRuLMXKBa5AF53WR6Ak4cy4VTXVq5k2K7g` |
| Log | `Upgraded program ArvcryxBL1mP44Vo4MoK1FE3YCnNG8JdVa3iTKxgWnTQ` · loader success |

Earlier same-slot txs at 504726193 write ELF into that buffer (BPFLoader write path); the upgrade ix is the one above.

Post-upgrade gates (founder, same day): `verify:svm-authority` 6/6; `verify:svm-binary-identity --eid=40168` 6/6 empty padding — only `kar_passport` digest moved.

## Post-upgrade product proof

| Check | Result (2026-09-28) |
|---|---|
| `GET https://ponder.kargain.com/passports/680578402303991407182949611694767742177517764613` | **HTTP 200** — `entityOrigin: "minted"`, `chainId` / `custodyChain` **2000040168**, `custodyUnresolved: null`, owner `D87ok…` |
| svm-ingest `GET :42100/ready` | **Not re-probed from the executor workstation** (port is VPS-local; no SSH host for the deploy machine in this environment). Prior founder measurement at U9.0 mint time was ready with `lagSlots: 0`. The passport GET above is the public proof that projection still serves the pre-upgrade subject after the ELF change. |

## Deliberate non-effects

- No `COMMERCIAL_ACTIVE` edit, no ingest floor move, no Ponder recreate required for this upgrade alone.
- Create product path stayed `authority_only` in chrome until the dual-VM mint unit (`08c771f`) flipped the census; that unit is separate from this ops record.
