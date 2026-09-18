# Kargain documentation (public)

Start here. Each area has **one canonical document**; other files link in — they do not repeat tables or procedures.

## Contracts (on-chain)

| Document | Purpose |
|----------|---------|
| [contracts/SPEC.md](./contracts/SPEC.md) | **Single specification** — generation v2 (current), v1.x (historical), metadata JSON, addresses |
| [contracts/README.md](./contracts/README.md) | How to read the spec |

**Addresses:** [SPEC I.9.1](./contracts/SPEC.md#i91-active-deployment-base-sepolia-84532) (84532) · [SPEC I.9.2](./contracts/SPEC.md#i92-active-deployment-ethereum-sepolia-11155111) (11155111) · [SPEC I.9.3](./contracts/SPEC.md#i93-active-deployment-solana-devnet-2000040168) (Solana) · [SPEC Part II.4](./contracts/SPEC.md#ii4-historical-deployment-base-sepolia-84532) (historical)

**Audit on-chain source:** when Basescan / Etherscan show verified source, use those explorer pages. Nuclear #7 explorers are green — see [nuclear-7.md](./ops/deploys/nuclear-7.md). Older parallel stacks (N5/N6) are historical only.

## Indexer (Ponder)

| Document | Purpose |
|----------|---------|
| [indexer/README.md](./indexer/README.md) | Ponder HTTP API + **SVM raw ingest** (`svm-ingest`, schema `kargain_svm_raw`) |
| [indexer/MIGRATION-V2.md](./indexer/MIGRATION-V2.md) | v2 handler reference; Nuclear dual-chain / C3; FX display layer (§6) |
| [indexer/OPERATIONS.md](./indexer/OPERATIONS.md) | **Permanent** — VPS reindex runbook (hub **46119704** + Eth **11591966**; Solana via `svm-ingest`) |

## UI

| Document | Purpose |
|----------|---------|
| [design-spec.md](./design-spec.md) | UI layout, tokens, components — Instrument Layer §10–§13; passport tabs + right-rail Discussion (§4.14, §13.6–§13.7); **Messages** session / consent / devices (§4.12, I1–I20) |

**Reading order:** foundation §1–9 → Instrument rules §10 → philosophy §11 → shipped roadmap §12 → mobile §13.

## Deploy records

| Document | Purpose |
|----------|---------|
| [ops/deploys/nuclear-7.md](./ops/deploys/nuclear-7.md) | **Current live EVM stack** — Nuclear #7 (84532 + 11155111); S9-A cutover on `master` |
| [ops/deploys/s9-b-solana-cutover.md](./ops/deploys/s9-b-solana-cutover.md) | Solana Devnet commercial row (namespace **2000040168**) — S9-B |
| [ops/deploys/nuclear-4.md](./ops/deploys/nuclear-4.md) | **Historical** — Nuclear #4 (denylisted; superseded by N7) |
| [ops/deploys/nuclear-6.md](./ops/deploys/nuclear-6.md) | **Historical** — Nuclear #6 parallel (URI ceiling) |
| [ops/deploys/archive/](./ops/deploys/archive/) | **Historical** — Nuclear #2/#3, June v2, AuctionEscrow, pre-Nuclear bridge pathway |
| [ops/deploys/multichain-browser-e2e-checklist.md](./ops/deploys/multichain-browser-e2e-checklist.md) | Maintainer dual-chain browser/ops checklist (testnet) |
| [ops/deploys/phase2-checkpoint-dossier.md](./ops/deploys/phase2-checkpoint-dossier.md) | §7.6 Phase 2 mainnet dossier — prepared, not activated |
| [ops/recovery-bridge.md](./ops/recovery-bridge.md) | Bridge recovery ops (testnet EOA vs mainnet Timelock) |

## Product onboarding

[README.md](../README.md) — setup, architecture, routes (links here for depth).
