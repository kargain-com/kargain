# Kargain — contributor rules

## Project

Kargain is a multi-chain vehicle passport and commerce product spanning EVM and Solana (SVM). Active commercial networks are read only from [`lib/web3/commercial-active.ts`](lib/web3/commercial-active.ts) — never listed by hand in app or docs. Commercial mainnet remains gated behind [SPEC §7.6](docs/contracts/SPEC.md) Phase 2 (LayerZero) and [§7.7](docs/contracts/SPEC.md) (messaging fee payer).

## How work flows

One issue → one branch → one PR. For the pause classes below, design first: open an ADR PR and get maintainer approval before product code. Gate results come from CI on the commit under review; report a local run only for gates not yet in CI. Nobody pushes to `master`; only the maintainer merges, deploys, and runs on-chain operations. Never read, print, or commit `.env*` files (except `.env.example`) or keypairs.

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

Executable registry: [`lib/architecture/chokepoints.ts`](lib/architecture/chokepoints.ts). Violations are caught by ESLint and `pnpm test:verify`. `eslint-disable` is forbidden. Area owners (full table in the registry):

| Area | Owner summary |
|------|----------------|
| Wallet / session | One ActiveAccount; EVM and SVM adapters; no silent hub invent |
| Writes and outcomes | `runTx` / write adapters; typed confirm Outcome and refusals |
| Reads | Keyed multicall; SVM keyed-read; named pending vs refused |
| Registry / network roles | `commercial-active`; branded namespace, explorer, native unit |
| Amounts / explorer URLs | `native-amount`; `network-explorer` from stack |
| Passport presence / origin | Presence deriver; entity origin; holder / custody lock facts |
| Ponder reads | Tagged fetch; route catalog; HTTP freshness classes |
| SVM ingest | Raw writer; projection from raw; readiness surface |
| Custody fold | Read-time fold over crossings + custody-determining events |
| Storage | Irys upload plan + deposit owner (no SDK `fund()`) |
| Messaging | Session contract; consent; compose draft; XMTP ports |
| Bridge | Route resolver; crossing stream; EID→namespace |
| Geo | Place / Photon owners |
| Nostr | Kind writers; coverage; personal-sign identity gate |

## Multi-VM and chain rules

- Non-EVM namespace = `2_000_000_000 + LayerZero EID`.
- Custody: one usable copy on one network; origin in `tokenId >> 128` differs from `custodyChain`.
- Trust does not survive a bridge crossing ([SPEC §I.12.3](docs/contracts/SPEC.md)).
- Bridge is star-only through the gateway.
- Program upgrades are in place under the same program id; check program-data capacity before send; extension needs maintainer confirmation.
- Bytecode identity is proven by digest against the ELF read from chain.
- `kargain_svm_raw` is never dropped; the projection is dropped and replayed.
- `entity_origin` separates row existence from an observed mint.
- SVM instruction encoding has one generated owner (no hand IDL, no Anchor).
- The indexer never reads `msg!`.
- Error ordinals are append-only and carry no parameters.
- Ponder smoke uses `/ready`, `/status`, `/read-path-ready` — no custom `/health`.

## Gates

A result counts only on the commit being accepted. Never quote a fixed test count — say “all passing”.

| Gate | Where / when |
|------|----------------|
| `pnpm build` | CI and every ship; Next production build |
| `pnpm typecheck` | CI and every ship; union of all typecheck projects |
| `pnpm lint` | CI and every ship |
| `pnpm test:ci` | CI trunk; `test:verify` minus deploy-machine-only suites |
| `pnpm test:verify` | Architecture / deploy / policy; mandatory for those changes; deploy-machine subset may be local-only |
| `pnpm test:svm-ingest` | Hard blocker for ingest changes |
| `pnpm test:ponder` | Indexer / schema / HTTP readers; state explicit reindex need when schema or start blocks change |
| `pnpm test` | Hardhat-native contract suites; all passing for contract changes |
| `pnpm test:svm` | SVM programs / crates (`cargo test`); all passing for program changes |
| Layer suites | e.g. `test:commerce-ui`, `test:bridge`, `test:passport-ui`, `test:messaging` — run the suite that owns the layer you changed |
| `pnpm test:e2e` | Local E2E against a running Hardhat node |

## Documentation map (single sources)

| Topic | Source |
|-------|--------|
| EVM addresses | [SPEC I.9](docs/contracts/SPEC.md) |
| SVM program ids and start slots | [`lib/web3/commercial-active.ts`](lib/web3/commercial-active.ts) |
| Contract behaviour | [SPEC Part I](docs/contracts/SPEC.md) |
| Multi-chain custody and trust | [SPEC §I.12](docs/contracts/SPEC.md) |
| Contract versions | [`scripts/lib/contract-versions.ts`](scripts/lib/contract-versions.ts) |
| Ponder routes | [`docs/indexer/README.md`](docs/indexer/README.md) |
| Reindex | [`docs/indexer/OPERATIONS.md`](docs/indexer/OPERATIONS.md) |
| UI | [`docs/design-spec.md`](docs/design-spec.md) (§10 Instrument Layer wins over §4 for factual typography, accent, and trust colours) |
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
- `@solana/web3.js` in `app`, `components`, `lib`, `hooks`.
- `console.log` in `app/`, `components/`, `lib/`, `hooks/`.
- `: any` in `lib/nostr/`, `lib/messaging/`, `hooks/`.
- `font-semibold` / `font-bold`; Title Case in UI.
- Public docs linking to files that are not in git.
