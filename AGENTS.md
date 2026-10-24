# Kargain — contributor rules

## Project

Decentralized peer-to-peer marketplace for used vehicles. Multi-VM (EVM + SVM): active commercial networks are read only from [`lib/web3/commercial-active.ts`](lib/web3/commercial-active.ts) — never listed by hand. Commercial mainnet remains gated behind [SPEC §7.6](docs/contracts/SPEC.md#76-layerzero-security-configuration-normative) Phase 2 and [§7.7](docs/contracts/SPEC.md#77-messaging-fee-payer-normative).

## How work flows

One issue → one branch → one PR. For the [pause classes](#pause-classes-adr-first) below, design first: open an ADR PR and get maintainer approval before product code. Gate results come from CI; a local run is reported only for gates not yet in CI. Nobody pushes to `master`; only the maintainer merges, deploys, and runs on-chain operations. Never read, print, or commit `.env*` files (except `.env.example`) or keypairs.

## Before any decision — three questions

1. Which invariant is protected (trust, custody, money flow, identity, multi-VM)?
2. Where is the canonical source of truth?
3. What breaks on the second VM or at 10×?

If code or docs do not answer, ask one question — do not guess.

## Pause classes (ADR first)

Stop and file an ADR before changing:

- Smart contracts and SVM programs
- Ponder schema or SVM projection, or anything that needs a reindex
- Money flow, escrow, agent commission, external payment, auction settlement
- Verification reset and dispute outcome
- Bridge / LayerZero / cross-chain custody
- Commercial network registry, deploys, program upgrades, capacity extension
- Auth, sessions, Nostr keys, denylist / resolver

## Engineering rules

- One owner per state and per fact.
- A second independent copy of the same defect means a missing owner, not two call sites to patch.
- No retries, banners, caches, or flags that paper over a missing owner.
- Minimal diff without architectural debt.
- Invariants expressed as types at the boundary.
- The product key is the commercial namespace, never `chainId`.
- No VM forks in `app/`, `components/`, `hooks/` — the fork lives in the owner.
- Fix the defect, not the symptom; every fix ships with a test that reproduces the failure.
- Delete dead code; never keep an old mechanism beside a new one.
- A measurement must be able to fail — negative control red before green; never green over an empty set.
- Scope is set by reading; a list in an issue is a floor.
- Never invent a value where absence must be named (no empty-string address, no `null` for an unknown network, no `??` with a namespace on the right).
- A third patch in one subsystem means stop and redesign.

## Choke-points

Executable registry: [`lib/architecture/chokepoints.ts`](lib/architecture/chokepoints.ts). Violations are caught by ESLint and `pnpm test:verify`. `eslint-disable` is forbidden. Area owners (registered owners: full table in the registry; Geo is the module path only):

| Area | Owner module |
|------|----------------|
| Wallet / session | [`lib/web3/active-account.ts`](lib/web3/active-account.ts) |
| Writes and outcomes | [`hooks/use-tx-sync.ts`](hooks/use-tx-sync.ts) |
| Reads | [`lib/web3/keyed-multicall.ts`](lib/web3/keyed-multicall.ts) |
| Registry / network roles | [`lib/web3/commercial-active.ts`](lib/web3/commercial-active.ts) |
| Amounts / explorer URLs | [`lib/web3/native-amount.ts`](lib/web3/native-amount.ts) · [`lib/web3/network-explorer.ts`](lib/web3/network-explorer.ts) |
| Passport presence / origin | [`lib/passport/presence.ts`](lib/passport/presence.ts) · [`lib/passport/passport-holder.ts`](lib/passport/passport-holder.ts) |
| Ponder reads | [`lib/web3/ponder-tagged-read.ts`](lib/web3/ponder-tagged-read.ts) |
| SVM ingest | [`src/lib/svm-raw-writer.ts`](src/lib/svm-raw-writer.ts) |
| Custody fold | [`src/lib/ponder-passport-custody.ts`](src/lib/ponder-passport-custody.ts) |
| Storage | [`lib/storage/irys-deposit.ts`](lib/storage/irys-deposit.ts) |
| Messaging | [`lib/messaging/session-registry.ts`](lib/messaging/session-registry.ts) |
| Bridge | [`lib/web3/bridge/bridge-config.ts`](lib/web3/bridge/bridge-config.ts) |
| Geo | [`lib/geo/`](lib/geo/) |
| Nostr | [`lib/nostr/key-manager.ts`](lib/nostr/key-manager.ts) |

## Multi-VM and chain rules

- Non-EVM namespace = `2_000_000_000 + LayerZero EID`.
- Custody: one usable copy on one network; origin in `tokenId >> 128` differs from `custodyChain`.
- Trust does not survive a bridge crossing ([SPEC §I.12.3](docs/contracts/SPEC.md#123-trust-never-survives-a-crossing-supersedes-75-preserved-on-return)).
- Bridge is star-only through the gateway ([SPEC §I.12](docs/contracts/SPEC.md#i12-multi-chain-architecture-normative)).
- Program upgrades are in place under the same program id; check program-data capacity before send; extension needs maintainer confirmation.
- Bytecode identity is proven by digest against the ELF read from chain.
- `kargain_svm_raw` is never dropped; the projection is dropped and replayed.
- `entity_origin` separates row existence from an observed mint.
- SVM instruction encoding has one generated owner (no hand IDL, no Anchor).
- The indexer never reads `msg!`.
- Error ordinals are append-only and carry no parameters.
- Ponder smoke uses `/ready`, `/status`, `/read-path-ready` — no custom `/health`.

## Gates

A result counts only on the commit being accepted. Never quote a fixed test count — say “all passing”. *Where* is `CI` ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) or `local — attach output on PR head`.

| Gate | Where | When mandatory |
|------|-------|----------------|
| `pnpm compile` | CI | Contract / ABI compile before ship |
| `pnpm build` | CI | Every ship |
| `pnpm typecheck` | CI | Every ship |
| `pnpm lint` | CI | Every ship |
| `pnpm test:ci` | CI | Trunk policy subset on every PR |
| `pnpm test:unit` | CI | Helper / non-layer Node suites |
| `pnpm test:verify` | local — attach output on PR head | Architecture / deploy / policy changes (CI runs a subset via `test:ci`) |
| `pnpm test:svm-ingest` | local — attach output on PR head | Hard blocker for ingest changes |
| `pnpm test:ponder` | CI | Indexer / schema / HTTP readers; state explicit reindex need when schema or start blocks change |
| `pnpm test` | CI | Hardhat-native contract suites; all passing for contract changes |
| `pnpm test:svm` | local — attach output on PR head | SVM programs / crates; all passing for program changes |
| Layer suites | CI | All run in CI; [`.github/workflows/ci.yml`](.github/workflows/ci.yml) is the list |
| `pnpm test:e2e` | local — attach output on PR head | Local E2E against a running Hardhat node |

## Documentation map (single sources)

| Topic | Source |
|-------|--------|
| EVM addresses, SVM program ids and start slots | [`lib/web3/commercial-active.ts`](lib/web3/commercial-active.ts) ([SPEC I.9](docs/contracts/SPEC.md#i9-multi-chain-deployment-matrix) must match) |
| Contract behaviour | [SPEC Part I](docs/contracts/SPEC.md#part-i--generation-v2-current) |
| Multi-chain custody and trust | [SPEC §I.12](docs/contracts/SPEC.md#i12-multi-chain-architecture-normative) |
| Contract versions | [`scripts/lib/contract-versions.ts`](scripts/lib/contract-versions.ts) |
| Ponder routes | [`docs/indexer/README.md`](docs/indexer/README.md) |
| Reindex | [`docs/indexer/OPERATIONS.md`](docs/indexer/OPERATIONS.md) |
| UI | [`docs/design-spec.md`](docs/design-spec.md) ([§10 Instrument Layer](docs/design-spec.md#10-instrument-layer) wins over §4 for factual typography, accent, and trust colours) |
| Env | [`.env.example`](.env.example) |
| On-chain operations | [`docs/ops/deploys/`](docs/ops/deploys/) |
| Decisions | [`docs/adr/`](docs/adr/) |

Tool- or editor-specific configuration stays out of the repository. This file and the docs it links are the only rule files.

## UI essentials

Read [`docs/design-spec.md`](docs/design-spec.md) before UI work.

- Tokens from [`app/globals.css`](app/globals.css) only.
- No `box-shadow` except `--focus-ring`.
- Weights 400 / 500; sentence case; radius at most `rounded-lg`.
- Icons from [`@/components/ui/icons`](components/ui/icons.tsx) with `strokeWidth={1.5}`.
- Factual on-chain fields in `font-mono tabular-nums`.
- Prices never in accent.
- Wallet selector states `ok` / `wrong_network` / `wrong_vm`.
- The logo is never modified.

## Forbidden

- Privy or any MPC custody; Tableland; nft.storage.
- Paid RPC providers; DAO governance.
- `NEXT_PUBLIC_*` for secrets.
- Chain id / namespace / address literals in components.
- `DEFAULT_CHAIN_ID` or any silent hub fallback.
- Never patch a workflow to hide a product, typecheck, or build failure.
- `@solana/web3.js` in `app`, `components`, `lib`, `hooks`.
- `console.log` in `app/`, `components/`, `lib/`, `hooks/`.
- `: any` in Ponder reads ([`lib/web3/ponder-*.ts`](lib/web3/ponder-client.ts), [`lib/types/ponder.ts`](lib/types/ponder.ts)), the indexer [`src/`](src/), [`lib/nostr/`](lib/nostr/), [`lib/messaging/`](lib/messaging/) (includes the XMTP adapter), and [`hooks/`](hooks/).
- `font-semibold` / `font-bold`; Title Case in UI.
- Public docs linking to files that are not in git.
